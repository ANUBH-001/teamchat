// Task logic. Reused by routes/tasks.js (source 'manual'), slash commands (source 'command'), the AI engine
// (source 'ai') and check-ins (source 'checkin'). `actor` is a user object {id, name, role}.
// Functions throw TaskError(status, message, code). Optional last arg `messageId`: chat message that triggered the change.
// Permissions: boss = everything. Members: status/note of tasks assigned to them; with setting membersCanAssign also
// create tasks (for anyone), and edit/reassign tasks they created or are assigned. Delete: boss or creator.
const pool = require('./db');
const rt = require('./realtime');
const settings = require('./settings');
const bot = require('./ai/bot');

class TaskError extends Error {
  constructor(status, message, code) {
    super(message);
    this.status = status;
    this.code = code || (status === 403 ? 'NOT_ALLOWED' : status === 404 ? 'NOT_FOUND' : 'BAD_REQUEST');
  }
}

const STATUSES = ['todo', 'in_progress', 'review', 'done'];
const isBoss = (u) => u.role === 'boss';

// Local dates use TZ (default Asia/Kolkata), like check-ins.
const TZ = (() => { try { new Intl.DateTimeFormat('en-US', { timeZone: process.env.TZ }); return process.env.TZ || 'Asia/Kolkata'; } catch (e) { return 'Asia/Kolkata'; } })();
const DAY_FMT = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' });
const today = () => DAY_FMT.format(new Date()); // 'YYYY-MM-DD'
const startOfToday = () => { const d = new Date(); d.setHours(0, 0, 0, 0); return d; }; // compared with completed_at (same mysql2 Date mapping)

const SELECT = `SELECT t.id, t.title, t.description, t.project, t.assignee_id, u.name assignee_name, t.created_by,
  cu.name created_by_name, t.status, DATE_FORMAT(t.due_at, '%Y-%m-%d') due_date, t.chat_id, t.source_message_id,
  t.completed_at, t.created_at, t.updated_at
  FROM tasks t LEFT JOIN users u ON u.id = t.assignee_id LEFT JOIN users cu ON cu.id = t.created_by WHERE t.deleted_at IS NULL`;

const shape = (r) => ({
  id: r.id, title: r.title, description: r.description, project: r.project || null,
  assigneeId: r.assignee_id, assigneeName: r.assignee_name, createdBy: r.created_by, createdByName: r.created_by_name || null,
  status: r.status, dueDate: r.due_date, chatId: r.chat_id || null,
  sourceMessageId: r.source_message_id ? Number(r.source_message_id) : null,
  createdAt: r.created_at, updatedAt: r.updated_at, completedAt: r.completed_at,
  overdue: !!(r.due_date && r.status !== 'done' && r.due_date < today()),
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

const canAssign = (actor) => isBoss(actor) || settings.get().membersCanAssign;
// status / note
const canWork = (task, actor) => isBoss(actor) || task.assigneeId === actor.id || (task.createdBy === actor.id && canAssign(actor));
// title / description / project / assignee / due
const canManage = (task, actor) => isBoss(actor) || (canAssign(actor) && (task.createdBy === actor.id || task.assigneeId === actor.id));

// Admin alert flag for the app: a member (not the boss) changed a task, switch on, and the task's chat allows it.
// Check-in driven changes never alert the boss (check-ins are pull-only for him).
async function notifyAdminFor(task, actor, source) {
  if (!actor || isBoss(actor) || source === 'checkin') return false;
  const s = await settings.all();
  if (!s.notifyAdminOnMemberChanges) return false;
  return task.chatId ? (await settings.forChat(task.chatId)).notifyAdmin : true;
}

// Push the task to assignee, creator, actor, every boss (and a previous assignee).
// ws: {type:'task', task, event, actorId, actorName, notifyAdmin} or {type:'task_deleted', taskId, task, ...same}.
async function notify(task, ev, actor, source, prevAssigneeId) {
  const [bosses] = await pool.query("SELECT id FROM users WHERE role = 'boss' AND active = 1");
  const ids = new Set(bosses.map((b) => b.id));
  [task.assigneeId, task.createdBy, actor && actor.id, prevAssigneeId].forEach((i) => i && ids.add(i));
  const meta = { event: ev, actorId: actor ? actor.id : null, actorName: (actor && actor.name) || null,
    notifyAdmin: await notifyAdminFor(task, actor, source) };
  const msg = ev === 'deleted' ? { type: 'task_deleted', taskId: task.id, task, ...meta } : { type: 'task', task, ...meta };
  ids.forEach((i) => rt.sendToUser(i, msg));
}

function cleanDate(v) {
  if (v == null || v === '') return null;
  const d = new Date(String(v) + 'T00:00:00Z');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(v)) || isNaN(d) || d.toISOString().slice(0, 10) !== v) {
    throw new TaskError(400, 'Invalid due date');
  }
  return v + ' 00:00:00';
}

function cleanProject(v) {
  if (v == null) return null;
  const p = String(v).trim();
  if (p.length > 60) throw new TaskError(400, 'Project too long');
  return p || null;
}

async function checkAssignee(id) {
  const [[u]] = await pool.query('SELECT id FROM users WHERE id = ? AND active = 1 AND is_bot = 0', [id]);
  if (!u) throw new TaskError(400, 'Invalid assignee');
}

async function createTask({ title, description, assigneeId, dueDate, project, chatId }, actor, source = 'manual', messageId = null) {
  await settings.all();
  if (!canAssign(actor)) throw new TaskError(403, 'Not allowed');
  title = String(title || '').trim();
  if (!title) throw new TaskError(400, 'Title is required');
  if (title.length > 255) throw new TaskError(400, 'Title too long');
  assigneeId = parseInt(assigneeId, 10) || 0;
  await checkAssignee(assigneeId);
  const due = cleanDate(dueDate);
  const proj = cleanProject(project);
  let chat = parseInt(chatId, 10) || null;
  if (chat && !(await rt.isChatMember(chat, actor.id))) chat = null;
  const [r] = await pool.query(
    'INSERT INTO tasks (title, description, project, assignee_id, created_by, due_at, source_message_id, chat_id) VALUES (?,?,?,?,?,?,?,?)',
    [title, description ? String(description) : null, proj, assigneeId, actor.id, due, messageId, chat]);
  await event(r.insertId, actor, 'created', null, title, source, messageId);
  const task = await getTask(r.insertId);
  await notify(task, 'created', actor, source);
  return task;
}

async function setStatus(task, status, actor, source, messageId = null) {
  await pool.query(
    'UPDATE tasks SET status = ?, completed_at = ? WHERE id = ?',
    [status, status === 'done' ? new Date() : null, task.id]);
  await event(task.id, actor, 'status', task.status, status, source, messageId);
}

// Card/ws event name for a set of changes.
function eventFor(changes, task) {
  if (changes.has('assignee')) return 'reassigned';
  if (changes.has('status')) return task.status === 'done' ? 'completed' : task.status === 'review' ? 'review' : 'updated';
  if (changes.has('due') && changes.size === 1) return 'due';
  if (changes.has('note') && changes.size === 1) return 'note';
  return 'updated';
}

const FIELDS = ['status', 'title', 'description', 'project', 'assigneeId', 'dueDate', 'note'];

// fields: any of FIELDS -> {task, event, changed}. note = progress note (task_events 'note', text in new_value).
async function applyUpdate(id, f, actor, source = 'manual', messageId = null) {
  await settings.all();
  const keys = FIELDS.filter((k) => f[k] !== undefined);
  if (!keys.length) throw new TaskError(400, 'Nothing to update');
  const task = await getTask(id);
  const managing = keys.some((k) => k !== 'status' && k !== 'note');
  if (managing ? !canManage(task, actor) : !canWork(task, actor)) throw new TaskError(403, 'Not allowed');
  if (f.status !== undefined && !STATUSES.includes(f.status)) throw new TaskError(400, 'Invalid status');
  let note = null;
  if (f.note !== undefined) {
    note = String(f.note || '').trim();
    if (!note || note.length > 1000) throw new TaskError(400, 'Invalid note');
  }
  const ev = (...a) => event(...a, source, messageId);
  const changes = new Set();
  const set = []; const vals = [];
  if (f.title !== undefined) {
    const t = String(f.title).trim();
    if (!t || t.length > 255) throw new TaskError(400, 'Invalid title');
    set.push('title = ?'); vals.push(t);
    if (t !== task.title) { await ev(id, actor, 'title', task.title, t); changes.add('title'); }
  }
  if (f.description !== undefined) {
    const d = f.description ? String(f.description) : null;
    set.push('description = ?'); vals.push(d);
    if (d !== task.description) { await ev(id, actor, 'description', task.description, d); changes.add('description'); }
  }
  if (f.project !== undefined) {
    const p = cleanProject(f.project);
    set.push('project = ?'); vals.push(p);
    if (p !== task.project) { await ev(id, actor, 'project', task.project, p); changes.add('project'); }
  }
  if (f.assigneeId !== undefined) {
    const a = parseInt(f.assigneeId, 10) || 0;
    await checkAssignee(a);
    set.push('assignee_id = ?'); vals.push(a);
    if (a !== task.assigneeId) { await ev(id, actor, 'assignee', task.assigneeId, a); changes.add('assignee'); }
  }
  if (f.dueDate !== undefined) {
    const due = cleanDate(f.dueDate);
    set.push('due_at = ?'); vals.push(due);
    const d = due ? due.slice(0, 10) : null;
    if (d !== task.dueDate) { await ev(id, actor, 'due', task.dueDate, d); changes.add('due'); }
  }
  if (set.length) await pool.query('UPDATE tasks SET ' + set.join(', ') + ' WHERE id = ?', [...vals, id]);
  if (f.status !== undefined && f.status !== task.status) { await setStatus(task, f.status, actor, source, messageId); changes.add('status'); }
  if (note) { await ev(id, actor, 'note', null, note); changes.add('note'); }
  const fresh = await getTask(id);
  const name = eventFor(changes, fresh);
  await notify(fresh, name, actor, source, task.assigneeId !== fresh.assigneeId ? task.assigneeId : null);
  return { task: fresh, event: name, changed: changes.size > 0, before: task };
}

const updateTask = async (id, f, actor, source = 'manual', messageId = null) =>
  (await applyUpdate(id, f, actor, source, messageId)).task;

async function updateTaskStatus(id, status, actor, source = 'manual', messageId = null) {
  if (!STATUSES.includes(status)) throw new TaskError(400, 'Invalid status');
  return updateTask(id, { status }, actor, source, messageId);
}

async function deleteTask(id, actor, source = 'manual') {
  const task = await getTask(id);
  if (!isBoss(actor) && task.createdBy !== actor.id) throw new TaskError(403, 'Not allowed');
  await pool.query('UPDATE tasks SET deleted_at = NOW() WHERE id = ?', [id]);
  await event(id, actor, 'deleted', null, null, source);
  await notify(task, 'deleted', actor, source);
  return task;
}

// Revert the most recent status change (boss, assignee, or creator when members may assign).
async function undoTask(id, actor, source = 'manual') {
  await settings.all();
  const task = await getTask(id);
  if (!canWork(task, actor)) throw new TaskError(403, 'Not allowed');
  const [[ev]] = await pool.query(
    "SELECT old_value FROM task_events WHERE task_id = ? AND event = 'status' ORDER BY id DESC LIMIT 1", [id]);
  if (!ev || !STATUSES.includes(ev.old_value)) throw new TaskError(400, 'Nothing to undo');
  await setStatus(task, ev.old_value, actor, source);
  const fresh = await getTask(id);
  await notify(fresh, eventFor(new Set(['status']), fresh), actor, source);
  return fresh;
}

// Praise (boss or the task creator; setting praiseEnabled). Card goes to the task's chat if the assignee is in it,
// else to the DM between the praiser and the assignee.
async function praiseTask(id, actor, text) {
  const s = await settings.all();
  if (!s.praiseEnabled) throw new TaskError(403, 'Praise is turned off');
  const task = await getTask(id);
  if (!isBoss(actor) && task.createdBy !== actor.id) throw new TaskError(403, 'Not allowed');
  const note = String(text || '').trim().slice(0, 300) || null;
  await event(id, actor, 'praise', null, note, 'manual');
  let chatId = task.chatId && task.assigneeId && (await rt.isChatMember(task.chatId, task.assigneeId)) ? task.chatId : null;
  if (!chatId && task.assigneeId && task.assigneeId !== actor.id) {
    const dm = await bot.ensureDm(actor.id, task.assigneeId);
    if (dm.created) rt.sendToUser(task.assigneeId, { type: 'chat', chatId: dm.chatId });
    chatId = dm.chatId;
  }
  if (chatId) await bot.taskCard(chatId, 'praise', task, actor, note ? { note } : {});
  await notify(task, 'praise', actor, 'manual');
  return task;
}

const nameMap = async () => {
  const [rows] = await pool.query('SELECT id, name FROM users');
  return new Map(rows.map((r) => [String(r.id), r.name]));
};
// assignee events store ids: show names
const eventShape = (r, names) => {
  const v = (x) => (r.event === 'assignee' && x != null ? names.get(String(x)) || x : x);
  return {
    id: Number(r.id), event: r.event, oldValue: v(r.old_value), newValue: v(r.new_value),
    actorId: r.actor_id, actorName: r.actor_name || null, source: r.source, createdAt: r.created_at,
  };
};
const EVENT_SELECT = 'SELECT e.id, e.task_id, e.event, e.old_value, e.new_value, e.actor_id, au.name actor_name, e.source, e.created_at ' +
  'FROM task_events e LEFT JOIN users au ON au.id = e.actor_id ';

// GET /tasks/:id -> {task, events} (oldest first). Everyone may read every task.
async function taskDetail(id) {
  const task = await getTask(id);
  const [rows] = await pool.query(EVENT_SELECT + 'WHERE e.task_id = ? ORDER BY e.id', [id]);
  const names = await nameMap();
  return { task, events: rows.map((r) => eventShape(r, names)) };
}

// GET /tasks/activity -> newest first, all tasks (read-only for members). since = ISO time (optional).
async function activity({ limit, since }) {
  const n = Math.min(Math.max(parseInt(limit, 10) || 50, 1), 200);
  const vals = [];
  // deleted tasks: keep only the "deleted" event itself, hide their older history from the feed
  let where = "WHERE e.event <> 'description' AND (t.deleted_at IS NULL OR e.event = 'deleted') ";
  if (since) {
    const d = new Date(String(since));
    if (isNaN(d)) throw new TaskError(400, 'Invalid since');
    where += 'AND e.created_at >= ? '; vals.push(d);
  }
  const [rows] = await pool.query(
    EVENT_SELECT.replace(' FROM', ', t.title task_title, t.assignee_id, tu.name assignee_name FROM') +
    'JOIN tasks t ON t.id = e.task_id LEFT JOIN users tu ON tu.id = t.assignee_id ' + where + 'ORDER BY e.id DESC LIMIT ?',
    [...vals, n]);
  const names = await nameMap();
  return {
    events: rows.map((r) => ({
      ...eventShape(r, names), taskId: r.task_id, taskTitle: r.task_title, assigneeId: r.assignee_id, assigneeName: r.assignee_name,
    })),
  };
}

// Boss: all tasks. Member: own tasks by default; assignee='all' or an id shows others read-only.
async function listTasks({ assignee, status, q, project }, actor) {
  let sql = SELECT; const vals = [];
  let who = assignee;
  if (who === undefined || who === '') who = isBoss(actor) ? 'all' : String(actor.id);
  if (who !== 'all') { sql += ' AND t.assignee_id = ?'; vals.push(parseInt(who, 10) || 0); }
  if (status) {
    if (!STATUSES.includes(status)) throw new TaskError(400, 'Invalid status');
    sql += ' AND t.status = ?'; vals.push(status);
  }
  if (project) { sql += ' AND t.project = ?'; vals.push(String(project)); }
  if (q) { sql += ' AND (t.title LIKE ? OR t.description LIKE ? OR t.project LIKE ?)'; vals.push('%' + q + '%', '%' + q + '%', '%' + q + '%'); }
  sql += " ORDER BY t.status = 'done', t.due_at IS NULL, t.due_at, t.id DESC";
  const [rows] = await pool.query(sql, vals);
  return rows.map(shape);
}

const COUNT_KEYS = ['total', 'todo', 'in_progress', 'review', 'done', 'overdue', 'doneToday'];

async function summary() {
  const [rows] = await pool.query(
    `SELECT u.id, u.name, COUNT(t.id) total,
       COALESCE(SUM(t.status = 'todo'), 0) todo,
       COALESCE(SUM(t.status = 'in_progress'), 0) in_progress,
       COALESCE(SUM(t.status = 'review'), 0) review,
       COALESCE(SUM(t.status = 'done'), 0) done,
       COALESCE(SUM(t.status <> 'done' AND t.due_at IS NOT NULL AND DATE_FORMAT(t.due_at, '%Y-%m-%d') < ?), 0) overdue,
       COALESCE(SUM(t.status = 'done' AND t.completed_at >= ?), 0) done_today
     FROM users u LEFT JOIN tasks t ON t.assignee_id = u.id AND t.deleted_at IS NULL
     WHERE u.active = 1 AND u.is_bot = 0 GROUP BY u.id, u.name ORDER BY u.name`, [today(), startOfToday()]);
  const users = rows.map((r) => ({
    id: r.id, name: r.name, total: Number(r.total), todo: Number(r.todo), in_progress: Number(r.in_progress),
    review: Number(r.review), done: Number(r.done), overdue: Number(r.overdue), doneToday: Number(r.done_today),
  }));
  const overall = {};
  for (const k of COUNT_KEYS) overall[k] = users.reduce((a, u) => a + u[k], 0);
  const totals = { open: overall.todo + overall.in_progress + overall.review, todo: overall.todo, in_progress: overall.in_progress,
    review: overall.review, done: overall.done, doneToday: overall.doneToday, overdue: overall.overdue };
  return { users, overall, totals };
}

async function mySummary(userId) {
  const tasks = await listTasks({ assignee: String(userId) }, { id: userId, role: 'member' });
  const pick = (s) => tasks.filter((t) => t.status === s).map((t) => ({ id: t.id, title: t.title, dueDate: t.dueDate }));
  return { done: pick('done'), review: pick('review'), in_progress: pick('in_progress'), todo: pick('todo') };
}

module.exports = {
  TaskError, STATUSES, createTask, updateTask, applyUpdate, updateTaskStatus, deleteTask, undoTask, praiseTask, listTasks,
  summary, mySummary, getTask, taskDetail, activity, canAssign, canWork, canManage, today,
};
