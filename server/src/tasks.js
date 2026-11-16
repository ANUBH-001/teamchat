// Task logic. Reused by routes/tasks.js (source 'manual') and the Phase 4 AI engine (source 'ai').
// `actor` is a user object {id, role}. Functions throw TaskError(status, message).
// Optional last arg `messageId`: chat message that triggered an AI change (stored in task_events.message_id).
const pool = require('./db');
const rt = require('./realtime');

class TaskError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

const STATUSES = ['todo', 'in_progress', 'done'];
const isBoss = (u) => u.role === 'boss';

const SELECT = `SELECT t.id, t.title, t.description, t.assignee_id, u.name assignee_name, t.created_by,
  t.status, DATE_FORMAT(t.due_at, '%Y-%m-%d') due_date, t.completed_at, t.created_at, t.updated_at
  FROM tasks t LEFT JOIN users u ON u.id = t.assignee_id WHERE t.deleted_at IS NULL`;

const shape = (r) => ({
  id: r.id, title: r.title, description: r.description,
  assigneeId: r.assignee_id, assigneeName: r.assignee_name, createdBy: r.created_by,
  status: r.status, dueDate: r.due_date, completedAt: r.completed_at,
  createdAt: r.created_at, updatedAt: r.updated_at,
});

async function getTask(id) {
  const [[r]] = await pool.query(SELECT + ' AND t.id = ?', [id]);
  if (!r) throw new TaskError(404, 'Task not found');
  return shape(r);
}

async function event(taskId, actor, type, oldV, newV, source, messageId = null) {
  await pool.query(
    'INSERT INTO task_events (task_id, actor_id, event, old_value, new_value, source, message_id) VALUES (?,?,?,?,?,?,?)',
    [taskId, actor.id, type, oldV == null ? null : String(oldV), newV == null ? null : String(newV), source, messageId]);
}

// Push the task to assignee, creator, actor and every boss.
async function notify(task, deleted) {
  const [bosses] = await pool.query("SELECT id FROM users WHERE role = 'boss' AND active = 1");
  const ids = new Set(bosses.map((b) => b.id));
  [task.assigneeId, task.createdBy].forEach((i) => i && ids.add(i));
  const ev = deleted ? { type: 'task_deleted', taskId: task.id } : { type: 'task', task };
  ids.forEach((i) => rt.sendToUser(i, ev));
}

function cleanDate(v) {
  if (v == null || v === '') return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(v)) || isNaN(Date.parse(v))) throw new TaskError(400, 'Invalid due date');
  return v + ' 00:00:00';
}

async function checkAssignee(id) {
  const [[u]] = await pool.query('SELECT id FROM users WHERE id = ? AND active = 1', [id]);
  if (!u) throw new TaskError(400, 'Invalid assignee');
}

async function createTask({ title, description, assigneeId, dueDate }, actor, source = 'manual', messageId = null) {
  if (!isBoss(actor)) throw new TaskError(403, 'Not allowed');
  title = String(title || '').trim();
  if (!title) throw new TaskError(400, 'Title is required');
  if (title.length > 255) throw new TaskError(400, 'Title too long');
  await checkAssignee(assigneeId);
  const due = cleanDate(dueDate);
  const [r] = await pool.query(
    'INSERT INTO tasks (title, description, assignee_id, created_by, due_at, source_message_id) VALUES (?,?,?,?,?,?)',
    [title, description ? String(description) : null, assigneeId, actor.id, due, messageId]);
  await event(r.insertId, actor, 'created', null, title, source, messageId);
  const task = await getTask(r.insertId);
  await notify(task);
  return task;
}

async function setStatus(task, status, actor, source, messageId = null) {
  await pool.query(
    'UPDATE tasks SET status = ?, completed_at = ? WHERE id = ?',
    [status, status === 'done' ? new Date() : null, task.id]);
  await event(task.id, actor, 'status', task.status, status, source, messageId);
}

async function updateTaskStatus(id, status, actor, source = 'manual', messageId = null) {
  if (!STATUSES.includes(status)) throw new TaskError(400, 'Invalid status');
  const task = await getTask(id);
  if (!isBoss(actor) && task.assigneeId !== actor.id) throw new TaskError(403, 'Not allowed');
  if (task.status !== status) await setStatus(task, status, actor, source, messageId);
  const fresh = await getTask(id);
  await notify(fresh);
  return fresh;
}

// fields: any of status, title, description, assigneeId, dueDate. Members: status on own task only.
async function updateTask(id, f, actor, source = 'manual', messageId = null) {
  const keys = ['status', 'title', 'description', 'assigneeId', 'dueDate'].filter((k) => f[k] !== undefined);
  if (!keys.length) throw new TaskError(400, 'Nothing to update');
  if (!isBoss(actor) && (keys.length > 1 || keys[0] !== 'status')) throw new TaskError(403, 'Not allowed');
  if (keys.length === 1 && keys[0] === 'status') return updateTaskStatus(id, f.status, actor, source, messageId);
  const ev = (...a) => event(...a, source, messageId);
  if (f.status !== undefined && !STATUSES.includes(f.status)) throw new TaskError(400, 'Invalid status');
  const task = await getTask(id);
  const set = []; const vals = [];
  if (f.title !== undefined) {
    const t = String(f.title).trim();
    if (!t || t.length > 255) throw new TaskError(400, 'Invalid title');
    set.push('title = ?'); vals.push(t);
    if (t !== task.title) await ev(id, actor, 'title', task.title, t);
  }
  if (f.description !== undefined) {
    set.push('description = ?'); vals.push(f.description ? String(f.description) : null);
    await ev(id, actor, 'description', task.description, f.description);
  }
  if (f.assigneeId !== undefined) {
    await checkAssignee(f.assigneeId);
    set.push('assignee_id = ?'); vals.push(f.assigneeId);
    if (f.assigneeId !== task.assigneeId) await ev(id, actor, 'assignee', task.assigneeId, f.assigneeId);
  }
  if (f.dueDate !== undefined) {
    set.push('due_at = ?'); vals.push(cleanDate(f.dueDate));
    await ev(id, actor, 'due', task.dueDate, f.dueDate);
  }
  if (set.length) await pool.query('UPDATE tasks SET ' + set.join(', ') + ' WHERE id = ?', [...vals, id]);
  if (f.status !== undefined && f.status !== task.status) await setStatus(task, f.status, actor, source, messageId);
  const fresh = await getTask(id);
  await notify(fresh);
  // also tell the previous assignee so the task leaves their list
  if (task.assigneeId !== fresh.assigneeId) rt.sendToUser(task.assigneeId, { type: 'task', task: fresh });
  return fresh;
}

async function deleteTask(id, actor, source = 'manual') {
  if (!isBoss(actor)) throw new TaskError(403, 'Not allowed');
  const task = await getTask(id);
  await pool.query('UPDATE tasks SET deleted_at = NOW() WHERE id = ?', [id]);
  await event(id, actor, 'deleted', null, null, source);
  await notify(task, true);
}

// Revert the most recent status change (boss, or the assignee).
async function undoTask(id, actor, source = 'manual') {
  const task = await getTask(id);
  if (!isBoss(actor) && task.assigneeId !== actor.id) throw new TaskError(403, 'Not allowed');
  const [[ev]] = await pool.query(
    "SELECT old_value FROM task_events WHERE task_id = ? AND event = 'status' ORDER BY id DESC LIMIT 1", [id]);
  if (!ev) throw new TaskError(400, 'Nothing to undo');
  await setStatus(task, ev.old_value, actor, source);
  const fresh = await getTask(id);
  await notify(fresh);
  return fresh;
}

// Boss: all tasks. Member: own tasks by default; assignee='all' or an id shows others read-only.
async function listTasks({ assignee, status, q }, actor) {
  let sql = SELECT; const vals = [];
  let who = assignee;
  if (who === undefined || who === '') who = isBoss(actor) ? 'all' : String(actor.id);
  if (who !== 'all') { sql += ' AND t.assignee_id = ?'; vals.push(parseInt(who, 10) || 0); }
  if (status) {
    if (!STATUSES.includes(status)) throw new TaskError(400, 'Invalid status');
    sql += ' AND t.status = ?'; vals.push(status);
  }
  if (q) { sql += ' AND (t.title LIKE ? OR t.description LIKE ?)'; vals.push('%' + q + '%', '%' + q + '%'); }
  sql += " ORDER BY t.status = 'done', t.due_at IS NULL, t.due_at, t.id DESC";
  const [rows] = await pool.query(sql, vals);
  return rows.map(shape);
}

async function summary() {
  const [rows] = await pool.query(
    `SELECT u.id, u.name, COUNT(t.id) total,
       COALESCE(SUM(t.status = 'todo'), 0) todo,
       COALESCE(SUM(t.status = 'in_progress'), 0) in_progress,
       COALESCE(SUM(t.status = 'done'), 0) done
     FROM users u LEFT JOIN tasks t ON t.assignee_id = u.id AND t.deleted_at IS NULL
     WHERE u.active = 1 GROUP BY u.id, u.name ORDER BY u.name`);
  const users = rows.map((r) => ({
    id: r.id, name: r.name, total: Number(r.total), todo: Number(r.todo),
    in_progress: Number(r.in_progress), done: Number(r.done),
  }));
  const overall = users.reduce((a, u) => ({
    total: a.total + u.total, todo: a.todo + u.todo, in_progress: a.in_progress + u.in_progress, done: a.done + u.done,
  }), { total: 0, todo: 0, in_progress: 0, done: 0 });
  return { users, overall };
}

async function mySummary(userId) {
  const tasks = await listTasks({ assignee: String(userId) }, { id: userId, role: 'member' });
  const pick = (s) => tasks.filter((t) => t.status === s).map((t) => ({ id: t.id, title: t.title, dueDate: t.dueDate }));
  return { done: pick('done'), in_progress: pick('in_progress'), todo: pick('todo') };
}

module.exports = {
  TaskError, createTask, updateTask, updateTaskStatus, deleteTask, undoTask, listTasks, summary, mySummary, getTask,
};
