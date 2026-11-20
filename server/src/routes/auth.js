const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const pool = require('../db');
const { requireAuth } = require('../middleware/auth');
const users = require('../users');

const router = express.Router();
const MAX_ATTEMPTS = 5;
const LOCK_MINUTES = 15;
const PIN_RE = /^\d{4,6}$/;
// compared when the phone is unknown, so a wrong phone takes as long as a wrong PIN (no phone enumeration by timing)
const DUMMY_HASH = bcrypt.hashSync('dummy-pin-0000', 10);

const hashCode = (code) => crypto.createHash('sha256').update(String(code).trim().toUpperCase()).digest('hex');
const publicUser = (u) => ({ id: u.id, phone: u.phone, name: u.name, role: u.role, avatarEmoji: u.avatar_emoji || null, avatarUrl: u.avatar_url || null, profileDone: !!u.profile_done });
// Indian numbers are stored as plain 10 digits: "+91 98712 72058", "919871272058", "09871272058" -> "9871272058"
function normPhone(p) {
  let s = String(p || '').replace(/[\s()-]+/g, '');
  if (/^\+91\d{10}$/.test(s)) s = s.slice(3);
  else if (/^91\d{10}$/.test(s)) s = s.slice(2);
  else if (/^0\d{10}$/.test(s)) s = s.slice(1);
  return s;
}

// ---------- rate limit (in memory; one PM2 process) ----------
// /auth/login and /auth/activate: 10 per minute and 50 per hour per IP -> 429 RATE_LIMITED.
const hits = new Map(); // ip -> [timestamps]
setInterval(() => {
  const cut = Date.now() - 3600000;
  for (const [ip, list] of hits) { const keep = list.filter((t) => t > cut); if (keep.length) hits.set(ip, keep); else hits.delete(ip); }
}, 600000).unref();
function rateLimit(req, res, next) {
  const ip = req.ip || 'x';
  const now = Date.now();
  const list = (hits.get(ip) || []).filter((t) => t > now - 3600000);
  if (list.filter((t) => t > now - 60000).length >= 10 || list.length >= 50) {
    return res.status(429).json({ error: 'Bahut zyada koshish. Thodi der baad try karein.', code: 'RATE_LIMITED' });
  }
  list.push(now);
  hits.set(ip, list);
  next();
}

// New login: rotate the session (old device -> 401 SESSION_REPLACED / ws 4409) and sign {id, sv}.
async function startSession(u) {
  const sv = crypto.randomBytes(16).toString('hex');
  await pool.query('UPDATE users SET session_id = ? WHERE id = ?', [sv, u.id]);
  require('../realtime').closeUser(u.id, 4409, 'SESSION_REPLACED');
  return jwt.sign({ id: u.id, sv }, process.env.JWT_SECRET, { expiresIn: '30d' });
}

// failed attempt counter shared by login and activate: MAX_ATTEMPTS -> locked LOCK_MINUTES
async function failAttempt(u) {
  const expired = u.locked_until && new Date(u.locked_until) <= new Date();
  const attempts = (expired ? 0 : u.failed_attempts) + 1;
  if (attempts >= MAX_ATTEMPTS) {
    await pool.query('UPDATE users SET failed_attempts = 0, locked_until = DATE_ADD(NOW(), INTERVAL ? MINUTE) WHERE id = ?', [LOCK_MINUTES, u.id]);
  } else {
    await pool.query('UPDATE users SET failed_attempts = ?, locked_until = NULL WHERE id = ?', [attempts, u.id]);
  }
}
const locked = (u) => u.locked_until && new Date(u.locked_until) > new Date();
const lockedRes = (res) => res.status(429).json({ error: 'Too many attempts. Try again later.', code: 'LOCKED' });

router.post('/activate', rateLimit, async (req, res) => {
  try {
    const phone = normPhone(req.body.phone);
    const { inviteCode, pin } = req.body;
    const fail = () => res.status(400).json({ error: 'Invalid phone or invite code' });
    if (!phone || !inviteCode) return fail();
    if (!PIN_RE.test(String(pin || ''))) return res.status(400).json({ error: 'PIN must be 4 to 6 digits' });
    const [[u]] = await pool.query('SELECT * FROM users WHERE phone = ? AND active = 1', [phone]);
    if (!u) return fail();
    if (locked(u)) return lockedRes(res);
    const [[inv]] = await pool.query(
      'SELECT id FROM invites WHERE user_id = ? AND code = ? AND used_at IS NULL', [u.id, hashCode(inviteCode)]);
    if (!inv) { await failAttempt(u); return fail(); }
    // B-15: claim the invite atomically BEFORE touching the user; only the request that flips used_at may set the PIN
    const [claim] = await pool.query('UPDATE invites SET used_at = NOW() WHERE id = ? AND used_at IS NULL', [inv.id]);
    if (!claim.affectedRows) return fail();
    const pinHash = await bcrypt.hash(String(pin), 10);
    await pool.query('UPDATE users SET pin_hash = ?, failed_attempts = 0, locked_until = NULL WHERE id = ?', [pinHash, u.id]);
    require('../realtime').sendToBosses({ type: 'users' }).catch(() => {});
    await require('../checkins').ensureChat(u.id).catch((e) => console.error('checkin chat:', e.message)); // members: private 'Daily Check-in' chat (no-op for boss)
    res.json({ token: await startSession(u), user: publicUser(u) });
  } catch (e) {
    res.status(500).json({ error: 'Server error' });
  }
});

router.post('/login', rateLimit, async (req, res) => {
  try {
    const phone = normPhone(req.body.phone);
    const pin = String(req.body.pin || '');
    const bad = () => res.status(401).json({ error: 'Invalid phone or PIN' });
    const [[u]] = await pool.query('SELECT * FROM users WHERE phone = ?', [phone]);
    if (!u || !u.active || !u.pin_hash) { await bcrypt.compare(pin, DUMMY_HASH); return bad(); }
    if (locked(u)) return lockedRes(res);
    const ok = await bcrypt.compare(pin, u.pin_hash);
    if (!ok) { await failAttempt(u); return bad(); }
    await pool.query('UPDATE users SET failed_attempts = 0, locked_until = NULL WHERE id = ?', [u.id]);
    res.json({ token: await startSession(u), user: publicUser(u) });
  } catch (e) {
    res.status(500).json({ error: 'Server error' });
  }
});

// A-05: POST /auth/logout revokes this login server-side: session_id is rotated, so the JWT fails on the next request
// (401 SESSION_REPLACED) and ws connect (4409); live sockets of the user are closed now with 4401. The app calls it after
// stopping its own socket (else it would treat the 4401 as 'logged out by admin'). Signed media URLs already handed out
// stay valid until they expire (MEDIA_URL_TTL_SEC, 30 min).
router.post('/logout', requireAuth, async (req, res) => {
  try {
    await pool.query('UPDATE users SET session_id = ? WHERE id = ?', [crypto.randomBytes(16).toString('hex'), req.user.id]);
    require('../realtime').closeUser(req.user.id, 4401, 'LOGGED_OUT');
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: 'Server error' });
  }
});

router.get('/me', requireAuth, (req, res) => {
  res.json({ user: publicUser(req.user) });
});

// PATCH /auth/me {name?, avatarEmoji?, avatarUrl?, profileDone?, onboarding?}: own profile. Name 2-60, unique (409 NAME_TAKEN); emoji or null;
// avatarUrl = /media/f/... or null. Onboarding: send {onboarding:true, name?, avatarUrl?} (or {profileDone:true}) -> profile_done = 1.
router.patch('/me', requireAuth, async (req, res) => {
  try {
    const { sets, vals } = await users.profileUpdate(req.body || {}, req.user.id);
    if (!sets.length) return res.status(400).json({ error: 'Nothing to update', code: 'BAD_REQUEST' });
    await pool.query('UPDATE users SET ' + sets.join(', ') + ' WHERE id = ?', [...vals, req.user.id]);
    await users.broadcast(req.user.id);
    const [[u]] = await pool.query('SELECT id, phone, name, role, avatar_emoji, avatar_url, profile_done FROM users WHERE id = ?', [req.user.id]);
    res.json({ user: publicUser(u) });
  } catch (e) {
    if (e instanceof users.UserError) return res.status(e.status).json({ error: e.message, code: e.code });
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
module.exports.hashCode = hashCode;
module.exports.normPhone = normPhone;
module.exports.startSession = startSession;
