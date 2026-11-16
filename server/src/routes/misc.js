const express = require('express');
const pool = require('../db');
const { requireAuth } = require('../middleware/auth');
const rt = require('../realtime');

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
    const [[m]] = await pool.query('SELECT id, chat_id, sender_id, deleted_at FROM messages WHERE id = ?', [id]);
    if (!m) return res.status(404).json({ error: 'Message not found' });
    const [[mem]] = await pool.query(
      'SELECT 1 x FROM chat_members WHERE chat_id = ? AND user_id = ? AND left_at IS NULL', [m.chat_id, req.user.id]);
    if (!mem) return res.status(403).json({ error: 'Not allowed' });
    if (m.sender_id !== req.user.id && req.user.role !== 'boss') return res.status(403).json({ error: 'Not allowed' });
    if (!m.deleted_at) {
      await pool.query('UPDATE messages SET deleted_at = NOW() WHERE id = ?', [id]);
      await rt.sendToChat(m.chat_id, { type: 'deleted', chatId: m.chat_id, messageId: id });
    }
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
