// Task logic. Reused by routes/tasks.js (source 'manual'), slash commands ('command'), the AI engine ('ai'),
// check-ins ('checkin'), reply chains ('chain') and message edits ('edit'). `actor` is a user object {id, name, role}.
// Functions throw TaskError(status, message, code). Optional `messageId`: chat message that triggered the change
// (stored on the event with its chat id and a text snapshot, shown on the task timeline).
// Round 3 model: task_assignees = one row per person with their OWN status; tasks.status = aggregate (lowest step of the
// active assignees, 'done' only when all are done) or 'closed' (close replaces delete). tasks.assignee_id = primary.
// Permissions: view = boss, an active assignee or the creator. Status (done/undo/any step) = that assignee for their own
// step, or the boss for anyone's; nobody else, not even the creator (R-06). Title/project/assignees = boss, or (membersCanAssign) creator/assignee.
// Description/note = boss, assignee or creator. Create = boss / membersCanAssign / a self-task. Close/reopen/delete = boss only (R-06).
const pool = require('./db');
const rt = require('./realtime');
const settings = require('./settings');
const bot = require('./ai/bot');
const S = require('./status');
const users = require('./users');

class TaskError extends Error {
  constructor(status, message, code) {
    super(message);
    this.status = status;
    this.code = code || (status === 403 ? 'NOT_ALLOWED' : status === 404 ? 'NOT_FOUND' : 'BAD_REQUEST');
  }
}

const STATUSES = S.STATUSES;
const MAX_ASSIGNEES = 10;
const DESC_MAX = 4000;
const RECENT_DAYS = 14; // lists: open tasks + done/closed of the last 14 days unless a status filter asks for more
const isBoss = (u) => !!u && u.role === 'boss';

// Local dates use TZ (default Asia/Kolkata), like check-ins.
const TZ = (() => { try { new Intl.DateTimeFormat('en-US', { timeZone: process.env.TZ }); return process.env.TZ || 'Asia/Kolkata'; } catch (e) { return 'Asia/Kolkata'; } })();
const DAY_FMT = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' });
const today = () => DAY_FMT.format(new Date()); // 'YYYY-MM-DD'
const startOfToday = () => { const d = new Date(); d.setHours(0, 0, 0, 0); return d; }; // compared with completed_at (same mysql2 Date mapping)

const SELECT = `SELECT t.id, t.title, t.description, t.project, t.assignee_id, u.name assignee_name, t.created_by,
  cu.name created_by_name, t.status, t.chat_id, t.source_message_id,
  t.completed_at, t.created_at, t.updated_at, t.reminded_at, t.closed_at, t.closed_by, t.private
  FROM tasks t LEFT JOIN users u ON u.id = t.assignee_id LEFT JOIN users cu ON cu.id = t.created_by WHERE t.deleted_at IS NULL`;
const ASSIGNED = 'EXISTS (SELECT 1 FROM task_assignees ta WHERE ta.task_id = t.id AND ta.user_id = ? AND ta.removed_at IS NULL)';

// Active assignees of some tasks in ONE query -> Map(taskId -> [{id, name, avatarEmoji, status, completedAt, updatedAt}])
async function assigneesFor(ids) {
  const out = new Map();
  if (!ids.length) return out;
  const [rows] = await pool.query(
    `SELECT ta.task_id, ta.user_id, u.name, u.avatar_emoji, ta.status, ta.completed_at, ta.updated_at FROM task_assignees ta
     JOIN users u ON u.id = ta.user_id WHERE ta.task_id IN (?) AND ta.removed_at IS NULL ORDER BY ta.added_at, ta.user_id`, [ids]);
  for (const r of rows) {
    if (!out.has(r.task_id)) out.set(r.task_id, []);
    out.get(r.task_id).push({ id: r.user_id, name: r.name, avatarEmoji: r.avatar_emoji || null, status: r.status,
      completedAt: r.completed_at || null, updatedAt: r.updated_at });
  }
  return out;
}

// ageDays = whole days since created; stale = open and older than the reminder setting (taskReminderDays, 0 = off).
const ageOf = (r) => Math.max(0, Math.floor((Date.now() - new Date(r.created_at).getTime()) / 86400000));
const shape = (r, assignees = []) => {
  const open = S.isOpen(r.status);
  return {
    id: r.id, title: r.title, description: r.description, project: r.project || null,
    assigneeId: r.assignee_id, assigneeName: r.assignee_name, assignees,
    createdBy: r.created_by, createdByName: r.created_by_name || null,
    status: r.status, chatId: r.chat_id || null,
    sourceMessageId: r.source_message_id ? Number(r.source_message_id) : null,
    createdAt: r.created_at, updatedAt: r.updated_at, completedAt: r.completed_at,
    closedAt: r.closed_at || null, closedBy: r.closed_by || null, private: !!r.private,
    ageDays: ageOf(r),
    stale: open && settings.get().taskReminderDays > 0 && ageOf(r) >= settings.get().taskReminderDays,
    remindedAt: r.reminded_at || null,
  };
};
async function shapeRows(rows) {
  const m = await assigneesFor(rows.map((r) => r.id));
  return rows.map((r) => shape(r, m.get(r.id) || []));
}

async function getTask(id) {
  const [rows] = await pool.query(SELECT + ' AND t.id = ?', [parseInt(id, 10) || 0]);
  if (!rows.length) throw new TaskError(404, 'Task not found');
  return (await shapeRows(rows))[0];
}

// ---------- permissions ----------
const isAssignee = (task, u) => !!u && (task.assignees || []).some((a) => a.id === u.id);
// Round 4: a private task (admin's own) is visible to its creator only.
const canView = (task, u) => (task.private ? task.createdBy === u.id : isBoss(u) || isAssignee(task, u) || task.createdBy === u.id);
// Assigning others = boss OR settings.membersCanAssign (owner decision, R-01). Anyone may always create a task for THEMSELVES only.
const canAssign = (actor) => isBoss(actor) || !!settings.get().membersCanAssign;
const canCreate = (actor, ids) => canAssign(actor) || (ids.length === 1 && ids[0] === actor.id);
// done / undo-done = admin (all assignees) + each assignee (own)
const canSetAll = (task, actor) => isBoss(actor);
const canWork = (task, actor) => isAssignee(task, actor) || canSetAll(task, actor);
const canDescribe = (task, actor) => isBoss(actor) || isAssignee(task, actor) || task.createdBy === actor.id;
const canManage = (task, actor) => isBoss(actor) || (canAssign(actor) && (task.createdBy === actor.id || isAssignee(task, actor)));
// R-06: delete (= close) and reopen are admin only; the creator no longer may.
const canClose = (task, actor) => isBoss(actor);

// What a member sees of a task they cannot open (Tasks "Everyone", chat info, DM sheet).
const brief = (t) => ({
  id: t.id, title: t.title, status: t.status, assigneeNames: t.assignees.map((a) => a.name), assigneeIds: t.assignees.map((a) => a.id),
  brief: true,
});
const forViewer = (t, u) => (canView(t, u) ? t : brief(t));

// ---------- events ----------
async function msgInfo(messageId) {
  if (!messageId) return null;
  const [[m]] = await pool.query('SELECT chat_id, body FROM messages WHERE id = ?', [messageId]);
  return m ? { chatId: m.chat_id, text: String(m.body || '').slice(0, 1000) } : null;
}
const evRow = (taskId, actor, type, oldV, newV, source, messageId, src, subjectId = null) => [
  taskId, actor ? actor.id : null, type, oldV == null ? null : String(oldV), newV == null ? null : String(newV), source,
  messageId || null, subjectId, src ? src.chatId : null, src ? src.text : null];
async function writeEvents(rows, conn = pool) {
  if (!rows.length) return null;
  const [r] = await conn.query('INSERT INTO task_events (task_id, actor_id, event, old_value, new_value, source, message_id, subject_id, chat_id, source_text) VALUES ?', [rows]);
  return r.insertId; // first inserted id
}
// -> new event id
async function event(taskId, actor, type, oldV, newV, source, messageId = null, subjectId = null) {
  return writeEvents([evRow(taskId, actor, type, oldV, newV, source, messageId, await msgInfo(messageId), subjectId)]);
}

async function tx(fn) {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const r = await fn(conn);
    await conn.commit();
    return r;
  } catch (e) {
    await conn.rollback().catch(() => {});
    throw e;
  } finally {
    conn.release();
  }
}

// Aggregate status + primary assignee from the active assignee rows (closed tasks keep 'closed').
async function recompute(taskId, conn) {
  const [[t]] = await conn.query('SELECT status, assignee_id FROM tasks WHERE id = ? FOR UPDATE', [taskId]);
  const [rows] = await conn.query(
    'SELECT user_id, status FROM task_assignees WHERE task_id = ? AND removed_at IS NULL ORDER BY added_at, user_id', [taskId]);
  const primary = rows.some((r) => r.user_id === t.assignee_id) ? t.assignee_id : (rows[0] ? rows[0].user_id : t.assignee_id);
  if (t.status === 'closed') {
    await conn.query('UPDATE tasks SET assignee_id = ? WHERE id = ?', [primary, taskId]);
    return;
  }
  const agg = S.aggregate(rows.map((r) => r.status));
  await conn.query(
    "UPDATE tasks SET status = ?, completed_at = IF(? = 'done', COALESCE(completed_at, NOW()), NULL), assignee_id = ? WHERE id = ?",
    [agg, agg, primary, taskId]);
}

// ---------- notify ----------
// Admin alert flag for the app: a member (not the boss) changed a task, switch on, and the task's chat allows it.
// Check-in driven changes never alert the boss (check-ins are pull-only for him).
async function notifyAdminFor(task, actor, source) {
  if (!actor || isBoss(actor) || source === 'checkin') return false;
  const s = await settings.all();
  if (!s.notifyAdminOnMemberChanges) return false;
  return task.chatId ? (await settings.forChat(task.chatId)).notifyAdmin : true;
}

// Push the task to every active assignee, creator, actor, every boss and extra ids (removed assignees, an asker).
// ws: {type:'task', task, event, actorId, actorName, notifyAdmin}.
async function notify(task, ev, actor, source, extraIds = []) {
  const ids = new Set(task.private ? [] : await users.bossIds()); // private task: only its creator hears about it
  if (!task.private) task.assignees.forEach((a) => ids.add(a.id));
  [task.createdBy, actor && actor.id, ...(task.private ? [] : extraIds)].forEach((i) => i && ids.add(i));
  const meta = { event: ev, actorId: actor ? actor.id : null, actorName: (actor && actor.name) || null,
    notifyAdmin: await notifyAdminFor(task, actor, source) };
  const msg = { type: 'task', task, ...meta };
  ids.forEach((i) => rt.sendToUser(i, msg));
  // keep the members' pinned "today" check-in cards live (debounced; no-op for bosses / no card yet)
  const cards = require('./checkins');
  new Set([...task.assignees.map((a) => a.id), ...extraIds]).forEach((i) => i && cards.refreshDaySoon(i));
}

// ---------- validation ----------
function cleanProject(v) {
  if (v == null) return null;
  const p = String(v).trim();
  if (p.length > 60) throw new TaskError(400, 'Project too long');
  return p || null;
}

function cleanDesc(v) {
  if (v == null || v === '') return null;
  const d = String(v);
  if (d.length > DESC_MAX) throw new TaskError(400, 'Description too long (max ' + DESC_MAX + ')');
  return d;
}

function cleanIds(v) {
  const list = (Array.isArray(v) ? v : [v]).map((n) => parseInt(n, 10)).filter((n) => n > 0);
  const ids = [...new Set(list)];
  if (ids.length > MAX_ASSIGNEES) throw new TaskError(400, 'Max ' + MAX_ASSIGNEES + ' assignees');
  return ids;
}

async function checkUsers(ids) {
  if (!ids.length) return;
  const [rows] = await pool.query('SELECT id FROM users WHERE id IN (?) AND active = 1 AND is_bot = 0', [ids]);
  if (rows.length !== ids.length) throw new TaskError(400, 'Invalid assignee');
}

const closedError = () => new TaskError(400, 'This task is closed. Reopen it first.', 'TASK_CLOSED');

// ---------- create ----------
// {title, description?, assigneeIds:[..] | assigneeId, project?, chatId?} (a dueDate sent by an old app is ignored, R-07)
async function createTask({ title, description, assigneeIds, assigneeId, project, chatId }, actor, source = 'manual', messageId = null) {
  await settings.all();
  const ids = cleanIds(assigneeIds !== undefined && assigneeIds !== null ? assigneeIds : [assigneeId]);
  if (!ids.length) throw new TaskError(400, 'Invalid assignee');
  if (!canCreate(actor, ids)) throw new TaskError(403, 'Only an admin can give tasks to others (you can create tasks for yourself)', 'NOT_ALLOWED');
  title = String(title || '').trim();
  if (!title) throw new TaskError(400, 'Title is required');
  if (title.length > 255) throw new TaskError(400, 'Title too long');
  const desc = cleanDesc(description);
  await checkUsers(ids);
  const proj = cleanProject(project);
  let chat = parseInt(chatId, 10) || null;
  if (chat && !(await rt.isChatMember(chat, actor.id))) chat = null;
  const src = await msgInfo(messageId);
  const priv = isBoss(actor) && ids.length === 1 && ids[0] === actor.id ? 1 : 0; // admin assigns only himself -> private (a member self-task stays visible to admin)
  const id = await tx(async (conn) => {
    const [r] = await conn.query(
      'INSERT INTO tasks (title, description, project, assignee_id, created_by, source_message_id, chat_id, private) VALUES (?,?,?,?,?,?,?,?)',
      [title, desc, proj, ids[0], actor.id, messageId, chat, priv]);
    await conn.query('INSERT INTO task_assignees (task_id, user_id, added_by) VALUES ?', [ids.map((u) => [r.insertId, u, actor.id])]);
    await writeEvents([evRow(r.insertId, actor, 'created', null, title, source, messageId, src)], conn);
    return r.insertId;
  });
  const task = await getTask(id);
  await notify(task, 'created', actor, source);
  return task;
}

// Card/ws event name: reassigned | completed (task done) | <status key> (one person's step) | note | updated
function eventFor(changes, task, setStatus) {
  if (changes.has('assignee')) return 'reassigned';
  if (changes.has('status')) return task.status === 'done' ? 'completed' : setStatus && setStatus !== 'todo' ? setStatus : 'updated';
  if (changes.has('note') && changes.size === 1) return 'note';
  return 'updated';
}

const FIELDS = ['status', 'title', 'description', 'project', 'assigneeId', 'assigneeIds', 'addAssigneeIds', 'removeAssigneeIds', 'note'];
const ASSIGNEE_FIELDS = ['assigneeId', 'assigneeIds', 'addAssigneeIds', 'removeAssigneeIds'];

// fields: any of FIELDS (+ userId / userIds = whose status; default me if I am an assignee, else all for boss/creator)
// -> {task, event, changed, before}. note = progress note (task_events 'note', text in new_value).
// opts: {asCreator: creator editing his own source message, notifyIds: extra ws recipients, eventName}
async function applyUpdate(id, f, actor, source = 'manual', messageId = null, opts = {}) {
  await settings.all();
  f = f && typeof f === 'object' ? f : {};
  const keys = FIELDS.filter((k) => f[k] !== undefined);
  if (!keys.length && f.dueDate === undefined) throw new TaskError(400, 'Nothing to update');
  const task = await getTask(id);
  if (task.private && task.createdBy !== actor.id) throw new TaskError(403, 'Not allowed'); // Round 4: private = creator only
  if (!keys.length) { // R-07: an old app sent only a due date; due dates no longer exist, so it is a no-op (not an error)
    if (!canView(task, actor)) throw new TaskError(403, 'Not allowed');
    return { task, event: 'updated', changed: false, before: task };
  }
  const trusted = !!opts.asCreator && task.createdBy === actor.id;
  const allowed = (k) => (k === 'status' ? true
    : k === 'note' || k === 'description' ? trusted || canDescribe(task, actor) || canWork(task, actor) : trusted || canManage(task, actor));
  if (!keys.every(allowed)) throw new TaskError(403, 'Not allowed');
  const closed = task.status === 'closed';
  let status = null;
  if (f.status !== undefined) {
    status = S.norm(f.status);
    if (!status) throw new TaskError(400, 'Invalid status');
  }
  if (closed && (status || keys.some((k) => ASSIGNEE_FIELDS.includes(k)))) throw closedError();

  // whose status
  let targets = [];
  if (status) {
    const want = f.userIds !== undefined && f.userIds !== null ? cleanIds(f.userIds) : f.userId != null ? cleanIds([f.userId]) : [];
    if (want.length) {
      if (!want.every((u) => task.assignees.some((a) => a.id === u))) throw new TaskError(400, 'Not an assignee of this task');
      if (want.some((u) => u !== actor.id) && !canSetAll(task, actor)) throw new TaskError(403, 'Not allowed');
      targets = want;
    } else if (canSetAll(task, actor)) targets = task.assignees.map((a) => a.id); // admin tick = done for all
    else if (isAssignee(task, actor)) targets = [actor.id];
    else throw new TaskError(403, 'Not allowed');
  }

  let note = null;
  if (f.note !== undefined) {
    note = String(f.note || '').trim();
    if (!note || note.length > 1000) throw new TaskError(400, 'Invalid note');
  }

  // assignee set
  const cur = task.assignees.map((a) => a.id);
  let add = []; let remove = []; let primary = null;
  const replace = f.assigneeIds !== undefined ? cleanIds(f.assigneeIds) : f.assigneeId !== undefined ? cleanIds([f.assigneeId]) : null;
  if (replace) {
    if (!replace.length) throw new TaskError(400, 'Invalid assignee');
    add = replace.filter((i) => !cur.includes(i));
    remove = cur.filter((i) => !replace.includes(i));
    if (replace[0] !== task.assigneeId) primary = replace[0];
  }
  if (f.addAssigneeIds !== undefined) add = [...new Set([...add, ...cleanIds(f.addAssigneeIds).filter((i) => !cur.includes(i))])];
  if (f.removeAssigneeIds !== undefined) remove = [...new Set([...remove, ...cleanIds(f.removeAssigneeIds).filter((i) => cur.includes(i))])];
  const final = [...cur.filter((i) => !remove.includes(i)), ...add];
  if (!final.length) throw new TaskError(400, 'At least one assignee is required', 'LAST_ASSIGNEE');
  if (final.length > MAX_ASSIGNEES) throw new TaskError(400, 'Max ' + MAX_ASSIGNEES + ' assignees');
  await checkUsers(add);

  const src = await msgInfo(messageId);
  const evs = [];
  const E = (type, o, n, subj = null) => evs.push(evRow(id, actor, type, o, n, source, messageId, src, subj));
  const changes = new Set();
  const set = []; const vals = [];
  if (f.title !== undefined) {
    const t = String(f.title).trim();
    if (!t || t.length > 255) throw new TaskError(400, 'Invalid title');
    if (t !== task.title) { set.push('title = ?'); vals.push(t); E('title', task.title, t); changes.add('title'); }
  }
  if (f.description !== undefined) {
    const d = cleanDesc(f.description);
    if (d !== task.description) { set.push('description = ?'); vals.push(d); E('description', task.description, d); changes.add('description'); }
  }
  if (f.project !== undefined) {
    const p = cleanProject(f.project);
    if (p !== task.project) { set.push('project = ?'); vals.push(p); E('project', task.project, p); changes.add('project'); }
  }
  // Round 4: a private task given to someone else becomes a normal (visible) task
  if (task.private && final.some((i) => i !== task.createdBy)) set.push('private = 0');

  await tx(async (conn) => {
    if (set.length) await conn.query('UPDATE tasks SET ' + set.join(', ') + ' WHERE id = ?', [...vals, id]);
    for (const u of add) {
      await conn.query(
        "INSERT INTO task_assignees (task_id, user_id, status, added_by) VALUES (?, ?, 'todo', ?) ON DUPLICATE KEY UPDATE " +
        "removed_at = NULL, status = 'todo', completed_at = NULL, added_by = VALUES(added_by), added_at = NOW()", [id, u, actor.id]);
      E('assignee_add', null, u);
    }
    for (const u of remove) {
      await conn.query('UPDATE task_assignees SET removed_at = NOW() WHERE task_id = ? AND user_id = ?', [id, u]);
      E('assignee_remove', u, null);
    }
    if (primary) await conn.query('UPDATE tasks SET assignee_id = ? WHERE id = ?', [primary, id]);
    if (add.length || remove.length) changes.add('assignee');
    for (const u of targets) {
      const a = task.assignees.find((x) => x.id === u);
      if (!a || remove.includes(u) || a.status === status) continue;
      await conn.query(
        "UPDATE task_assignees SET status = ?, completed_at = IF(? = 'done', NOW(), NULL) WHERE task_id = ? AND user_id = ?",
        [status, status, id, u]);
      E('status', a.status, status, u);
      changes.add('status');
    }
    if (note) { E('note', null, note); changes.add('note'); }
    await writeEvents(evs, conn);
    if (changes.has('status') || changes.has('assignee')) await recompute(id, conn);
  });
  const fresh = await getTask(id);
  const name = opts.eventName || eventFor(changes, fresh, status);
  if (changes.size || opts.eventName) await notify(fresh, name, actor, source, [...remove, ...(opts.notifyIds || [])]);
  if (source === 'manual' && changes.has('status') && status === 'done') await doneCard(fresh, actor);
  return { task: fresh, event: name, changed: changes.size > 0, before: task };
}

// R-04s: done ticked in the Tasks tab (source 'manual') leaves a public bot card so the other side is told in chat as well
// as by the ws 'task' event. Card goes to the chat the task was made in (when the actor is still in it), else to the DM between
// the actor and the other party (boss -> the assignees; member -> the creator, or the first boss for a self-task).
// Private tasks post nothing. Never fails the update.
async function doneCard(task, actor) {
  try {
    if (task.private) return;
    if (task.chatId && (await rt.isChatMember(task.chatId, actor.id))) {
      await bot.taskCard(task.chatId, 'completed', task, actor);
      return;
    }
    let others;
    if (isBoss(actor)) others = task.assignees.map((a) => a.id).filter((i) => i !== actor.id);
    else {
      const bosses = (await users.bossIds()).filter((i) => i !== actor.id);
      others = [task.createdBy && task.createdBy !== actor.id ? task.createdBy : bosses[0]].filter(Boolean);
    }
    for (const other of [...new Set(others)].slice(0, 5)) {
      const { chatId } = await bot.ensureDm(actor.id, other);
      await bot.taskCard(chatId, 'completed', task, actor);
    }
  } catch (e) { console.error('done card:', e.message); }
}

const updateTask = async (id, f, actor, source = 'manual', messageId = null) =>
  (await applyUpdate(id, f, actor, source, messageId)).task;

async function updateTaskStatus(id, status, actor, source = 'manual', messageId = null) {
  if (!S.norm(status)) throw new TaskError(400, 'Invalid status');
  return updateTask(id, { status }, actor, source, messageId);
}

// ---------- close / reopen (replaces delete) ----------
async function closeTask(id, actor, source = 'manual', messageId = null, reason = null) {
  const task = await getTask(id);
  if (task.private && task.createdBy !== actor.id) throw new TaskError(403, 'Not allowed'); // Round 4: private = creator only
  if (!canClose(task, actor)) throw new TaskError(403, 'Not allowed');
  if (task.status === 'closed') throw new TaskError(400, 'Task is already closed', 'ALREADY_CLOSED');
  const why = reason == null ? null : String(reason).trim();
  if (why && why.length > 300) throw new TaskError(400, 'Reason too long (max 300)');
  const src = await msgInfo(messageId);
  await tx(async (conn) => {
    await conn.query("UPDATE tasks SET status = 'closed', closed_at = NOW(), closed_by = ? WHERE id = ?", [actor.id, id]);
    await writeEvents([evRow(id, actor, 'closed', task.status, why || null, source, messageId, src)], conn);
  });
  const fresh = await getTask(id);
  await notify(fresh, 'closed', actor, source);
  return fresh;
}

async function reopenTask(id, actor, source = 'manual', messageId = null) {
  const task = await getTask(id);
  if (task.private && task.createdBy !== actor.id) throw new TaskError(403, 'Not allowed'); // Round 4: private = creator only
  if (!canClose(task, actor)) throw new TaskError(403, 'Not allowed');
  if (task.status !== 'closed') throw new TaskError(400, 'Task is not closed', 'NOT_CLOSED');
  const src = await msgInfo(messageId);
  await tx(async (conn) => {
    await conn.query("UPDATE tasks SET status = 'todo', closed_at = NULL, closed_by = NULL WHERE id = ?", [id]);
    await recompute(id, conn);
    await writeEvents([evRow(id, actor, 'reopened', 'closed', null, source, messageId, src)], conn);
  });
  const fresh = await getTask(id);
  await notify(fresh, 'reopened', actor, source);
  return fresh;
}

// Old clients / old /delete: DELETE = close.
const deleteTask = (id, actor, source = 'manual', messageId = null) => closeTask(id, actor, source, messageId);

// Revert the most recent status change (that person, or boss/creator for anyone).
async function undoTask(id, actor, source = 'manual') {
  await settings.all();
  const task = await getTask(id);
  if (task.private && task.createdBy !== actor.id) throw new TaskError(403, 'Not allowed'); // Round 4: private = creator only
  if (task.status === 'closed') throw closedError();
  const [[ev]] = await pool.query(
    "SELECT old_value, subject_id FROM task_events WHERE task_id = ? AND event = 'status' ORDER BY id DESC LIMIT 1", [id]);
  const old = ev && S.norm(ev.old_value);
  if (!old) throw new TaskError(400, 'Nothing to undo');
  const who = ev.subject_id ? [ev.subject_id] : task.assignees.map((a) => a.id);
  if (!who.every((u) => task.assignees.some((a) => a.id === u))) throw new TaskError(400, 'Nothing to undo');
  return (await applyUpdate(id, { status: old, userIds: who }, actor, source)).task;
}

// Praise (boss or the task creator; setting praiseEnabled). Card goes to the task's chat if the primary assignee is in
// it, else to the DM between the praiser and the primary assignee.
async function praiseTask(id, actor, text) {
  const s = await settings.all();
  if (!s.praiseEnabled) throw new TaskError(403, 'Praise is turned off');
  const task = await getTask(id);
  if (task.private && task.createdBy !== actor.id) throw new TaskError(403, 'Not allowed'); // Round 4: private = creator only
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

// ---------- detail / timeline ----------
const ID_EVENTS = ['assignee', 'assignee_add', 'assignee_remove'];
const eventShape = (r, names) => {
  const v = (x) => (ID_EVENTS.includes(r.event) && x != null ? (names.get(Number(x)) || {}).name || x : x);
  return {
    id: Number(r.id), event: r.event, oldValue: v(r.old_value), newValue: v(r.new_value),
    actorId: r.actor_id, actorName: r.actor_name || null, source: r.source, createdAt: r.created_at,
    subjectId: r.subject_id || null, subjectName: r.subject_id ? (names.get(r.subject_id) || {}).name || null : null,
  };
};
const EVENT_SELECT = 'SELECT e.id, e.task_id, e.event, e.old_value, e.new_value, e.actor_id, au.name actor_name, e.source, e.created_at, ' +
  'e.subject_id FROM task_events e LEFT JOIN users au ON au.id = e.actor_id ';
const SOURCE_SELECT = 'SELECT e.id, e.task_id, e.event, e.old_value, e.new_value, e.actor_id, au.name actor_name, e.source, e.created_at, ' +
  'e.subject_id, e.message_id, e.chat_id, e.source_text, m.id m_id, m.chat_id m_chat, m.body m_body, m.deleted_at m_deleted, ' +
  'm.created_at m_at, mu.name m_sender, c.name c_name, c.type c_type, rm.body r_body, rm.deleted_at r_deleted, ru.name r_sender ' +
  'FROM task_events e LEFT JOIN users au ON au.id = e.actor_id LEFT JOIN messages m ON m.id = e.message_id ' +
  'LEFT JOIN users mu ON mu.id = m.sender_id LEFT JOIN chats c ON c.id = COALESCE(m.chat_id, e.chat_id) ' +
  'LEFT JOIN messages rm ON rm.id = m.reply_to_id LEFT JOIN users ru ON ru.id = rm.sender_id ';

async function myChatIds(userId) {
  const [rows] = await pool.query('SELECT cm.chat_id ' + rt.MEMBER_FROM + 'WHERE cm.user_id = ? AND cm.left_at IS NULL AND ' + rt.MEMBER_OK, [userId]);
  return new Set(rows.map((r) => r.chat_id));
}

// Timeline source: text only when the viewer is a current member of that chat; purged message -> snapshot, available false.
function sourceOf(r, mine) {
  if (!r.message_id) return null;
  const chatId = r.m_chat || r.chat_id || null;
  const member = !!chatId && mine.has(chatId);
  const gone = !r.m_id;
  return {
    messageId: Number(r.message_id), chatId: member ? chatId : null,
    chatName: member ? (r.c_type === 'dm' ? 'Direct message' : r.c_type === 'checkin' ? 'Daily Check-in' : r.c_name) : null,
    chatType: member ? r.c_type : null,
    senderName: member ? r.m_sender || r.actor_name || null : null,
    text: member ? (gone ? r.source_text || null : r.m_deleted ? null : r.m_body) : null,
    replyTo: member && r.m_id && r.r_body != null ? { senderName: r.r_sender || '', text: r.r_deleted ? null : String(r.r_body).slice(0, 200) } : null,
    createdAt: r.m_at || r.created_at, available: !gone && !r.m_deleted, deleted: !!r.m_deleted,
  };
}

// GET /tasks/:id -> {task, events} (oldest first). Only viewers (boss, assignee, creator).
async function taskDetail(id, viewer) {
  const task = await getTask(id);
  if (viewer && !canView(task, viewer)) throw new TaskError(403, 'Not allowed');
  const [rows] = await pool.query(SOURCE_SELECT + 'WHERE e.task_id = ? ORDER BY e.id', [task.id]);
  const names = await users.all();
  const mine = viewer ? await myChatIds(viewer.id) : new Set();
  return { task, events: rows.map((r) => ({ ...eventShape(r, names), source: sourceOf(r, mine) })) };
}

// GET /tasks/activity -> newest first. Members: only events of tasks they can view. since = ISO time (optional).
async function activity({ limit, since }, actor) {
  const n = Math.min(Math.max(parseInt(limit, 10) || 50, 1), 200);
  const vals = [actor ? actor.id : 0];
  let where = "WHERE e.event <> 'description' AND t.deleted_at IS NULL AND (t.private = 0 OR t.created_by = ?) ";
  if (since) {
    const d = new Date(String(since));
    if (isNaN(d)) throw new TaskError(400, 'Invalid since');
    where += 'AND e.created_at >= ? '; vals.push(d);
  }
  if (actor && !isBoss(actor)) { where += 'AND (t.created_by = ? OR ' + ASSIGNED + ') '; vals.push(actor.id, actor.id); }
  const [rows] = await pool.query(
    EVENT_SELECT.replace(' FROM', ', t.title task_title, t.status task_status, t.assignee_id, tu.name assignee_name FROM') +
    'JOIN tasks t ON t.id = e.task_id LEFT JOIN users tu ON tu.id = t.assignee_id ' + where + 'ORDER BY e.id DESC LIMIT ?',
    [...vals, n]);
  const names = await users.all();
  return {
    events: rows.map((r) => ({
      ...eventShape(r, names), taskId: r.task_id, taskTitle: r.task_title, taskStatus: r.task_status,
      assigneeId: r.assignee_id, assigneeName: r.assignee_name,
    })),
  };
}

// ---------- lists ----------
// GET /tasks ?scope=mine|everyone|all &status (key | open | closed) &q &project &assignee=<id> &with=<userId> &limit &before
// Boss: scope all (default), full shape. Member: mine (default) = assigned to me OR created by me, full shape;
// everyone = everyone's non-closed tasks, brief shape ({id,title,status,assigneeNames,assigneeIds,brief:true}) except the
// ones I can view. with=<userId>: tasks shared by me and that user (boss: all of that user's tasks), full shape.
async function listTasks(query, actor) {
  const q = query || {};
  const boss = isBoss(actor);
  let scope = q.scope;
  if (!['mine', 'everyone', 'all'].includes(scope)) scope = q.assignee === 'all' ? (boss ? 'all' : 'everyone') : boss ? 'all' : 'mine';
  if (!boss && scope === 'all') scope = 'everyone';
  const limit = Math.min(Math.max(parseInt(q.limit, 10) || 200, 1), 200);
  let sql = SELECT + ' AND (t.private = 0 OR t.created_by = ?)'; const vals = [actor.id]; // private tasks: creator only
  const withId = parseInt(q.with, 10) || 0;
  // ids=1,2,3: those tasks only (private rule above still applies); no scope / recent-done filter (chat cards need the current state)
  const idList = q.ids ? String(q.ids).split(',').map((x) => parseInt(x, 10)).filter((x) => x > 0).slice(0, 100) : [];
  if (idList.length) { sql += ' AND t.id IN (?)'; vals.push(idList); if (!boss) scope = 'everyone'; } else
  if (withId) {
    if (boss) { sql += ' AND (t.created_by = ? OR ' + ASSIGNED + ')'; vals.push(withId, withId); } else {
      sql += ` AND ((t.created_by = ? AND ${ASSIGNED}) OR (t.created_by = ? AND ${ASSIGNED}) OR (${ASSIGNED} AND ${ASSIGNED}))`;
      vals.push(actor.id, withId, withId, actor.id, actor.id, withId);
    }
  } else if (scope === 'mine') {
    sql += ' AND (t.created_by = ? OR ' + ASSIGNED + ')'; vals.push(actor.id, actor.id);
  }
  if (q.assignee && q.assignee !== 'all') { sql += ' AND ' + ASSIGNED; vals.push(parseInt(q.assignee, 10) || 0); }
  if (idList.length) { /* no status filter */ } else if (q.status) {
    if (q.status === 'open') sql += " AND t.status NOT IN ('done', 'closed')";
    else {
      const st = q.status === 'closed' ? 'closed' : S.norm(q.status);
      if (!st) throw new TaskError(400, 'Invalid status');
      sql += ' AND t.status = ?'; vals.push(st);
    }
  } else {
    sql += " AND (t.status NOT IN ('done', 'closed') OR COALESCE(t.closed_at, t.completed_at, t.updated_at) >= NOW() - INTERVAL ? DAY)";
    vals.push(RECENT_DAYS);
  }
  if (!boss && scope === 'everyone' && !withId && !idList.length) sql += " AND t.status <> 'closed'";
  if (q.project) { sql += ' AND t.project = ?'; vals.push(String(q.project).slice(0, 60)); }
  if (q.q) {
    const s = String(q.q).trim().slice(0, 100);
    const idm = s.match(/^#?(\d{1,9})$/);
    if (idm) { sql += ' AND t.id = ?'; vals.push(Number(idm[1])); } else {
      sql += ' AND (t.title LIKE ? OR t.description LIKE ? OR t.project LIKE ?)'; vals.push('%' + s + '%', '%' + s + '%', '%' + s + '%');
    }
  }
  const before = parseInt(q.before, 10) || 0;
  if (before) { sql += ' AND t.id < ?'; vals.push(before); }
  sql += before ? ' ORDER BY t.id DESC' : " ORDER BY t.status IN ('done', 'closed'), t.id DESC";
  sql += ' LIMIT ?'; vals.push(limit);
  const [rows] = await pool.query(sql, vals);
  const tasks = await shapeRows(rows);
  return boss || withId || scope === 'mine' ? tasks : tasks.map((t) => forViewer(t, actor));
}

// Internal: tasks a user is an active assignee of (not closed; open + done in the last 14 days), each with myStatus.
async function assignedTo(userId, viewerId = userId) {
  const [rows] = await pool.query(SELECT + " AND (t.private = 0 OR t.created_by = " + (parseInt(viewerId, 10) || 0) + ") AND t.status <> 'closed' AND " + ASSIGNED +
    ` AND (t.status <> 'done' OR COALESCE(t.completed_at, t.updated_at) >= NOW() - INTERVAL ${RECENT_DAYS} DAY)` +
    " ORDER BY t.status = 'done', t.id DESC LIMIT 500", [userId]);
  const tasks = await shapeRows(rows);
  return tasks.map((t) => {
    const me = t.assignees.find((a) => a.id === userId);
    return { ...t, myStatus: me ? me.status : t.status, myCompletedAt: me ? me.completedAt : null };
  });
}

const COUNT_KEYS = ['total', ...STATUSES, 'overdue', 'doneToday'];

// Per person (own status in task_assignees, closed tasks excluded) + team totals (by task). Member: only own row.
async function summary(actor) {
  const sums = STATUSES.map((s) => `COALESCE(SUM(ta.status = '${s}'), 0) ${s}`).join(', ');
  const [rows] = await pool.query(
    `SELECT u.id, u.name, u.avatar_emoji, COUNT(ta.task_id) total, ${sums},
       COALESCE(SUM(ta.status = 'done' AND ta.completed_at >= ?), 0) done_today
     FROM users u
     LEFT JOIN task_assignees ta ON ta.user_id = u.id AND ta.removed_at IS NULL
       AND EXISTS (SELECT 1 FROM tasks t2 WHERE t2.id = ta.task_id AND t2.deleted_at IS NULL AND t2.status <> 'closed' AND (t2.private = 0 OR t2.created_by = ?))
     LEFT JOIN tasks t ON t.id = ta.task_id
     WHERE u.active = 1 AND u.is_bot = 0 GROUP BY u.id, u.name, u.avatar_emoji ORDER BY u.name`, [startOfToday(), actor ? actor.id : 0]);
  let list = rows.map((r) => {
    const o = { id: r.id, name: r.name, avatarEmoji: r.avatar_emoji || null, total: Number(r.total), overdue: 0, // overdue: always 0, kept so old apps that read it still work (R-07)
      doneToday: Number(r.done_today) };
    for (const s of STATUSES) o[s] = Number(r[s]);
    return o;
  });
  const [[tt]] = await pool.query(
    `SELECT ${STATUSES.map((s) => `COALESCE(SUM(status = '${s}'), 0) ${s}`).join(', ')}, COALESCE(SUM(status = 'closed'), 0) closed,
       COALESCE(SUM(status = 'done' AND completed_at >= ?), 0) done_today
     FROM tasks WHERE deleted_at IS NULL AND (private = 0 OR created_by = ?)`, [startOfToday(), actor ? actor.id : 0]);
  const totals = { open: 0, doneToday: Number(tt.done_today), overdue: 0, closed: Number(tt.closed) };
  for (const s of STATUSES) { totals[s] = Number(tt[s]); if (s !== 'done') totals.open += totals[s]; }
  if (actor && !isBoss(actor)) list = list.filter((u) => u.id === actor.id);
  const overall = {};
  for (const k of COUNT_KEYS) overall[k] = list.reduce((a, u) => a + u[k], 0);
  return { users: list, overall, totals };
}

// {todo:[], planning:[], coding:[], testing:[], change_merged:[], done:[]} by the user's own status (done = recent).
async function mySummary(userId, viewerId = userId) {
  const tasks = await assignedTo(userId, viewerId);
  const out = {};
  for (const s of STATUSES) {
    out[s] = tasks.filter((t) => t.myStatus === s).map((t) => ({ id: t.id, title: t.title }));
  }
  return out;
}

// Message -> task link (messages.task_id), e.g. after a command resolved its task.
async function linkMessage(messageId, taskId) {
  if (messageId && taskId) await pool.query('UPDATE messages SET task_id = ? WHERE id = ? AND task_id IS NULL', [taskId, messageId]);
}

module.exports = {
  TaskError, STATUSES, createTask, updateTask, applyUpdate, updateTaskStatus, deleteTask, closeTask, reopenTask, undoTask,
  praiseTask, listTasks, assignedTo, summary, mySummary, getTask, taskDetail, activity, canAssign, canCreate, canWork, canManage,
  canDescribe, canView, canClose, canSetAll, isAssignee, brief, forViewer, today, startOfToday, SELECT, shape, shapeRows, event,
  notify, linkMessage,
};
