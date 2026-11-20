const express = require('express');
const pool = require('../db');
const { requireAuth } = require('../middleware/auth');
const rt = require('../realtime');
const settings = require('../settings');

const router = express.Router();
router.use(requireAuth);

// People list for picking group members / starting a DM. ?includeSelf=1 adds me (task pickers, user store).
router.get('/users', async (req, res) => {
  try {
    const self = req.query.includeSelf === '1' || req.query.includeSelf === 'true';
    const [rows] = await pool.query(
      'SELECT id, name, phone, role, avatar_emoji, avatar_url, profile_done FROM users WHERE active = 1 AND is_bot = 0' + (self ? '' : ' AND id <> ?') + ' ORDER BY name',
      self ? [] : [req.user.id]);
    res.json({ users: rows.map((r) => ({ id: r.id, name: r.name, phone: r.phone, role: r.role, avatarEmoji: r.avatar_emoji || null, avatarUrl: r.avatar_url || null, profileDone: !!r.profile_done })) });
  } catch (e) {
    res.status(500).json({ error: 'Server error' });
  }
});

// Edit / delete: only your own text message, within EDIT_WINDOW (10 min) of sending, for everyone (boss too).
// Exception: an ephemeral bot card shown only to you can always be deleted by you. Bot/system/check-in cards: never.
const EDIT_WINDOW_S = 600;
const windowError = (res) => res.status(403).json({ error: 'Sirf 10 minute ke andar apna message edit/delete ho sakta hai', code: 'EDIT_WINDOW' });

async function ownMessage(req, res) {
  const id = parseInt(req.params.id, 10);
  const [[m]] = await pool.query(
    'SELECT id, chat_id, sender_id, body, type, deleted_at, visible_to, mentions, TIMESTAMPDIFF(SECOND, created_at, NOW()) age FROM messages WHERE id = ?',
    [id || 0]);
  if (!m || (m.visible_to && m.visible_to !== req.user.id)) { res.status(404).json({ error: 'Message not found', code: 'NOT_FOUND' }); return null; }
  if (!(await rt.isChatMember(m.chat_id, req.user.id))) { res.status(403).json({ error: 'Not allowed', code: 'NOT_ALLOWED' }); return null; }
  return m;
}

// Soft delete (deleted_at). ws {type:'deleted', chatId, messageId}.
router.delete('/messages/:id', async (req, res) => {
  try {
    const m = await ownMessage(req, res);
    if (!m) return;
    const myEphemeral = m.visible_to === req.user.id;
    if (!myEphemeral) {
      if (m.sender_id !== req.user.id || !['text', 'image', 'audio'].includes(m.type)) return res.status(403).json({ error: 'Not allowed', code: 'NOT_ALLOWED' });
      if (Number(m.age) > EDIT_WINDOW_S) return windowError(res);
    }
    if (!m.deleted_at) {
      await pool.query('UPDATE messages SET deleted_at = NOW() WHERE id = ?', [m.id]);
      const ev = { type: 'deleted', chatId: m.chat_id, messageId: Number(m.id) };
      if (m.visible_to) rt.sendToUser(m.visible_to, ev); else await rt.sendToChat(m.chat_id, ev);
      // a note made from this message (reply chain / card reply / #N) is marked deleted on the task timeline
      if (!myEphemeral) {
        setImmediate(() => require('../ai/commands').onSourceDeleted(m, req.user).catch((e) => console.error('note delete:', e.message)));
      }
    }
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: 'Server error' });
  }
});

// PATCH /messages/:id {text}: old body kept in message_revisions, edited_at set, mentions re-read.
// ws {type:'edited', chatId, message}. Commands in an edited message are NOT run again.
router.patch('/messages/:id', async (req, res) => {
  try {
    const text = String((req.body || {}).text || '').trim();
    if (text.length > 4000) return res.status(400).json({ error: 'Message is empty or too long' });
    const m = await ownMessage(req, res);
    if (!m) return;
    // Round 4: own photo / voice note caption can be edited too (caption may become empty); commands are never re-run
    const isMedia = m.type === 'image' || m.type === 'audio';
    if (!text && !isMedia) return res.status(400).json({ error: 'Message is empty or too long' });
    if (m.sender_id !== req.user.id || (m.type !== 'text' && !isMedia) || m.visible_to) return res.status(403).json({ error: 'Not allowed', code: 'NOT_ALLOWED' });
    if (m.deleted_at) return res.status(400).json({ error: 'Message was deleted' });
    if (Number(m.age) > EDIT_WINDOW_S) return windowError(res);
    const { MSG_SELECT, formatMessage, resolveMentions, reactionsFor } = require('./chats');
    if (text !== m.body) {
      const { ids } = await resolveMentions(text, m.chat_id, req.body.mentionIds);
      await pool.query('INSERT INTO message_revisions (message_id, old_body) VALUES (?, ?)', [m.id, m.body]);
      await pool.query('UPDATE messages SET body = ?, edited_at = NOW(), mentions = ? WHERE id = ?',
        [text, ids.length ? JSON.stringify(ids) : null, m.id]);
    }
    const [[row]] = await pool.query(MSG_SELECT + 'WHERE m.id = ?', [m.id]);
    const message = formatMessage(row, req.user);
    message.reactions = (await reactionsFor([message.id])).get(message.id) || [];
    if (text !== m.body) await rt.sendToChat(m.chat_id, { type: 'edited', chatId: m.chat_id, message });
    res.json({ message });
    // Edit propagation (inside the 10-min window, author only, both enforced above): task title/description/due made
    // by this message, notes from it, and the cards attached to it. Status / assignees are never changed by an edit.
    if (text !== m.body && !isMedia) {
      const { tagged } = await resolveMentions(text, m.chat_id, req.body.mentionIds).catch(() => ({ tagged: [] }));
      setImmediate(() => require('../ai/commands').onSourceEdited(message, req.user, { tagged, oldText: m.body })
        .catch((e) => console.error('edit propagation:', e.message)));
    }
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
    if (!emoji || emoji.length > 16 || /\s/.test(emoji) || /^[\p{L}\p{N}]+$/u.test(emoji)) return res.status(400).json({ error: 'Invalid emoji' });
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
