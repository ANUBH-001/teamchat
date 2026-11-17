const express = require('express');
const pool = require('../db');
const { requireAuth } = require('../middleware/auth');
const rt = require('../realtime');
const settings = require('../settings');

const router = express.Router();
router.use(requireAuth);

// People list for picking group members / starting a DM
router.get('/users', async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT id, name, phone FROM users WHERE active = 1 AND id <> ? ORDER BY name', [req.user.id]);
    res.json({ users: rows });
  } catch (e) {
    res.status(500).json({ error: 'Server error' });
  }
});

// Soft delete: sender or boss
router.delete('/messages/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const [[m]] = await pool.query('SELECT id, chat_id, sender_id, deleted_at, visible_to FROM messages WHERE id = ?', [id]);
    if (!m || (m.visible_to && m.visible_to !== req.user.id)) return res.status(404).json({ error: 'Message not found' });
    if (!(await rt.isChatMember(m.chat_id, req.user.id))) return res.status(403).json({ error: 'Not allowed' });
    if (m.sender_id !== req.user.id && req.user.role !== 'boss') return res.status(403).json({ error: 'Not allowed' });
    if (!m.deleted_at) {
      await pool.query('UPDATE messages SET deleted_at = NOW() WHERE id = ?', [id]);
      const ev = { type: 'deleted', chatId: m.chat_id, messageId: id };
      if (m.visible_to) rt.sendToUser(m.visible_to, ev); else await rt.sendToChat(m.chat_id, ev);
    }
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: 'Server error' });
  }
});

// Reactions: one emoji per user per message. Same emoji again = remove (soft: deleted_at), another emoji = replace.
async function reactionTarget(req, res) {
  const id = parseInt(req.params.id, 10);
  const [[m]] = await pool.query('SELECT id, chat_id, deleted_at, visible_to FROM messages WHERE id = ?', [id || 0]);
  if (!m || m.deleted_at || (m.visible_to && m.visible_to !== req.user.id)) {
    res.status(404).json({ error: 'Message not found', code: 'NOT_FOUND' });
    return null;
  }
  if (!(await rt.isChatMember(m.chat_id, req.user.id))) { res.status(403).json({ error: 'Not allowed', code: 'NOT_ALLOWED' }); return null; }
  return m;
}

async function sendReactions(m) {
  const { reactionsFor } = require('./chats');
  const reactions = (await reactionsFor([Number(m.id)])).get(Number(m.id)) || [];
  const ev = { type: 'reaction', chatId: m.chat_id, messageId: Number(m.id), reactions };
  if (m.visible_to) rt.sendToUser(m.visible_to, ev); else await rt.sendToChat(m.chat_id, ev);
  return reactions;
}

router.post('/messages/:id/reactions', async (req, res) => {
  try {
    const emoji = String((req.body || {}).emoji || '').trim();
    if (!emoji || emoji.length > 16 || /\s/.test(emoji)) return res.status(400).json({ error: 'Invalid emoji' });
    const m = await reactionTarget(req, res);
    if (!m) return;
    const [[mine]] = await pool.query(
      'SELECT emoji FROM message_reactions WHERE message_id = ? AND user_id = ? AND deleted_at IS NULL', [m.id, req.user.id]);
    if (mine && mine.emoji === emoji) {
      await pool.query('UPDATE message_reactions SET deleted_at = NOW() WHERE message_id = ? AND user_id = ?', [m.id, req.user.id]);
    } else {
      await pool.query(
        'INSERT INTO message_reactions (message_id, user_id, emoji) VALUES (?, ?, ?) ' +
        'ON DUPLICATE KEY UPDATE emoji = VALUES(emoji), deleted_at = NULL, created_at = NOW()', [m.id, req.user.id, emoji]);
    }
    res.json({ reactions: await sendReactions(m) });
  } catch (e) {
    res.status(500).json({ error: 'Server error' });
  }
});

// Remove my reaction (whatever emoji).
router.delete('/messages/:id/reactions', async (req, res) => {
  try {
    const m = await reactionTarget(req, res);
    if (!m) return;
    await pool.query('UPDATE message_reactions SET deleted_at = NOW() WHERE message_id = ? AND user_id = ? AND deleted_at IS NULL',
      [m.id, req.user.id]);
    res.json({ reactions: await sendReactions(m) });
  } catch (e) {
    res.status(500).json({ error: 'Server error' });
  }
});

// Switches the app needs (any logged-in user).
router.get('/settings/public', async (req, res) => {
  try {
    res.json(await settings.publicSettings());
  } catch (e) {
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
