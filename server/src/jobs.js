// In-process daily/weekly jobs (1-minute tick, local time TZ like the check-in scheduler). Each job runs once per local
// day; the last run date is stored in app_settings 'job.<name>.lastRun' (restarts never repeat a job the same day).
// - purge (Sunday >= 23:00, needs retentionEnabled): HARD-deletes messages older than messageRetentionDays (7) in every
//   chat, except each chat's pinned message and today's check-in cards; reactions/revisions of them deleted, replies,
//   card source links and task source links set NULL (task timelines keep a text snapshot in task_events.source_text). A JSON dump goes to server/backup/purge-YYYY-MM-DD.json first.
//   (Owner's explicit request: real deletion for retention only; everything else stays soft delete.)
// - reminders (daily >= check-in morningTime, taskReminderDays > 0): open tasks created >= N days ago get ONE reminder
//   (tasks.reminded_at): card in the Daily Check-in chat of every assignee not done yet (mentions them -> notification)
//   + ws {type:'task_stale', task, days} to bosses and those assignees (Tasks tab "6+ din pending").
// - taskcleanup (daily >= 01:00, needs retentionEnabled): HARD-deletes ONLY done or closed tasks (+ assignees, events)
//   whose completed_at / closed_at is >= taskDeleteDays (14) days ago; open tasks are never deleted. Dump to
//   server/backup/tasks-YYYY-MM-DD.json first; ws {type:'tasks_purged', taskIds}.
// - morning / evening / summary: the check-in cards (checkins.js runs them on its own tick; here only for POST /admin/jobs/run).
// resetAll(): admin "Reset app data" (POST /admin/reset).
const fs = require('fs');
const path = require('path');
const pool = require('./db');
const rt = require('./realtime');
const settings = require('./settings');
const backup = require('./backup');
const checkins = require('./checkins');
const bot = require('./ai/bot');
const T = require('./tasks');
const users = require('./users');

const CHUNK = 500;
const chunks = (a) => { const out = []; for (let i = 0; i < a.length; i += CHUNK) out.push(a.slice(i, i + CHUNK)); return out; };

function dump(prefix, data) {
  fs.mkdirSync(backup.DIR, { recursive: true });
  const file = path.join(backup.DIR, prefix + '-' + checkins.localNow().date + '.json');
  // same day twice (manual run): keep both
  const out = fs.existsSync(file) ? file.replace(/\.json$/, '-' + Date.now() + '.json') : file;
  fs.writeFileSync(out, JSON.stringify({ exportedAt: new Date().toISOString(), ...data }));
  return out;
}

// ---------- purge old messages ----------
async function runPurge() {
  const s = await settings.all();
  const days = s.messageRetentionDays;
  const today = checkins.localNow().date;
  const [ids] = await pool.query(
    `SELECT m.id FROM messages m WHERE m.created_at < NOW() - INTERVAL ? DAY
       AND m.id NOT IN (SELECT pinned_message_id FROM chats WHERE pinned_message_id IS NOT NULL)
       AND m.id NOT IN (SELECT message_id FROM checkin_prompts WHERE date = ? AND message_id IS NOT NULL)`, [days, today]);
  const all = ids.map((r) => r.id);
  if (!all.length) return { deleted: 0, file: null };
  const data = { job: 'purge', retentionDays: days, messages: [], message_reactions: [], message_revisions: [] };
  for (const part of chunks(all)) {
    data.messages.push(...(await pool.query('SELECT * FROM messages WHERE id IN (?)', [part]))[0]);
    data.message_reactions.push(...(await pool.query('SELECT * FROM message_reactions WHERE message_id IN (?)', [part]))[0]);
    data.message_revisions.push(...(await pool.query('SELECT * FROM message_revisions WHERE message_id IN (?)', [part]))[0]);
  }
  const file = dump('purge', data);
  for (const part of chunks(all)) {
    await pool.query('DELETE FROM message_reactions WHERE message_id IN (?)', [part]);
    await pool.query('DELETE FROM message_revisions WHERE message_id IN (?)', [part]);
    await pool.query('UPDATE messages SET reply_to_id = NULL WHERE reply_to_id IN (?)', [part]);
    await pool.query('UPDATE messages SET source_message_id = NULL WHERE source_message_id IN (?)', [part]);
    await pool.query('UPDATE tasks SET source_message_id = NULL WHERE source_message_id IN (?)', [part]);
    await pool.query('UPDATE checkin_prompts SET message_id = NULL WHERE message_id IN (?)', [part]);
    await pool.query('DELETE FROM messages WHERE id IN (?)', [part]);
  }
  // Round 4: media files of purged messages are deleted with them (the dump above keeps media_url for reference), unless a
  // newer message (a forward shares the file) or a profile photo still uses the same file
  for (const url of new Set(data.messages.map((m) => m.media_url).filter(Boolean))) {
    const [[used]] = await pool.query('SELECT (SELECT COUNT(*) FROM messages WHERE media_url = ?) + (SELECT COUNT(*) FROM users WHERE avatar_url = ?) n', [url, url]);
    if (!Number(used.n)) {
      require('./routes/media').removeFile(url);
      await pool.query('DELETE FROM media_files WHERE path = ?', [url]); // B-03 uploader record goes with the file
    }
  }
  rt.sendToAll({ type: 'purged' });
  return { deleted: all.length, file: path.basename(file) };
}

// ---------- 6-day pending reminders ----------
async function runReminders() {
  const s = await settings.all();
  const days = s.taskReminderDays;
  if (!days) return { reminded: 0 };
  const [rows] = await pool.query(
    `SELECT t.id FROM tasks t WHERE t.deleted_at IS NULL AND t.status NOT IN ('done', 'closed')
       AND t.private = 0 AND t.reminded_at IS NULL AND t.created_at <= NOW() - INTERVAL ? DAY ORDER BY t.id`, [days]);
  const [bosses] = await pool.query("SELECT id FROM users WHERE role = 'boss' AND active = 1");
  let n = 0;
  for (const r of rows) {
    // claim first: only one process / run reminds a task
    const [claim] = await pool.query('UPDATE tasks SET reminded_at = NOW() WHERE id = ? AND reminded_at IS NULL', [r.id]);
    if (!claim.affectedRows) continue;
    try {
      const task = await T.getTask(r.id);
      const pending = [];
      for (const a of task.assignees.filter((x) => x.status !== 'done')) {
        const u = await users.get(a.id);
        if (u && u.active) pending.push(a);
      }
      for (const a of pending) {
        const chatId = await checkins.ensureChat(a.id); // null for a boss
        if (chatId) {
          await bot.postBot(chatId, 'This task has been pending for ' + task.ageDays + ' days, please complete it: Task ' + task.id + ' - ' + task.title,
            { kind: 'reminder', task, days: task.ageDays, assigneeId: a.id }, null, [a.id]);
        }
      }
      const ev = { type: 'task_stale', task, days: task.ageDays };
      new Set([...bosses.map((b) => b.id), ...pending.map((a) => a.id)]).forEach((id) => rt.sendToUser(id, ev));
      n++;
    } catch (e) {
      console.error('task reminder #' + r.id + ':', e.message);
    }
  }
  return { reminded: n };
}

// ---------- 14-day task cleanup ----------
async function runTaskCleanup() {
  const s = await settings.all();
  const days = s.taskDeleteDays;
  // owner rule: never delete open tasks; done / closed ones go N days after they were finished / closed
  const [rows] = await pool.query(
    `SELECT * FROM tasks WHERE (status = 'done' AND COALESCE(completed_at, updated_at) <= NOW() - INTERVAL ? DAY)
       OR (status = 'closed' AND COALESCE(closed_at, updated_at) <= NOW() - INTERVAL ? DAY)`, [days, days]);
  if (!rows.length) return { deleted: 0, file: null };
  const ids = rows.map((r) => r.id);
  const events = []; const assignees = [];
  for (const part of chunks(ids)) {
    events.push(...(await pool.query('SELECT * FROM task_events WHERE task_id IN (?)', [part]))[0]);
    assignees.push(...(await pool.query('SELECT * FROM task_assignees WHERE task_id IN (?)', [part]))[0]);
  }
  const file = dump('tasks', { job: 'taskcleanup', deleteDays: days, tasks: rows, task_assignees: assignees, task_events: events });
  for (const part of chunks(ids)) {
    await pool.query('DELETE FROM task_events WHERE task_id IN (?)', [part]);
    await pool.query('DELETE FROM task_assignees WHERE task_id IN (?)', [part]);
    await pool.query('UPDATE messages SET task_id = NULL WHERE task_id IN (?)', [part]);
    await pool.query('DELETE FROM tasks WHERE id IN (?)', [part]);
  }
  rt.sendToAll({ type: 'tasks_purged', taskIds: ids });
  for (const id of new Set(assignees.map((r) => r.user_id).filter(Boolean))) checkins.refreshDaySoon(id);
  return { deleted: ids.length, file: path.basename(file) };
}

// ---------- admin reset ----------
// Full JSON backup first, then delete all messages, reactions, revisions, tasks, task_events, check-ins, sign-offs,
// groups and DMs. Keeps users, PINs, invites, app_settings, the All Team chat and each member's check-in chat (emptied).
async function resetAll(actor) {
  const now = checkins.localNow();
  const file = await backup.runBackup('reset-' + now.date + '-' + String(now.minutes).padStart(4, '0') + '-' + Date.now());
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const q = (sql, v) => conn.query(sql, v);
    await q('UPDATE chats SET pinned_message_id = NULL');
    await q('DELETE FROM message_reactions');
    await q('DELETE FROM message_revisions');
    await q('DELETE FROM task_events');
    await q('DELETE FROM task_assignees');
    await q('DELETE FROM tasks');
    await q('UPDATE messages SET reply_to_id = NULL');
    await q('DELETE FROM messages');
    await q('DELETE FROM checkin_revisions');
    await q('DELETE FROM checkins');
    await q('DELETE FROM checkin_prompts');
    await q('DELETE FROM signoffs');
    const [gone] = await q("SELECT id FROM chats WHERE type IN ('group', 'dm')");
    const ids = gone.map((r) => r.id);
    if (ids.length) {
      await q('DELETE FROM chat_settings WHERE chat_id IN (?)', [ids]);
      await q('DELETE FROM chat_members WHERE chat_id IN (?)', [ids]);
      await q('DELETE FROM chats WHERE id IN (?)', [ids]);
    }
    await q('UPDATE chat_members SET last_read_message_id = NULL, last_delivered_message_id = NULL');
    await conn.commit();
    console.log('admin reset by user ' + actor.id + ', backup ' + path.basename(file));
    rt.sendToAll({ type: 'reset' });
    return { ok: true, backup: path.basename(file), chatsDeleted: ids.length };
  } catch (e) {
    await conn.rollback().catch(() => {});
    throw e;
  } finally {
    conn.release();
  }
}

// ---------- scheduler ----------
const JOBS = {
  purge: runPurge, reminders: runReminders, taskcleanup: runTaskCleanup,
  morning: () => checkins.runMorning(), evening: () => checkins.runEvening(), summary: () => checkins.runSummary(),
};

async function lastRun(name) {
  const [[r]] = await pool.query('SELECT value FROM app_settings WHERE name = ?', ['job.' + name + '.lastRun']);
  try { return r ? JSON.parse(r.value) : null; } catch (e) { return null; }
}
async function markRun(name, date) {
  const v = JSON.stringify(date);
  await pool.query('INSERT INTO app_settings (name, value) VALUES (?, ?) ON DUPLICATE KEY UPDATE value = ?', ['job.' + name + '.lastRun', v, v]);
}

async function due(name, date, ok) {
  if (!ok || (await lastRun(name)) === date) return;
  await markRun(name, date); // mark first: a failing job is not retried every minute
  try { console.log('job ' + name + ':', JSON.stringify(await JOBS[name]())); } catch (e) { console.error('job ' + name + ' failed:', e.message); }
}

async function tick() {
  const s = await settings.all();
  const now = checkins.localNow();
  const morning = (await checkins.getSettings()).morningTime;
  const mm = Number(morning.slice(0, 2)) * 60 + Number(morning.slice(3, 5));
  await due('purge', now.date, s.retentionEnabled && now.dow === 0 && now.minutes >= 23 * 60);
  await due('taskcleanup', now.date, s.retentionEnabled && now.minutes >= 60);
  await due('reminders', now.date, s.taskReminderDays > 0 && now.minutes >= mm);
}

function start() {
  let busy = false;
  const run = async () => {
    if (busy) return;
    busy = true;
    try { await tick(); } catch (e) { console.error('jobs:', e.message); }
    busy = false;
  };
  setInterval(run, 60000);
  setTimeout(run, 5000);
}

// POST /admin/jobs/run {job}: run one job now (ignores time, day and the once-a-day mark; retentionEnabled too).
async function runNow(name) {
  if (!JOBS[name]) return null;
  return JOBS[name]();
}

module.exports = { start, runNow, resetAll, runPurge, runReminders, runTaskCleanup, JOBS };
