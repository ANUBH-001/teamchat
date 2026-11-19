// Users cache (id -> {id, name, role, avatarEmoji, active, isBot}) for hot paths (task notify, event names) +
// shared validation for names / emoji avatars (PATCH /auth/me, admin create/rename). invalidate() after any user write.
const pool = require('./db');

let cache = null;
let loading = null;

async function load() {
  const [rows] = await pool.query('SELECT id, name, role, active, is_bot, avatar_emoji FROM users');
  const m = new Map();
  for (const r of rows) {
    m.set(r.id, { id: r.id, name: r.name, role: r.role, active: !!r.active, isBot: !!r.is_bot, avatarEmoji: r.avatar_emoji || null });
  }
  return m;
}

async function all() {
  if (cache) return cache;
  if (!loading) loading = load().then((m) => { cache = m; loading = null; return m; }, (e) => { loading = null; throw e; });
  return loading;
}
const invalidate = () => { cache = null; };
const get = async (id) => (await all()).get(Number(id)) || null;
const bossIds = async () => [...(await all()).values()].filter((u) => u.role === 'boss' && u.active && !u.isBot).map((u) => u.id);

class UserError extends Error {
  constructor(status, message, code) { super(message); this.status = status; this.code = code || 'BAD_REQUEST'; }
}

// Name: trimmed, 2-60 chars, no @ # / or newlines.
function cleanName(v) {
  const name = String(v == null ? '' : v).replace(/\s+/g, ' ').trim();
  if (name.length < 2 || name.length > 60 || /[@#/\\\n\r]/.test(String(v))) {
    throw new UserError(400, 'Naam 2-60 letters ka ho, @ # / ke bina', 'BAD_NAME');
  }
  return name;
}

// Unique among active users, case-insensitive (existing duplicates stay until someone renames; no DB index on purpose).
async function assertNameFree(name, exceptId) {
  const [[dup]] = await pool.query(
    'SELECT id FROM users WHERE active = 1 AND is_bot = 0 AND LOWER(TRIM(name)) = LOWER(?) AND id <> ? LIMIT 1', [name, exceptId || 0]);
  if (dup) throw new UserError(409, 'Ye naam pehle se kisi ka hai, thoda alag naam rakhiye', 'NAME_TAKEN');
}

// Emoji avatar: one emoji (<= 16 UTF-16 units, pictographic, no spaces) or null to clear.
function cleanEmoji(v) {
  if (v === null || v === '') return null;
  const e = String(v).trim();
  const flag = /^[\u{1F1E6}-\u{1F1FF}]{2}$/u.test(e); // country flag = two regional indicators (not "pictographic")
  const one = [...new Intl.Segmenter('en', { granularity: 'grapheme' }).segment(e)].length === 1; // exactly one emoji
  if (!e || e.length > 16 || /\s/.test(e) || !one || (!flag && (!/\p{Extended_Pictographic}/u.test(e) || /[\p{L}\p{N}]/u.test(e)))) {
    throw new UserError(400, 'Invalid emoji', 'BAD_EMOJI');
  }
  return e;
}

// {name?, avatarEmoji?} -> {sets, vals, changes} for UPDATE users (throws UserError).
async function profileUpdate(body, userId) {
  const sets = []; const vals = []; const changes = {};
  if (body.name !== undefined) {
    const name = cleanName(body.name);
    await assertNameFree(name, userId);
    sets.push('name = ?'); vals.push(name); changes.name = name;
  }
  if (body.avatarEmoji !== undefined) {
    const e = cleanEmoji(body.avatarEmoji);
    sets.push('avatar_emoji = ?'); vals.push(e); changes.avatarEmoji = e;
  }
  return { sets, vals, changes };
}

// After a profile change: refresh cache and tell everyone (ws {type:'user', user:{id, name, avatarEmoji}}).
async function broadcast(userId) {
  invalidate();
  const u = await get(userId);
  if (u) require('./realtime').sendToAll({ type: 'user', user: { id: u.id, name: u.name, avatarEmoji: u.avatarEmoji } });
}

module.exports = { all, get, invalidate, bossIds, cleanName, cleanEmoji, assertNameFree, profileUpdate, broadcast, UserError };
