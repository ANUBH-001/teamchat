// Daily check-ins (round 2): morning "today's tasks" card + evening sign-off.
// - Every active member (not the boss, not the bot) has ONE private chat type 'checkin' ("Daily Check-in")
//   whose only members are that member and the Team Assistant bot (chats.owner_id = member).
// - Scheduler (1-minute tick, local time in TZ, default Asia/Kolkata), on check-in days:
//   morningTime (10:00): 'day' card = all open tasks of the member (overdue / 6+ day marked), PINNED in that chat and kept
//   live: every task change of that member rewrites the card's payload (ws 'edited'). eveningTime (18:00): 'signoff'
//   card (tasks of today = open + done today, 3-state toggles, Submit). One nudge card nudgeMinutes later if not signed off.
//   A checkin_prompts row per user/date/kind (day | signoff | signoff_nudge) is claimed first: never double-posted.
// - Sign-off (POST /checkins/signoff) updates task statuses (tasks.js, source 'checkin'), stores a `signoffs` row and
//   sends bosses a quiet ws {type:'signoff'}; Reports read it via /admin/checkins.
// - Typed/voice text in the check-in chat is still stored as today's check-in text (`checkins`, Reports history).
// - Privacy: chat events go only to the chat members (member + bot). See realtime.MEMBER_OK.
const crypto = require('crypto');
const pool = require('./db');
const rt = require('./realtime');
const T = require('./tasks');
const settings = require('./settings');
const provider = require('./ai/provider');
const { botUserId } = require('./ai/bot');

class CheckinError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

const S = require('./status');
const CHAT_NAME = 'Daily Check-in';
const MAX_TASKS = 50;
const MAX_RANGE_DAYS = 31;

// ---------- local time (TZ env, default Asia/Kolkata; never the server's own clock zone) ----------
function validTz(tz) {
  if (!tz) return null;
  try { new Intl.DateTimeFormat('en-US', { timeZone: tz }); return tz; } catch (e) { return null; }
}
const TZ = validTz(process.env.TZ) || 'Asia/Kolkata';
const DOW = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
const FMT = new Intl.DateTimeFormat('en-US', {
  timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', weekday: 'short', hourCycle: 'h23',
});

// {date 'YYYY-MM-DD', minutes since local midnight, dow 0 = Sunday}
function localNow(d = new Date()) {
  const p = {};
  for (const x of FMT.formatToParts(d)) p[x.type] = x.value;
  return { date: p.year + '-' + p.month + '-' + p.day, minutes: (Number(p.hour) % 24) * 60 + Number(p.minute), dow: DOW[p.weekday] };
}

const isDate = (v) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) &&
  !isNaN(Date.parse(v)) && new Date(v + 'T00:00:00Z').toISOString().slice(0, 10) === v;
const addDays = (ymd, n) => { const d = new Date(ymd + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const dowOf = (ymd) => new Date(ymd + 'T00:00:00Z').getUTCDay();
const toMin = (hhmm) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));
const parse = (s) => { if (!s) return null; try { return JSON.parse(s); } catch (e) { return null; } };
const toId = (v) => {
  const ok = (typeof v === 'number' && Number.isInteger(v)) || (typeof v === 'string' && /^\d{1,10}$/.test(v));
  const n = ok ? Number(v) : 0;
  return n > 0 && n < 2147483648 ? n : 0;
};

// ---------- settings (app_settings, keys 'checkin.*', JSON values) ----------
const DEFAULTS = { enabled: true, morningTime: '10:00', eveningTime: '18:00', days: [1, 2, 3, 4, 5, 6], nudgeMinutes: 120 };
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const CHECK = {
  enabled: (v) => typeof v === 'boolean',
  morningTime: (v) => typeof v === 'string' && TIME_RE.test(v),
  eveningTime: (v) => typeof v === 'string' && TIME_RE.test(v),
  days: (v) => Array.isArray(v) && v.length <= 7 && v.every((n) => Number.isInteger(n) && n >= 0 && n <= 6),
  nudgeMinutes: (v) => Number.isInteger(v) && v >= 0 && v <= 720,
};
const BAD = {
  enabled: 'enabled must be true or false',
  morningTime: 'Invalid morningTime (HH:MM)',
  eveningTime: 'Invalid eveningTime (HH:MM)',
  days: 'Invalid days (list of 0-6, 0 = Sunday)',
  nudgeMinutes: 'Invalid nudgeMinutes (0-720, 0 = no nudge)',
};
const sortDays = (d) => [...new Set(d)].sort((a, b) => a - b);

async function getSettings() {
  const [rows] = await pool.query("SELECT name, value FROM app_settings WHERE name LIKE 'checkin.%'");
  const s = { ...DEFAULTS, days: [...DEFAULTS.days] };
  for (const r of rows) {
    const k = r.name.slice('checkin.'.length);
    const v = parse(r.value);
    if (CHECK[k] && CHECK[k](v)) s[k] = v;
  }
  if (toMin(s.morningTime) >= toMin(s.eveningTime)) { s.morningTime = DEFAULTS.morningTime; s.eveningTime = DEFAULTS.eveningTime; }
  s.days = sortDays(s.days);
  return s;
}

const publicSettings = (s) => ({
  enabled: s.enabled, morningTime: s.morningTime, eveningTime: s.eveningTime, days: s.days, nudgeMinutes: s.nudgeMinutes, timezone: TZ,
});

async function updateSettings(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new CheckinError(400, 'Nothing to update');
  const keys = Object.keys(DEFAULTS).filter((k) => body[k] !== undefined);
  if (!keys.length) throw new CheckinError(400, 'Nothing to update');
  const next = await getSettings();
  for (const k of keys) {
    if (!CHECK[k](body[k])) throw new CheckinError(400, BAD[k]);
    next[k] = k === 'days' ? sortDays(body[k]) : body[k];
  }
  if (toMin(next.morningTime) >= toMin(next.eveningTime)) throw new CheckinError(400, 'Morning time must be before evening time');
  for (const k of keys) {
    await pool.query('INSERT INTO app_settings (name, value) VALUES (?, ?) ON DUPLICATE KEY UPDATE value = ?',
      ['checkin.' + k, JSON.stringify(next[k]), JSON.stringify(next[k])]);
  }
  return publicSettings(next);
}

// ---------- the private chat ----------
// Returns the member's check-in chat id (creating it if missing), or null for boss / bot / unknown users.
async function ensureChat(userId) {
  const [[u]] = await pool.query('SELECT id, role, is_bot FROM users WHERE id = ?', [userId]);
  if (!u || u.is_bot || u.role !== 'member') return null;
  const find = async () => (await pool.query("SELECT id FROM chats WHERE type = 'checkin' AND owner_id = ?", [u.id]))[0][0];
  let chat = await find();
  let created = false;
  if (!chat) {
    // UNIQUE(owner_id) makes this race-safe: a second caller just ignores and reads the winner's row
    const [r] = await pool.query(
      "INSERT IGNORE INTO chats (type, name, created_by, owner_id) VALUES ('checkin', ?, ?, ?)", [CHAT_NAME, u.id, u.id]);
    created = r.affectedRows === 1;
    chat = created ? { id: r.insertId } : await find();
  }
  const bot = await botUserId();
  await pool.query('INSERT IGNORE INTO chat_members (chat_id, user_id) VALUES (?, ?), (?, ?)', [chat.id, u.id, chat.id, bot]);
  if (created) rt.sendToUser(u.id, { type: 'chat', chatId: chat.id }); // only the owner hears about it
  return chat.id;
}

async function ensureAllChats() {
  const [rows] = await pool.query(
    `SELECT u.id FROM users u LEFT JOIN chats c ON c.type = 'checkin' AND c.owner_id = u.id
     WHERE u.role = 'member' AND u.is_bot = 0 AND u.active = 1 AND c.id IS NULL`);
  for (const r of rows) await ensureChat(r.id);
}

// ---------- messages in the check-in chat ----------
async function insertMessage(chatId, senderId, body, type, payload, clientPrefix) {
  const { MSG_SELECT, formatMessage } = require('./routes/chats'); // lazy: chats.js requires this file
  const [r] = await pool.query(
    'INSERT INTO messages (chat_id, sender_id, body, client_id, type, payload) VALUES (?, ?, ?, ?, ?, ?)',
    [chatId, senderId, String(body).slice(0, 4000), clientPrefix + crypto.randomUUID(), type, payload ? JSON.stringify(payload) : null]);
  return readMessage(r.insertId);
}

async function readMessage(id) {
  const { MSG_SELECT, formatMessage } = require('./routes/chats');
  const [[row]] = await pool.query(MSG_SELECT + 'WHERE m.id = ?', [id]);
  return row ? formatMessage(row, { role: 'member' }) : null;
}

// Only the chat members (owner + bot) get the event; memberIds applies the privacy guard.
async function deliver(message, type = 'message') {
  for (const u of await rt.memberIds(message.chatId)) rt.sendToUser(u, { type, chatId: message.chatId, message });
}

async function markSeen(chatId, userIds, messageId) {
  await pool.query(
    'UPDATE chat_members SET last_read_message_id = GREATEST(COALESCE(last_read_message_id, 0), ?), ' +
    'last_delivered_message_id = GREATEST(COALESCE(last_delivered_message_id, 0), ?) WHERE chat_id = ? AND user_id IN (?)',
    [messageId, messageId, chatId, userIds]);
}

// The bot has no client: it "reads" replies in a check-in chat at once, so the member gets read ticks.
async function botSeen(chatId, messageId) {
  await markSeen(chatId, [await botUserId()], messageId);
}

async function postMemberMessage(chatId, user, body) {
  const message = await insertMessage(chatId, user.id, body, 'text', null, 'checkin-');
  await markSeen(chatId, [user.id, await botUserId()], message.id);
  await deliver(message);
  await rt.pushStatus(chatId);
  return message;
}

// ---------- today's tasks ----------
// status = the member's OWN status on the task (multi-assignee); taskStatus = the task's aggregate
const item = (t) => ({
  id: t.id, title: t.title, status: t.myStatus, taskStatus: t.status, dueDate: t.dueDate, project: t.project, overdue: t.overdue,
  stale: t.stale, ageDays: t.ageDays, assigneeCount: t.assignees.length, createdBy: t.createdBy, description: t.description || null,
});
const userTasks = (userId) => T.assignedTo(userId);

// -> {open, doneToday, counts:{given (created today), done (completed today), left (open)}}
async function dayTasks(userId) {
  await settings.all();
  const all = await userTasks(userId);
  const start = T.startOfToday().getTime();
  const open = all.filter((t) => t.myStatus !== 'done').slice(0, MAX_TASKS).map(item);
  const doneToday = all.filter((t) => t.myStatus === 'done' && t.myCompletedAt && new Date(t.myCompletedAt).getTime() >= start).map(item);
  const given = all.filter((t) => new Date(t.createdAt).getTime() >= start).length;
  return { open, doneToday, counts: { given, done: doneToday.length, left: open.length } };
}

const flag = (t) => (t.overdue ? ' (overdue)' : '') + (t.stale ? ' (' + t.ageDays + ' din se pending)' : '');

function cardBody(kind, name, d, nudge) {
  if (kind === 'day') {
    return ['Good morning ' + name + '! Aaj ke tasks (' + d.open.length + '):',
      ...(d.open.length ? d.open.map((t) => '• ' + t.title + flag(t)) : ['Koi open task nahi.'])].join('\n');
  }
  return [(nudge ? 'Reminder: ' : '') + name + ', aaj ka sign-off karo.',
    'Aaj diye: ' + d.counts.given + ' · Done: ' + d.counts.done + ' · Baaki: ' + d.counts.left,
    'Har task ka status chuniye (Todo / Planning / Coding / Testing / Change merged / Done), phir "Submit sign-off".'].join('\n');
}

const cardPayload = (kind, date, d, nudge) => ({
  kind, date, tasks: kind === 'day' ? d.open : [...d.open, ...d.doneToday], counts: d.counts, ...(nudge ? { nudge: true } : {}),
});

async function marker(userId, date, kind) {
  const [[r]] = await pool.query('SELECT message_id FROM checkin_prompts WHERE user_id = ? AND date = ? AND kind = ?', [userId, date, kind]);
  return r || null;
}

// Post a card once per user/date/kind (claim first). 'day' cards are pinned in the chat.
async function sendCard(m, date, kind, nudge = false) {
  const markKind = nudge ? kind + '_nudge' : kind;
  const [claim] = await pool.query('INSERT IGNORE INTO checkin_prompts (user_id, date, kind) VALUES (?, ?, ?)', [m.id, date, markKind]);
  if (!claim.affectedRows) return null;
  let message = null;
  try {
    const chatId = await ensureChat(m.id);
    if (!chatId) throw new Error('no check-in chat');
    const d = await dayTasks(m.id);
    message = await insertMessage(chatId, await botUserId(), cardBody(kind, m.name, d, nudge), 'checkin_prompt',
      cardPayload(kind, date, d, nudge), 'bot-');
    await pool.query('UPDATE checkin_prompts SET message_id = ? WHERE user_id = ? AND date = ? AND kind = ?', [message.id, m.id, date, markKind]);
    await deliver(message);
    if (kind === 'day') {
      await pool.query('UPDATE chats SET pinned_message_id = ? WHERE id = ?', [message.id, chatId]);
      await rt.sendToChat(chatId, { type: 'pin', chatId, pinnedMessage: { id: message.id, body: String(message.text).slice(0, 200), senderName: message.senderName } });
    }
    return message;
  } catch (e) {
    // nothing posted yet -> release the claim so the next tick retries; once posted, never post again
    if (!message) await pool.query('DELETE FROM checkin_prompts WHERE user_id = ? AND date = ? AND kind = ?', [m.id, date, markKind]).catch(() => {});
    throw e;
  }
}

// Rewrite today's 'day' (and 'signoff') cards of a member with the current task list; ws {type:'edited', chatId, message}.
async function refreshDay(userId) {
  const date = localNow().date;
  const [marks] = await pool.query(
    "SELECT kind, message_id FROM checkin_prompts WHERE user_id = ? AND date = ? AND kind IN ('day', 'signoff', 'signoff_nudge') AND message_id IS NOT NULL",
    [userId, date]);
  if (!marks.length) return;
  const [[u]] = await pool.query('SELECT name FROM users WHERE id = ?', [userId]);
  const d = await dayTasks(userId);
  for (const mk of marks) {
    const kind = mk.kind === 'day' ? 'day' : 'signoff';
    const nudge = mk.kind === 'signoff_nudge';
    await pool.query('UPDATE messages SET body = ?, payload = ? WHERE id = ? AND deleted_at IS NULL',
      [cardBody(kind, u ? u.name : '', d, nudge), JSON.stringify(cardPayload(kind, date, d, nudge)), mk.message_id]);
    const message = await readMessage(mk.message_id);
    if (message && !message.deleted) await deliver(message, 'edited');
  }
}

// Debounced refresh (tasks.js calls this on every task change of a member).
const pendingRefresh = new Map();
function refreshDaySoon(userId) {
  if (pendingRefresh.has(userId)) clearTimeout(pendingRefresh.get(userId));
  pendingRefresh.set(userId, setTimeout(() => {
    pendingRefresh.delete(userId);
    refreshDay(userId).catch((e) => console.error('checkin card refresh:', e.message));
  }, 800));
}

// ---------- sign-off ----------
const SIGNOFF_SELECT = "SELECT s.id, s.user_id, DATE_FORMAT(s.date, '%Y-%m-%d') date, s.note, s.summary, s.message_id, s.created_at, s.updated_at FROM signoffs s ";
const shapeSignoff = (r) => r && ({
  id: r.id, userId: r.user_id, date: r.date, note: r.note, ...(parse(r.summary) || { counts: { given: 0, done: 0, left: 0 }, tasks: [] }),
  messageId: r.message_id ? Number(r.message_id) : null, createdAt: r.created_at, updatedAt: r.updated_at,
});
async function getSignoff(userId, date) {
  const [[r]] = await pool.query(SIGNOFF_SELECT + 'WHERE s.user_id = ? AND s.date = ?', [userId, date]);
  return r || null;
}

// POST /checkins/signoff {taskStatuses?: {id: status}, note?} -> {signoff, created, tasks (changed)}
async function signoff(user, body) {
  body = body && typeof body === 'object' && !Array.isArray(body) ? body : {};
  if (user.role !== 'member') throw new CheckinError(403, 'Not allowed');
  let note = null;
  if (body.note !== undefined && body.note !== null) {
    if (typeof body.note !== 'string') throw new CheckinError(400, 'Invalid note');
    note = body.note.trim().slice(0, 2000) || null;
  }
  const statuses = {};
  if (body.taskStatuses !== undefined && body.taskStatuses !== null) {
    const o = body.taskStatuses;
    if (typeof o !== 'object' || Array.isArray(o) || Object.keys(o).length > MAX_TASKS) throw new CheckinError(400, 'Invalid taskStatuses');
    for (const [k, v] of Object.entries(o)) {
      const id = toId(k);
      if (!id || !S.norm(v)) throw new CheckinError(400, 'Invalid taskStatuses');
      statuses[id] = S.norm(v); // old app keys in_progress / review are aliased
    }
  }
  const ids = Object.keys(statuses).map(Number);
  const own = {};
  if (ids.length) {
    const [rows] = await pool.query(
      `SELECT t.id, t.title, ta.status FROM tasks t JOIN task_assignees ta ON ta.task_id = t.id AND ta.user_id = ? AND ta.removed_at IS NULL
       WHERE t.id IN (?) AND t.deleted_at IS NULL AND t.status <> 'closed'`, [user.id, ids]);
    if (rows.length !== ids.length) throw new CheckinError(400, 'Invalid task (use your own tasks only)');
    for (const r of rows) own[r.id] = r;
  }
  const date = localNow().date;
  const chatId = await ensureChat(user.id);
  if (!chatId) throw new CheckinError(403, 'Not allowed');

  const changed = [];
  for (const [id, st] of Object.entries(statuses)) {
    if (own[id].status === st) continue;
    try {
      changed.push(await T.updateTask(Number(id), { status: st, userId: user.id }, user, 'checkin'));
    } catch (e) {
      if (!(e instanceof T.TaskError)) throw e; // e.g. reassigned meanwhile: skip that one
    }
  }
  const d = await dayTasks(user.id);
  const summary = { counts: d.counts, tasks: [...d.doneToday, ...d.open].map((t) => ({ id: t.id, title: t.title, status: t.status })) };
  const existing = await getSignoff(user.id, date);
  const lines = ['Sign-off' + (existing ? ' (update)' : '') + ': Done ' + d.counts.done + ' · Baaki ' + d.counts.left + ' · Aaj diye ' + d.counts.given];
  for (const t of d.doneToday) lines.push('✓ ' + t.title);
  for (const t of d.open) lines.push((t.status === 'todo' ? '○ ' : '◐ ') + t.title + ' [' + (S.LABEL[t.status] || t.status) + ']');
  if (note) lines.push(note);
  const message = await postMemberMessage(chatId, user, lines.join('\n'));
  await pool.query(
    `INSERT INTO signoffs (user_id, date, note, summary, message_id) VALUES (?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE note = VALUES(note), summary = VALUES(summary), message_id = VALUES(message_id)`,
    [user.id, date, note, JSON.stringify(summary), message.id]);
  await refreshDay(user.id);
  rt.sendToBosses({ type: 'signoff', userId: user.id, userName: user.name, date, counts: d.counts, updated: !!existing }).catch(() => {});
  return { signoff: shapeSignoff(await getSignoff(user.id, date)), created: !existing, tasks: changed };
}

// ---------- typed text in the check-in chat (kept for Reports history) ----------
const ROW_SELECT =
  "SELECT c.id, c.user_id, DATE_FORMAT(c.date, '%Y-%m-%d') date, c.kind, c.text, c.summary, c.payload, c.message_id, " +
  'c.created_at, c.updated_at, (SELECT COUNT(*) FROM checkin_revisions r WHERE r.checkin_id = c.id) revisions FROM checkins c ';

async function getRow(userId, date, kind) {
  const [[r]] = await pool.query(ROW_SELECT + 'WHERE c.user_id = ? AND c.date = ? AND c.kind = ?', [userId, date, kind]);
  return r || null;
}

function shape(r) {
  const p = parse(r.payload) || {};
  return {
    id: r.id, userId: r.user_id, date: r.date, kind: r.kind, text: r.text,
    summary: parse(r.summary) || { done: [], pending: [], blockers: [] },
    selectedTaskIds: p.selectedTaskIds || [], taskStatuses: p.taskStatuses || {}, tasks: p.tasks || [],
    messageId: r.message_id ? Number(r.message_id) : null,
    createdAt: r.created_at, updatedAt: r.updated_at, edited: Number(r.revisions) > 0,
  };
}

const BLOCK_RE = /(block|stuck|atak|atka|atki|ruka|ruki|dikkat|problem|issue|help|waiting|intezaar|nahi ho pa|दिक्कत|समस्या|अटक|रुका|रुकी)/i;
const DONE_RE = /(ho gaya|ho gayi|ho gya|ho gyi|kar diya|kar di|kar liya|complete|\bdone\b|finish|khatam|हो गया|हो गई|हो गयी|कर दिया|पूरा|खत्म)/i;
function basicSummary(text) {
  const cut = (a) => [...new Set(a)].slice(0, 8);
  const lines = String(text || '').split(/[\n.!?।]+/).map((x) => x.trim()).filter((x) => x.length > 2).map((x) => x.slice(0, 160));
  const blockers = lines.filter((x) => BLOCK_RE.test(x));
  const rest = lines.filter((x) => !BLOCK_RE.test(x));
  return { done: cut(rest.filter((x) => DONE_RE.test(x))), pending: cut(rest.filter((x) => !DONE_RE.test(x))), blockers: cut(blockers) };
}

// Append the owner's typed/voice message to today's check-in text (evening after eveningTime, else morning);
// AI summary refines it. Called after the reply by routes/chats.js (not for commands).
async function onChatMessage(message, user) {
  if (!message || !message.text || user.role !== 'member') return;
  const [[chat]] = await pool.query("SELECT owner_id FROM chats WHERE id = ? AND type = 'checkin'", [message.chatId]);
  if (!chat || chat.owner_id !== user.id) return;
  const s = await getSettings();
  const now = localNow();
  const kind = now.minutes >= toMin(s.eveningTime) ? 'evening' : 'morning';
  const existing = await getRow(user.id, now.date, kind);
  const text = (existing && existing.text ? existing.text + '\n' + message.text : message.text).slice(0, 16000);
  const p = existing ? parse(existing.payload) || {} : {};
  const payload = { selectedTaskIds: p.selectedTaskIds || [], taskStatuses: p.taskStatuses || {}, tasks: p.tasks || [] };
  if (existing) {
    await pool.query('INSERT INTO checkin_revisions (checkin_id, old_text, old_payload) VALUES (?, ?, ?)', [existing.id, existing.text, existing.payload]);
  }
  const sum = JSON.stringify(basicSummary(text));
  const pj = JSON.stringify(payload);
  const mid = existing && existing.message_id ? existing.message_id : message.id;
  await pool.query(
    `INSERT INTO checkins (user_id, date, kind, text, summary, payload, message_id) VALUES (?, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE text = ?, summary = ?, payload = ?, message_id = ?`,
    [user.id, now.date, kind, text, sum, pj, mid, text, sum, pj, mid]);
  const row = await getRow(user.id, now.date, kind);
  const ai = await provider.summarize({ kind, text, tasks: [] });
  if (ai) await pool.query('UPDATE checkins SET summary = ? WHERE id = ? AND text = ?', [JSON.stringify(ai), row.id, text]);
}

// ---------- reads ----------
function range(from, to) {
  to = to === undefined || to === '' ? localNow().date : to;
  if (!isDate(to)) throw new CheckinError(400, 'Invalid date');
  from = from === undefined || from === '' ? addDays(to, -6) : from;
  if (!isDate(from)) throw new CheckinError(400, 'Invalid date');
  if (from > to) throw new CheckinError(400, 'Invalid date range');
  if ((Date.parse(to) - Date.parse(from)) / 86400000 + 1 > MAX_RANGE_DAYS) throw new CheckinError(400, 'Range too long (max 31 days)');
  return { from, to };
}

async function history(userId, qFrom, qTo) {
  const { from, to } = range(qFrom, qTo);
  const [rows] = await pool.query(
    ROW_SELECT + "WHERE c.user_id = ? AND c.date BETWEEN ? AND ? ORDER BY c.date DESC, c.kind = 'evening', c.id", [userId, from, to]);
  const [subs] = await pool.query(SIGNOFF_SELECT + 'WHERE s.user_id = ? AND s.date BETWEEN ? AND ? ORDER BY s.date DESC', [userId, from, to]);
  return { from, to, checkins: rows.map(shape), signoffs: subs.map(shapeSignoff) };
}

// Member: GET /checkins/today -> today's cards state, task list and sign-off.
async function today(user) {
  if (user.role !== 'member') throw new CheckinError(403, 'Not allowed');
  const s = await getSettings();
  const now = localNow();
  const chatId = await ensureChat(user.id);
  const [marks] = await pool.query('SELECT kind, message_id FROM checkin_prompts WHERE user_id = ? AND date = ?', [user.id, now.date]);
  const mark = (k) => marks.find((m) => m.kind === k);
  const so = await getSignoff(user.id, now.date);
  const d = await dayTasks(user.id);
  return {
    date: now.date, chatId, settings: publicSettings(s), workday: s.enabled && s.days.includes(now.dow),
    eveningOpen: now.minutes >= toMin(s.eveningTime),
    day: { prompted: !!mark('day'), messageId: mark('day') && mark('day').message_id ? Number(mark('day').message_id) : null },
    signoff: { prompted: !!mark('signoff'), submitted: !!so, signoff: so ? shapeSignoff(so) : null },
    tasks: d.open, doneToday: d.doneToday, counts: d.counts,
  };
}

// Boss: one day, every member (active ones, plus inactive ones who submitted that day). signoff = the new evening flow;
// morning/evening = typed check-in text (and old round-1 submissions).
async function dayReport(qDate) {
  const date = qDate === undefined || qDate === '' ? localNow().date : qDate;
  if (!isDate(date)) throw new CheckinError(400, 'Invalid date');
  const s = await getSettings();
  const [members] = await pool.query(
    `SELECT u.id, u.name, u.active FROM users u WHERE u.role = 'member' AND u.is_bot = 0
       AND (u.active = 1 OR EXISTS (SELECT 1 FROM checkins c WHERE c.user_id = u.id AND c.date = ?)
         OR EXISTS (SELECT 1 FROM signoffs x WHERE x.user_id = u.id AND x.date = ?)) ORDER BY u.name`, [date, date]);
  const [rows] = await pool.query(ROW_SELECT + 'WHERE c.date = ?', [date]);
  const [subs] = await pool.query(SIGNOFF_SELECT + 'WHERE s.date = ?', [date]);
  const [marks] = await pool.query('SELECT user_id, kind FROM checkin_prompts WHERE date = ?', [date]);
  const got = {};
  for (const r of rows) got[r.user_id + ':' + r.kind] = shape(r);
  const so = new Map(subs.map((r) => [r.user_id, shapeSignoff(r)]));
  const sent = new Set(marks.map((m) => m.user_id + ':' + m.kind));
  const slot = (id, k) => {
    const c = got[id + ':' + k];
    return { status: c ? 'submitted' : 'missing', prompted: sent.has(id + ':' + k), checkin: c || null };
  };
  return {
    date, workday: s.enabled && s.days.includes(dowOf(date)),
    members: members.map((m) => ({
      id: m.id, name: m.name, active: !!m.active,
      signoff: { status: so.has(m.id) ? 'submitted' : 'missing', prompted: sent.has(m.id + ':signoff'), signoff: so.get(m.id) || null },
      morning: slot(m.id, 'morning'), evening: slot(m.id, 'evening'),
    })),
  };
}

async function userHistory(userId, from, to) {
  const id = toId(userId);
  const [[u]] = id
    ? await pool.query("SELECT id, name, active FROM users WHERE id = ? AND role = 'member' AND is_bot = 0", [id])
    : [[null]];
  if (!u) throw new CheckinError(404, 'User not found');
  return { user: { id: u.id, name: u.name, active: !!u.active }, ...(await history(u.id, from, to)) };
}

// ---------- scheduler ----------
const activeMembers = async () =>
  (await pool.query("SELECT id, name FROM users WHERE role = 'member' AND is_bot = 0 AND active = 1 ORDER BY id"))[0];

// Morning cards now (debug /admin/jobs/run 'morning' too): post missing ones, refresh existing ones.
async function runMorning() {
  await ensureAllChats();
  const date = localNow().date;
  let posted = 0; let refreshed = 0;
  for (const m of await activeMembers()) {
    try {
      if (await marker(m.id, date, 'day')) { await refreshDay(m.id); refreshed++; } else if (await sendCard(m, date, 'day')) posted++;
    } catch (e) { console.error('checkin day card (user ' + m.id + '):', e.message); }
  }
  return { posted, refreshed };
}

// Evening sign-off cards now (debug 'evening' too): post missing ones.
async function runEvening() {
  await ensureAllChats();
  const date = localNow().date;
  let posted = 0;
  for (const m of await activeMembers()) {
    try { if (await sendCard(m, date, 'signoff')) posted++; } catch (e) { console.error('checkin signoff card (user ' + m.id + '):', e.message); }
  }
  return { posted };
}

// From morningTime: 'day' card; from eveningTime: 'signoff' card; nudge once nudgeMinutes after it if not signed off.
// Only on check-in days; a late start catches up the same day.
async function tick() {
  await ensureAllChats();
  const s = await getSettings();
  const now = localNow();
  if (!s.enabled || !s.days.includes(now.dow) || now.minutes < toMin(s.morningTime)) return;
  const evening = now.minutes >= toMin(s.eveningTime);
  const members = await activeMembers();
  if (!members.length) return;
  const [marks] = await pool.query(
    'SELECT user_id, kind, TIMESTAMPDIFF(MINUTE, created_at, NOW()) age FROM checkin_prompts WHERE date = ?', [now.date]);
  const [subs] = await pool.query('SELECT user_id FROM signoffs WHERE date = ?', [now.date]);
  const age = new Map(marks.map((r) => [r.user_id + ':' + r.kind, Number(r.age)]));
  const signed = new Set(subs.map((r) => r.user_id));
  for (const m of members) {
    try {
      if (!age.has(m.id + ':day')) await sendCard(m, now.date, 'day');
      if (!evening || signed.has(m.id)) continue;
      const k = m.id + ':signoff';
      if (!age.has(k)) await sendCard(m, now.date, 'signoff');
      else if (s.nudgeMinutes > 0 && !age.has(k + '_nudge') && age.get(k) >= s.nudgeMinutes) await sendCard(m, now.date, 'signoff', true);
    } catch (e) {
      console.error('checkin scheduler (user ' + m.id + '):', e.message);
    }
  }
}

function start() {
  let busy = false;
  const run = async () => {
    if (busy) return;
    busy = true;
    try { await tick(); } catch (e) { console.error('checkin scheduler:', e.message); }
    busy = false;
  };
  setInterval(run, 60000);
  run();
  console.log('checkins: scheduler on, timezone ' + TZ);
}

module.exports = {
  CheckinError, start, ensureChat, ensureAllChats, botSeen, onChatMessage, signoff, today, history, dayReport, userHistory,
  getSettings: async () => publicSettings(await getSettings()), updateSettings, localNow, TZ, refreshDay, refreshDaySoon,
  runMorning, runEvening, postBotCard: insertMessage, deliver,
};
