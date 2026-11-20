// Users cache (id -> {id, name, role, avatarEmoji, active, isBot}) for hot paths (task notify, event names) +
// shared validation for names / emoji avatars (PATCH /auth/me, admin create/rename). invalidate() after any user write.
const pool = require('./db');

let cache = null;
let loading = null;

async function load() {
  const [rows] = await pool.query('SELECT id, name, role, active, is_bot, avatar_emoji, avatar_url, profile_done FROM users');
  const m = new Map();
  for (const r of rows) {
    m.set(r.id, { id: r.id, name: r.name, role: r.role, active: !!r.active, isBot: !!r.is_bot, avatarEmoji: r.avatar_emoji || null, avatarUrl: r.avatar_url || null, profileDone: !!r.profile_done });
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
const fileExists = (f) => !!f && require('fs').existsSync(f);
// actorId: who is editing (the user, or the boss via Admin); a new photo must be a file that one of them uploaded (B-03).
async function profileUpdate(body, userId, actorId = userId) {
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
  if (body.avatarUrl !== undefined) { // Round 4: uploaded photo (POST /media) or null to clear
    const u = body.avatarUrl;
    if (u !== null && !(typeof u === 'string' && u.startsWith('/media/f/') && u.length <= 255 && fileExists(require('./routes/media').resolvePath(u)))) {
      throw new UserError(400, 'Invalid avatarUrl', 'BAD_AVATAR');
    }
    // B-03: a profile photo is visible to everyone, so it must be the user's (or the editing boss's) own upload, or unchanged;
    // otherwise anyone could publish a private chat photo by setting its path as their avatar
    if (u !== null) {
      const [[ok]] = await pool.query(
        'SELECT (SELECT COUNT(*) FROM media_files WHERE path = ? AND uploader_id IN (?, ?)) + (SELECT COUNT(*) FROM users WHERE id = ? AND avatar_url = ?) n',
        [u, userId, actorId, userId, u]);
      if (!Number(ok.n)) throw new UserError(400, 'Invalid avatarUrl', 'BAD_AVATAR');
    }
    sets.push('avatar_url = ?'); vals.push(u); changes.avatarUrl = u;
  }
  // Round 4 onboarding: name / avatar saved from the onboarding screen, or an explicit {profileDone:true}, finishes it
  if (body.profileDone === true || (body.onboarding === true && (body.name !== undefined || body.avatarUrl !== undefined || body.avatarEmoji !== undefined))) {
    sets.push('profile_done = 1'); changes.profileDone = true;
  }
  return { sets, vals, changes };
}

// After a profile change: refresh cache and tell everyone (ws {type:'user', user:{id, name, avatarEmoji, avatarUrl, profileDone}}).
async function broadcast(userId) {
  invalidate();
  const u = await get(userId);
  if (u) require('./realtime').sendToAll({ type: 'user', user: { id: u.id, name: u.name, avatarEmoji: u.avatarEmoji, avatarUrl: u.avatarUrl, profileDone: u.profileDone } });
}

module.exports = { all, get, invalidate, bossIds, cleanName, cleanEmoji, assertNameFree, profileUpdate, broadcast, UserError };
