const express = require('express');
const crypto = require('crypto');
const pool = require('../db');
const { requireAuth, requireBoss } = require('../middleware/auth');
const { hashCode } = require('./auth');
const rt = require('../realtime');

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

// Boss: read any chat, optionally with soft-deleted messages (text included)
router.get('/chats/:id/messages', async (req, res) => {
  try {
    const { formatMessage, MSG_SELECT } = require('./chats');
    const chatId = parseInt(req.params.id, 10);
    const before = parseInt(req.query.before, 10);
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 50, 1), 200);
    const incl = req.query.includeDeleted === '1';
    const [rows] = await pool.query(
      MSG_SELECT + 'WHERE m.chat_id = ? ' + (before ? 'AND m.id < ? ' : '') + (incl ? '' : 'AND m.deleted_at IS NULL ') +
      'ORDER BY m.id DESC LIMIT ?',
      before ? [chatId, before, limit] : [chatId, limit]);
    res.json({ messages: rows.reverse().map((r) => formatMessage(r, req.user)) });
  } catch (e) {
    res.status(500).json({ error: 'Server error' });
  }
});

router.get('/users', async (req, res) => {
  try {
    const [rows] = await pool.query(
      'SELECT id, phone, name, role, active, (pin_hash IS NOT NULL) AS activated, created_at FROM users WHERE is_bot = 0 ORDER BY name');
    res.json({ users: rows.map((r) => ({ ...r, active: !!r.active, activated: !!r.activated })) });
  } catch (e) {
    res.status(500).json({ error: 'Server error' });
  }
});

router.post('/users', async (req, res) => {
  try {
    const name = String(req.body.name || '').trim();
    const phone = String(req.body.phone || '').replace(/\s+/g, '');
    const role = req.body.role === 'boss' ? 'boss' : 'member';
    if (!name || name.length > 100) return res.status(400).json({ error: 'Name is required' });
    if (!/^\+?\d{7,15}$/.test(phone)) return res.status(400).json({ error: 'Invalid phone number' });
    const [[dup]] = await pool.query('SELECT id FROM users WHERE phone = ?', [phone]);
    if (dup) return res.status(409).json({ error: 'Phone already exists' });
    const [r] = await pool.query('INSERT INTO users (phone, name, role) VALUES (?, ?, ?)', [phone, name, role]);
    const [[chat]] = await pool.query("SELECT id FROM chats WHERE type = 'all' AND deleted_at IS NULL LIMIT 1");
    if (chat) await pool.query('INSERT IGNORE INTO chat_members (chat_id, user_id) VALUES (?, ?)', [chat.id, r.insertId]);
    const inviteCode = await createInvite(r.insertId);
    rt.sendToBosses({ type: 'users' }).catch(() => {});
    if (chat) rt.sendToChat(chat.id, { type: 'chat', chatId: chat.id }).catch(() => {});
    res.status(201).json({ user: { id: r.insertId, phone, name, role, active: true }, inviteCode });
  } catch (e) {
    res.status(500).json({ error: 'Server error' });
  }
});

router.post('/users/:id/invite', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const [[u]] = await pool.query('SELECT id FROM users WHERE id = ? AND is_bot = 0', [id]);
    if (!u) return res.status(404).json({ error: 'User not found' });
    await pool.query('UPDATE users SET pin_hash = NULL, failed_attempts = 0, locked_until = NULL WHERE id = ?', [id]);
    const inviteCode = await createInvite(id);
    rt.sendToBosses({ type: 'users' }).catch(() => {});
    res.json({ inviteCode });
  } catch (e) {
    res.status(500).json({ error: 'Server error' });
  }
});

router.patch('/users/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const sets = [];
    const vals = [];
    if (req.body.active !== undefined) {
      if (id === req.user.id && !req.body.active) return res.status(400).json({ error: 'Cannot deactivate yourself' });
      sets.push('active = ?'); vals.push(req.body.active ? 1 : 0);
    }
    if (req.body.name !== undefined) {
      const name = String(req.body.name).trim();
      if (!name || name.length > 100) return res.status(400).json({ error: 'Invalid name' });
      sets.push('name = ?'); vals.push(name);
    }
    if (!sets.length) return res.status(400).json({ error: 'Nothing to update' });
    const [r] = await pool.query('UPDATE users SET ' + sets.join(', ') + ' WHERE id = ? AND is_bot = 0', [...vals, id]);
    if (!r.affectedRows) return res.status(404).json({ error: 'User not found' });
    if (req.body.active !== undefined && !req.body.active) rt.closeUser(id);
    rt.sendToBosses({ type: 'users' }).catch(() => {});
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
