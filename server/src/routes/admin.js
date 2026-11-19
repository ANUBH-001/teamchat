const express = require('express');
const crypto = require('crypto');
const pool = require('../db');
const { requireAuth, requireBoss } = require('../middleware/auth');
const { hashCode } = require('./auth');
const rt = require('../realtime');
const checkins = require('../checkins');
const settings = require('../settings');
const provider = require('../ai/provider');
const users = require('../users');

const userError = (res, e) => {
  if (e instanceof users.UserError) return res.status(e.status).json({ error: e.message, code: e.code });
  res.status(500).json({ error: 'Server error' });
};
// Log a user out everywhere: new session id (old token -> 401 SESSION_REPLACED) + close sockets (4401).
async function killSession(id) {
  await pool.query('UPDATE users SET session_id = ? WHERE id = ?', [crypto.randomBytes(16).toString('hex'), id]);
  rt.closeUser(id, 4401, 'LOGGED_OUT');
}

const router = express.Router();
router.use(requireAuth, requireBoss);

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
function newCode() {
  let c = '';
  for (let i = 0; i < 8; i++) c += ALPHABET[crypto.randomInt(ALPHABET.length)];
  return c;
}

async function createInvite(userId) {
  await pool.query('UPDATE invites SET used_at = NOW() WHERE user_id = ? AND used_at IS NULL', [userId]);
  const code = newCode();
  await pool.query('INSERT INTO invites (user_id, code) VALUES (?, ?)', [userId, hashCode(code)]);
  return code;
}

// Boss: read any chat, optionally with soft-deleted messages (text included).
// Never a member's private check-in chat: the boss reads check-ins only via /admin/checkins.
router.get('/chats/:id/messages', async (req, res) => {
  try {
    const { formatMessage, MSG_SELECT, VISIBLE } = require('./chats');
    const chatId = parseInt(req.params.id, 10);
    const [[chat]] = await pool.query('SELECT type FROM chats WHERE id = ?', [chatId]);
    if (chat && chat.type === 'checkin') return res.status(403).json({ error: 'Not allowed' });
    const before = parseInt(req.query.before, 10);
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 50, 1), 200);
    const incl = req.query.includeDeleted === '1';
    const [rows] = await pool.query(
      MSG_SELECT + 'WHERE m.chat_id = ? ' + (before ? 'AND m.id < ? ' : '') + (incl ? '' : 'AND m.deleted_at IS NULL ') +
      'AND ' + VISIBLE + 'ORDER BY m.id DESC LIMIT ?',
      before ? [chatId, before, req.user.id, limit] : [chatId, req.user.id, limit]);
    res.json({ messages: rows.reverse().map((r) => formatMessage(r, req.user)) });
  } catch (e) {
    res.status(500).json({ error: 'Server error' });
  }
});

router.get('/users', async (req, res) => {
  try {
    const [rows] = await pool.query(
      'SELECT id, phone, name, role, active, avatar_emoji, (pin_hash IS NOT NULL) AS activated, created_at FROM users WHERE is_bot = 0 ORDER BY name');
    res.json({ users: rows.map(({ avatar_emoji: e, ...r }) => ({ ...r, avatarEmoji: e || null, active: !!r.active, activated: !!r.activated })) });
  } catch (e) {
    res.status(500).json({ error: 'Server error' });
  }
});

router.post('/users', async (req, res) => {
  try {
    const name = users.cleanName(req.body.name);
    await users.assertNameFree(name, 0);
    const phone = String(req.body.phone || '').replace(/\s+/g, '');
    const role = req.body.role === 'boss' ? 'boss' : 'member';
    if (!/^\+?\d{7,15}$/.test(phone)) return res.status(400).json({ error: 'Invalid phone number' });
    const [[dup]] = await pool.query('SELECT id FROM users WHERE phone = ?', [phone]);
    if (dup) return res.status(409).json({ error: 'Phone already exists' });
    const [r] = await pool.query('INSERT INTO users (phone, name, role) VALUES (?, ?, ?)', [phone, name, role]);
    const [[chat]] = await pool.query("SELECT id FROM chats WHERE type = 'all' AND deleted_at IS NULL LIMIT 1");
    if (chat) await pool.query('INSERT IGNORE INTO chat_members (chat_id, user_id) VALUES (?, ?)', [chat.id, r.insertId]);
    if (role === 'member') await checkins.ensureChat(r.insertId).catch((e) => console.error('checkin chat:', e.message)); // private 'Daily Check-in' chat (member + bot only)
    const inviteCode = await createInvite(r.insertId);
    users.invalidate();
    rt.sendToBosses({ type: 'users' }).catch(() => {});
    if (chat) rt.sendToChat(chat.id, { type: 'chat', chatId: chat.id }).catch(() => {});
    res.status(201).json({ user: { id: r.insertId, phone, name, role, active: true }, inviteCode });
  } catch (e) {
    userError(res, e);
  }
});

router.post('/users/:id/invite', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const [[u]] = await pool.query('SELECT id FROM users WHERE id = ? AND is_bot = 0', [id]);
    if (!u) return res.status(404).json({ error: 'User not found' });
    await pool.query('UPDATE users SET pin_hash = NULL, failed_attempts = 0, locked_until = NULL WHERE id = ?', [id]);
    await killSession(id); // reset PIN / new invite also logs the current device out
    const inviteCode = await createInvite(id);
    rt.sendToBosses({ type: 'users' }).catch(() => {});
    res.json({ inviteCode });
  } catch (e) {
    res.status(500).json({ error: 'Server error' });
  }
});

// Log a member's device out (new session id + close sockets). Their next request gets 401.
router.post('/users/:id/logout', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const [[u]] = await pool.query('SELECT id FROM users WHERE id = ? AND is_bot = 0', [id || 0]);
    if (!u) return res.status(404).json({ error: 'User not found' });
    await killSession(id);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: 'Server error' });
  }
});

// PATCH /admin/users/:id {name?, avatarEmoji?, active?}. Name unique (409 NAME_TAKEN). ws {type:'user'} to everyone.
router.patch('/users/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const [[target]] = await pool.query('SELECT id FROM users WHERE id = ? AND is_bot = 0', [id || 0]);
    if (!target) return res.status(404).json({ error: 'User not found' });
    const { sets, vals, changes } = await users.profileUpdate(req.body || {}, id);
    if (req.body.active !== undefined) {
      if (id === req.user.id && !req.body.active) return res.status(400).json({ error: 'Cannot deactivate yourself' });
      sets.push('active = ?'); vals.push(req.body.active ? 1 : 0);
    }
    if (!sets.length) return res.status(400).json({ error: 'Nothing to update' });
    await pool.query('UPDATE users SET ' + sets.join(', ') + ' WHERE id = ? AND is_bot = 0', [...vals, id]);
    users.invalidate();
    if (req.body.active !== undefined && !req.body.active) rt.closeUser(id);
    if (req.body.active) await checkins.ensureChat(id).catch((e) => console.error('checkin chat:', e.message)); // no-op for bosses or if it exists
    if (Object.keys(changes).length) await users.broadcast(id);
    rt.sendToBosses({ type: 'users' }).catch(() => {});
    res.json({ ok: true });
  } catch (e) {
    userError(res, e);
  }
});

// ---------- Settings (server-side switches) ----------
const settingsError = (res, e) => {
  if (e instanceof settings.SettingsError) return res.status(400).json({ error: e.message, code: 'BAD_REQUEST' });
  res.status(500).json({ error: 'Server error' });
};

router.get('/settings', async (req, res) => {
  try {
    const s = await settings.all();
    const ai = provider.status();
    res.json({ settings: s, ai: { provider: ai.provider, model: ai.model, hasKey: ai.hasKey, lastError: ai.lastError } });
  } catch (e) {
    settingsError(res, e);
  }
});

router.put('/settings', async (req, res) => {
  try {
    const s = await settings.update(req.body);
    rt.sendToAll({ type: 'settings' });
    res.json({ settings: s });
  } catch (e) {
    settingsError(res, e);
  }
});

router.post('/settings/test-ai', async (req, res) => {
  try {
    res.json(await provider.testAi());
  } catch (e) {
    res.status(500).json({ error: 'Server error' });
  }
});

async function chatForSettings(req, res) {
  const chatId = parseInt(req.params.id, 10);
  const [[chat]] = await pool.query('SELECT id FROM chats WHERE id = ? AND deleted_at IS NULL', [chatId || 0]);
  if (!chat) { res.status(404).json({ error: 'Chat not found', code: 'NOT_FOUND' }); return null; }
  return chat.id;
}

router.get('/chats/:id/settings', async (req, res) => {
  try {
    const chatId = await chatForSettings(req, res);
    if (chatId) res.json({ settings: await settings.forChat(chatId) });
  } catch (e) {
    settingsError(res, e);
  }
});

router.put('/chats/:id/settings', async (req, res) => {
  try {
    const chatId = await chatForSettings(req, res);
    if (!chatId) return;
    const s = await settings.updateChat(chatId, req.body);
    rt.sendToAll({ type: 'settings', chatId });
    res.json({ settings: s });
  } catch (e) {
    settingsError(res, e);
  }
});

// ---------- Danger zone / debug ----------
// POST /admin/reset {confirm:'RESET'} -> {ok, backup, chatsDeleted}; ws {type:'reset'} to everyone.
router.post('/reset', async (req, res) => {
  try {
    if ((req.body || {}).confirm !== 'RESET') return res.status(400).json({ error: 'Type RESET to confirm', code: 'BAD_REQUEST' });
    res.json(await require('../jobs').resetAll(req.user));
  } catch (e) {
    console.error('admin reset:', e.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// POST /admin/jobs/run {job:'purge'|'reminders'|'taskcleanup'|'morning'|'evening'} -> {ok, job, result} (runs now, for testing)
router.post('/jobs/run', async (req, res) => {
  try {
    const job = String((req.body || {}).job || '');
    const result = await require('../jobs').runNow(job);
    if (result === null) return res.status(400).json({ error: 'Unknown job', code: 'BAD_REQUEST' });
    res.json({ ok: true, job, result });
  } catch (e) {
    console.error('job run:', e.message);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
