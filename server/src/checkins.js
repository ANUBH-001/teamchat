// Daily check-ins (Phase 8b): morning plan + evening work report.
// - Every active member (not the boss, not the bot) has ONE private chat type 'checkin' ("Daily Check-in")
//   whose only members are that member and the Team Assistant bot (chats.owner_id = member).
// - Scheduler (1-minute tick, local time in TZ, default Asia/Kolkata) posts the prompts and one nudge; a
//   checkin_prompts row per user/date/kind is claimed first, so restarts/catch-up never double-post.
// - Submissions (POST /checkins or a typed/voice reply in the check-in chat) are stored in `checkins`
//   (old text kept in checkin_revisions); task status changes go through tasks.js with source 'checkin'.
// - Privacy: events go only to the chat members (member + bot). The boss reads check-ins ONLY through
//   /admin/checkins (pull-only: no event, badge or notification). See realtime.MEMBER_OK.
const crypto = require('crypto');
const pool = require('./db');
const rt = require('./realtime');
const T = require('./tasks');
const provider = require('./ai/provider');
const { botUserId } = require('./ai/bot');

class CheckinError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

const KINDS = ['morning', 'evening'];
const STATUSES = ['todo', 'in_progress', 'done'];
const LABEL = { todo: 'Pending', in_progress: 'In progress', done: 'Done' };
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
const DEFAULTS = { enabled: true, morningTime: '10:00', eveningTime: '18:30', days: [1, 2, 3, 4, 5, 6], nudgeMinutes: 120 };
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
  const [[row]] = await pool.query(MSG_SELECT + 'WHERE m.id = ?', [r.insertId]);
  return formatMessage(row, { role: 'member' });
}

// Only the chat members (owner + bot) get the event; memberIds applies the privacy guard.
async function deliver(message) {
  for (const u of await rt.memberIds(message.chatId)) rt.sendToUser(u, { type: 'message', message });
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

// ---------- tasks ----------
const brief = (t) => ({ id: t.id, title: t.title, status: t.status, dueDate: t.dueDate });
const userTasks = (userId) => T.listTasks({ assignee: String(userId) }, { id: userId, role: 'member' });

// Evening list: the tasks picked in the morning plus all open ones.
async function eveningTasks(userId, date) {
  const morning = await getRow(userId, date, 'morning');
  const sel = new Set(morning ? ((parse(morning.payload) || {}).selectedTaskIds || []) : []);
  return (await userTasks(userId)).filter((t) => t.status !== 'done' || sel.has(t.id)).map(brief);
}

// ---------- rows ----------
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

async function saveRow(existing, userId, date, kind, text, summary, payload, messageId) {
  if (existing) {
    await pool.query('INSERT INTO checkin_revisions (checkin_id, old_text, old_payload) VALUES (?, ?, ?)',
      [existing.id, existing.text, existing.payload]);
  }
  const s = JSON.stringify(summary);
  const p = JSON.stringify(payload);
  await pool.query(
    `INSERT INTO checkins (user_id, date, kind, text, summary, payload, message_id) VALUES (?, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE text = ?, summary = ?, payload = ?, message_id = ?`,
    [userId, date, kind, text, s, p, messageId, text, s, p, messageId]);
  return getRow(userId, date, kind);
}

// ---------- summary: deterministic now, AI refines it after the reply ----------
const BLOCK_RE = /(block|stuck|atak|atka|atki|ruka|ruki|dikkat|problem|issue|help|waiting|intezaar|nahi ho pa|दिक्कत|समस्या|अटक|रुका|रुकी)/i;
const DONE_RE = /(ho gaya|ho gayi|ho gya|ho gyi|kar diya|kar di|kar liya|complete|\bdone\b|finish|khatam|हो गया|हो गई|हो गयी|कर दिया|पूरा|खत्म)/i;

function basicSummary(kind, tasks, text) {
  const cut = (a) => [...new Set(a)].slice(0, 8);
  const lines = String(text || '').split(/[\n.!?।]+/).map((x) => x.trim()).filter((x) => x.length > 2).map((x) => x.slice(0, 160));
  const blockers = lines.filter((x) => BLOCK_RE.test(x));
  const rest = lines.filter((x) => !BLOCK_RE.test(x));
  if (kind === 'morning') return { done: [], pending: cut([...tasks.map((t) => t.title), ...rest]), blockers: cut(blockers) };
  return {
    done: cut([...tasks.filter((t) => t.status === 'done').map((t) => t.title), ...rest.filter((x) => DONE_RE.test(x))]),
    pending: cut(tasks.filter((t) => t.status !== 'done').map((t) => t.title + (t.status === 'in_progress' ? ' (in progress)' : ''))),
    blockers: cut(blockers),
  };
}

// One cheap AI call; only written if text AND payload are still the same (a newer edit wins, e.g. a later
// status-only change). Failure keeps the basic one.
async function refineSummary(id, kind, payload, text) {
  if (!text) return;
  const s = await provider.summarize({ kind, text, tasks: payload.tasks });
  if (!s) return;
  await pool.query('UPDATE checkins SET summary = ? WHERE id = ? AND text = ? AND payload = ?',
    [JSON.stringify(s), id, text, JSON.stringify(payload)]);
}

// ---------- submit (POST /checkins) ----------
function submissionText(kind, edit, selected, statuses, own, text) {
  const lines = [(kind === 'morning' ? 'Aaj ka plan' : 'Aaj ka work report') + (edit ? ' (update)' : '') + ':'];
  if (selected && selected.length) {
    lines.push(kind === 'morning' ? 'Aaj ye karunga:' : 'Aaj ke tasks:');
    for (const id of selected) lines.push('• ' + own[id].title);
  }
  for (const st of ['done', 'in_progress', 'todo']) {
    const ids = Object.keys(statuses || {}).filter((id) => statuses[id] === st);
    if (!ids.length) continue;
    lines.push(LABEL[st] + ':');
    for (const id of ids) lines.push('• ' + own[id].title);
  }
  if (text) lines.push(text);
  return lines.join('\n');
}

async function submit(user, body) {
  body = body && typeof body === 'object' && !Array.isArray(body) ? body : {};
  if (user.role !== 'member') throw new CheckinError(403, 'Not allowed');
  const kind = body.kind;
  if (!KINDS.includes(kind)) throw new CheckinError(400, 'Invalid kind');

  let text;
  if (body.text !== undefined && body.text !== null) {
    if (typeof body.text !== 'string') throw new CheckinError(400, 'Invalid text');
    text = body.text.trim();
    if (text.length > 4000) throw new CheckinError(400, 'Text is too long');
  }
  let selected;
  if (body.selectedTaskIds !== undefined && body.selectedTaskIds !== null) {
    const a = body.selectedTaskIds;
    if (!Array.isArray(a) || a.length > MAX_TASKS) throw new CheckinError(400, 'Invalid selectedTaskIds');
    selected = [...new Set(a.map(toId))];
    if (selected.some((i) => !i)) throw new CheckinError(400, 'Invalid selectedTaskIds');
  }
  let statuses;
  if (body.taskStatuses !== undefined && body.taskStatuses !== null) {
    const o = body.taskStatuses;
    if (typeof o !== 'object' || Array.isArray(o) || Object.keys(o).length > MAX_TASKS) throw new CheckinError(400, 'Invalid taskStatuses');
    statuses = {};
    for (const [k, v] of Object.entries(o)) {
      const id = toId(k);
      if (!id || !STATUSES.includes(v)) throw new CheckinError(400, 'Invalid taskStatuses');
      statuses[id] = v;
    }
  }
  const hasSel = !!(selected && selected.length);
  const hasSt = !!(statuses && Object.keys(statuses).length);
  if (!text && !hasSel && !hasSt) throw new CheckinError(400, 'Nothing to submit');

  // every task must be the caller's own (not deleted)
  const ids = [...new Set([...(selected || []), ...Object.keys(statuses || {}).map(Number)])];
  const own = {};
  if (ids.length) {
    const [rows] = await pool.query(
      'SELECT id, title, status FROM tasks WHERE id IN (?) AND assignee_id = ? AND deleted_at IS NULL', [ids, user.id]);
    if (rows.length !== ids.length) throw new CheckinError(400, 'Invalid task (use your own tasks only)');
    for (const r of rows) own[r.id] = r;
  }

  const date = localNow().date; // edits only ever touch today's row (same local day)
  const chatId = await ensureChat(user.id);
  if (!chatId) throw new CheckinError(403, 'Not allowed');
  const existing = await getRow(user.id, date, kind);
  const old = existing ? parse(existing.payload) || {} : {};

  // 1. a normal message from the member, so the chat history reads naturally
  const message = await postMemberMessage(chatId, user, submissionText(kind, !!existing, selected, statuses, own, text));

  // 2. task status changes through tasks.js (permission checks again, task_events source 'checkin')
  const changed = [];
  for (const [id, st] of Object.entries(statuses || {})) {
    if (own[id].status === st) continue;
    try {
      changed.push(await T.updateTaskStatus(Number(id), st, user, 'checkin', message.id));
    } catch (e) {
      if (!(e instanceof T.TaskError)) throw e; // e.g. reassigned meanwhile: skip that one
    }
  }

  // 3. upsert today's row (old version kept in checkin_revisions)
  const selectedTaskIds = selected !== undefined ? selected : (old.selectedTaskIds || []);
  const taskStatuses = { ...(old.taskStatuses || {}), ...(statuses || {}) };
  const newText = text !== undefined ? (text || null) : (existing ? existing.text : null);
  const snapIds = new Set(kind === 'morning' ? selectedTaskIds : Object.keys(taskStatuses).map(Number));
  const tasks = (await userTasks(user.id)).filter((t) => snapIds.has(t.id)).map(brief);
  const payload = { selectedTaskIds, taskStatuses, tasks };
  const row = await saveRow(existing, user.id, date, kind, newText, basicSummary(kind, tasks, newText), payload, message.id);

  // 4. after the reply: AI engine on new free text (completes tasks the member names) + AI summary of the whole row
  if (newText) {
    setImmediate(async () => {
      // only NEW text: an edit resends the same text, and re-reading it would override the picked statuses
      if (text && (!existing || text !== existing.text)) {
        try { await require('./ai/engine').onMessage({ ...message, text }, user); } catch (e) { console.error('ai engine (checkin):', e.message); }
      }
      try { await refineSummary(row.id, kind, payload, newText); } catch (e) { console.error('checkin summary:', e.message); }
    });
  }
  return { checkin: shape(row), created: !existing, message, tasks: changed };
}

// A typed/voice message by the owner in their check-in chat: append to today's text (evening once the evening
// prompt went out or evening time passed, else morning). Called after the reply by routes/chats.js.
async function onChatMessage(message, user) {
  if (!message || !message.text || user.role !== 'member') return;
  const [[chat]] = await pool.query("SELECT owner_id FROM chats WHERE id = ? AND type = 'checkin'", [message.chatId]);
  if (!chat || chat.owner_id !== user.id) return;
  const s = await getSettings();
  const now = localNow();
  const [[ev]] = await pool.query(
    "SELECT 1 x FROM checkin_prompts WHERE user_id = ? AND date = ? AND kind = 'evening'", [user.id, now.date]);
  const kind = ev || now.minutes >= toMin(s.eveningTime) ? 'evening' : 'morning';
  const existing = await getRow(user.id, now.date, kind);
  const text = (existing && existing.text ? existing.text + '\n' + message.text : message.text).slice(0, 16000);
  const p = existing ? parse(existing.payload) || {} : {};
  const payload = { selectedTaskIds: p.selectedTaskIds || [], taskStatuses: p.taskStatuses || {}, tasks: p.tasks || [] };
  const row = await saveRow(existing, user.id, now.date, kind, text, basicSummary(kind, payload.tasks, text), payload,
    existing && existing.message_id ? existing.message_id : message.id);
  await refineSummary(row.id, kind, payload, text);
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
  return { from, to, checkins: rows.map(shape) };
}

// Member: today's prompt/submission state and task chips.
async function today(user) {
  if (user.role !== 'member') throw new CheckinError(403, 'Not allowed');
  const s = await getSettings();
  const now = localNow();
  const chatId = await ensureChat(user.id);
  const [rows] = await pool.query(ROW_SELECT + 'WHERE c.user_id = ? AND c.date = ?', [user.id, now.date]);
  const [marks] = await pool.query('SELECT kind FROM checkin_prompts WHERE user_id = ? AND date = ?', [user.id, now.date]);
  const sent = new Set(marks.map((m) => m.kind));
  const by = {};
  for (const r of rows) by[r.kind] = shape(r);
  const all = await userTasks(user.id);
  const sel = new Set(by.morning ? by.morning.selectedTaskIds : []);
  const slot = (k) => ({ prompted: sent.has(k), nudged: sent.has(k + '_nudge'), submitted: !!by[k], checkin: by[k] || null });
  return {
    date: now.date, chatId, settings: publicSettings(s), workday: s.enabled && s.days.includes(now.dow),
    morning: slot('morning'), evening: slot('evening'),
    tasks: all.filter((t) => t.status !== 'done').map(brief),
    eveningTasks: all.filter((t) => t.status !== 'done' || sel.has(t.id)).map(brief),
  };
}

// Boss: one day, every member (active ones, plus inactive ones who submitted that day).
async function dayReport(qDate) {
  const date = qDate === undefined || qDate === '' ? localNow().date : qDate;
  if (!isDate(date)) throw new CheckinError(400, 'Invalid date');
  const s = await getSettings();
  const [members] = await pool.query(
    `SELECT u.id, u.name, u.active FROM users u WHERE u.role = 'member' AND u.is_bot = 0
       AND (u.active = 1 OR EXISTS (SELECT 1 FROM checkins c WHERE c.user_id = u.id AND c.date = ?)) ORDER BY u.name`, [date]);
  const [rows] = await pool.query(ROW_SELECT + 'WHERE c.date = ?', [date]);
  const [marks] = await pool.query('SELECT user_id, kind FROM checkin_prompts WHERE date = ?', [date]);
  const got = {};
  for (const r of rows) got[r.user_id + ':' + r.kind] = shape(r);
  const sent = new Set(marks.map((m) => m.user_id + ':' + m.kind));
  const slot = (id, k) => {
    const c = got[id + ':' + k];
    return { status: c ? 'submitted' : 'missing', prompted: sent.has(id + ':' + k), checkin: c || null };
  };
  return {
    date, workday: s.enabled && s.days.includes(dowOf(date)),
    members: members.map((m) => ({ id: m.id, name: m.name, active: !!m.active, morning: slot(m.id, 'morning'), evening: slot(m.id, 'evening') })),
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
function promptText(name, kind, tasks, nudge) {
  const list = tasks.map((t) => '• ' + t.title +
    (kind === 'evening' ? ' (' + LABEL[t.status] + ')' : t.dueDate ? ' (due ' + t.dueDate + ')' : ''));
  if (kind === 'morning') {
    return [nudge ? 'Reminder: ' + name + ', aaj ka plan abhi tak nahi aaya.' : 'Good morning ' + name + '!',
      tasks.length ? 'Aaj ke tasks:' : 'Aapka koi open task nahi hai.', ...list,
      'Aaj kya karoge? Tasks chuniye ya likh kar bataiye.'].join('\n');
  }
  return [nudge ? 'Reminder: ' + name + ', aaj ka work report abhi tak nahi aaya.' : 'Aaj ka work report, ' + name + ':',
    ...(tasks.length ? ['Aaj ke tasks:', ...list] : []),
    'Kya kiya, kya pending hai, koi dikkat? Har task ka status chuniye ya likh kar bataiye.'].join('\n');
}

async function sendPrompt(m, date, kind, nudge) {
  const markKind = nudge ? kind + '_nudge' : kind;
  // claim first: the UNIQUE marker means only one process / tick ever posts this prompt
  const [claim] = await pool.query('INSERT IGNORE INTO checkin_prompts (user_id, date, kind) VALUES (?, ?, ?)', [m.id, date, markKind]);
  if (!claim.affectedRows) return;
  let message = null;
  try {
    const chatId = await ensureChat(m.id);
    if (!chatId) throw new Error('no check-in chat');
    const all = kind === 'morning' ? (await userTasks(m.id)).filter((t) => t.status !== 'done').map(brief) : await eveningTasks(m.id, date);
    const tasks = all.slice(0, 30);
    const payload = { kind, date, tasks };
    if (nudge) payload.nudge = true;
    message = await insertMessage(chatId, await botUserId(), promptText(m.name, kind, tasks, nudge), 'checkin_prompt', payload, 'bot-');
    await pool.query('UPDATE checkin_prompts SET message_id = ? WHERE user_id = ? AND date = ? AND kind = ?', [message.id, m.id, date, markKind]);
    await deliver(message);
  } catch (e) {
    // nothing posted yet -> release the claim so the next tick retries; once posted, never post again
    if (!message) await pool.query('DELETE FROM checkin_prompts WHERE user_id = ? AND date = ? AND kind = ?', [m.id, date, markKind]).catch(() => {});
    throw e;
  }
}

// Morning prompt in [morningTime, eveningTime); evening prompt from eveningTime to local midnight (so a late start
// catches up the same day only). Nudge once, nudgeMinutes after the prompt, if still nothing was submitted.
async function tick() {
  await ensureAllChats();
  const s = await getSettings();
  const now = localNow();
  if (!s.enabled || !s.days.includes(now.dow)) return;
  const morning = toMin(s.morningTime);
  const evening = toMin(s.eveningTime);
  if (now.minutes < morning) return;
  const [members] = await pool.query(
    "SELECT id, name FROM users WHERE role = 'member' AND is_bot = 0 AND active = 1 ORDER BY id");
  if (!members.length) return;
  const [marks] = await pool.query(
    'SELECT user_id, kind, TIMESTAMPDIFF(MINUTE, created_at, NOW()) age FROM checkin_prompts WHERE date = ?', [now.date]);
  const [subs] = await pool.query('SELECT user_id, kind FROM checkins WHERE date = ?', [now.date]);
  const age = new Map(marks.map((r) => [r.user_id + ':' + r.kind, Number(r.age)]));
  const done = new Set(subs.map((r) => r.user_id + ':' + r.kind));
  for (const m of members) {
    for (const kind of KINDS) {
      const open = kind === 'morning' ? now.minutes < evening : now.minutes >= evening;
      const key = m.id + ':' + kind;
      if (!open || done.has(key)) continue;
      try {
        if (!age.has(key)) await sendPrompt(m, now.date, kind, false);
        else if (s.nudgeMinutes > 0 && !age.has(key + '_nudge') && age.get(key) >= s.nudgeMinutes) await sendPrompt(m, now.date, kind, true);
      } catch (e) {
        console.error('checkin scheduler (user ' + m.id + ', ' + kind + '):', e.message);
      }
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
  CheckinError, start, ensureChat, botSeen, onChatMessage, submit, today, history, dayReport, userHistory,
  getSettings: async () => publicSettings(await getSettings()), updateSettings, localNow, TZ,
};
