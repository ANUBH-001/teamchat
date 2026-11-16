const express = require('express');
const pool = require('../db');
const { requireAuth } = require('../middleware/auth');
const rt = require('../realtime');
const checkins = require('../checkins');

const router = express.Router();
router.use(requireAuth);

// Shape a messages row (joined with sender name) for the API. Boss still gets text of deleted ones.
function formatMessage(r, viewer) {
  const deleted = !!r.deleted_at;
  return {
    id: Number(r.id),
    chatId: r.chat_id,
    senderId: r.sender_id,
    senderName: r.sender_name,
    text: deleted && viewer.role !== 'boss' ? null : r.body,
    deleted,
    clientId: r.client_id,
    createdAt: r.created_at,
    type: r.type || 'text',
    payload: parsePayload(deleted && viewer.role !== 'boss' ? null : r.payload),
    replyTo: r.reply_to_id ? {
      id: Number(r.reply_to_id),
      senderName: r.reply_sender_name || '',
      text: r.reply_deleted_at ? null : String(r.reply_body || '').slice(0, 200),
      deleted: !!r.reply_deleted_at,
    } : null,
  };
}

function parsePayload(s) {
  if (!s) return null;
  try { return JSON.parse(s); } catch (e) { return null; }
}

const MSG_SELECT =
  'SELECT m.id, m.chat_id, m.sender_id, m.body, m.created_at, m.deleted_at, m.client_id, m.type, m.payload, m.reply_to_id, ' +
  'u.name sender_name, rm.body reply_body, rm.deleted_at reply_deleted_at, ru.name reply_sender_name ' +
  'FROM messages m JOIN users u ON u.id = m.sender_id ' +
  'LEFT JOIN messages rm ON rm.id = m.reply_to_id LEFT JOIN users ru ON ru.id = rm.sender_id ';

// Membership incl. the check-in privacy guard (realtime.MEMBER_OK): nobody but the owner can open a check-in chat.
const isMember = (chatId, userId) => rt.isChatMember(chatId, userId);

async function statusFor(chatId, userId) {
  const [rows] = await pool.query(
    'SELECT cm.user_id, cm.last_read_message_id r, cm.last_delivered_message_id d ' + rt.MEMBER_FROM +
    'WHERE cm.chat_id = ? AND cm.left_at IS NULL AND cm.user_id <> ? AND ' + rt.MEMBER_OK, [chatId, userId]);
  if (!rows.length) return { delivered: 0, read: 0 };
  const read = Math.min(...rows.map((o) => Number(o.r || 0)));
  const delivered = Math.max(read, Math.min(...rows.map((o) => Number(o.d || 0))));
  return { delivered, read };
}

// Chat list rows for a user (optionally just one chat).
async function chatSummaries(user, onlyChatId) {
  const [rows] = await pool.query(
    `SELECT c.id, c.type, c.name,
       lm.id lm_id, lm.body lm_body, lm.sender_id lm_sender_id, lm.created_at lm_at, lm.deleted_at lm_deleted, su.name lm_sender,
       (SELECT COUNT(*) FROM chat_members x WHERE x.chat_id = c.id AND x.left_at IS NULL) members,
       (SELECT COUNT(*) FROM messages un WHERE un.chat_id = c.id AND un.id > COALESCE(cm.last_read_message_id, 0)
          AND un.sender_id <> ? AND un.deleted_at IS NULL) unread
     FROM chat_members cm
     JOIN chats c ON c.id = cm.chat_id
     LEFT JOIN messages lm ON lm.id = (SELECT MAX(id) FROM messages WHERE chat_id = c.id)
     LEFT JOIN users su ON su.id = lm.sender_id
     WHERE cm.user_id = ? AND cm.left_at IS NULL AND c.deleted_at IS NULL
       AND (c.type <> 'checkin' OR c.owner_id = cm.user_id)` + (onlyChatId ? ' AND c.id = ?' : ''),
    onlyChatId ? [user.id, user.id, onlyChatId] : [user.id, user.id]);
  const dmIds = rows.filter((r) => r.type === 'dm').map((r) => r.id);
  const others = {};
  if (dmIds.length) {
    const [o] = await pool.query(
      'SELECT cm.chat_id, u.id, u.name FROM chat_members cm JOIN users u ON u.id = cm.user_id ' +
      'WHERE cm.chat_id IN (?) AND cm.user_id <> ?', [dmIds, user.id]);
    for (const r of o) others[r.chat_id] = r;
  }
  const list = rows.map((r) => ({
    id: r.id,
    type: r.type,
    name: r.type === 'dm' ? (others[r.id] ? others[r.id].name : 'Chat') : r.name,
    otherUserId: r.type === 'dm' && others[r.id] ? others[r.id].id : null,
    membersCount: Number(r.members),
    unread: Number(r.unread),
    lastMessage: r.lm_id ? {
      id: Number(r.lm_id),
      senderId: r.lm_sender_id,
      senderName: r.lm_sender,
      text: r.lm_deleted && user.role !== 'boss' ? null : r.lm_body,
      deleted: !!r.lm_deleted,
      createdAt: r.lm_at,
    } : null,
  }));
  const rank = (c) => (c.type === 'all' ? 0 : c.type === 'checkin' ? 1 : 2); // All Team, then Daily Check-in, then newest
  list.sort((a, b) => {
    if (rank(a) !== rank(b)) return rank(a) - rank(b);
    const ta = a.lastMessage ? new Date(a.lastMessage.createdAt).getTime() : 0;
    const tb = b.lastMessage ? new Date(b.lastMessage.createdAt).getTime() : 0;
    return tb - ta;
  });
  return list;
}

router.get('/', async (req, res) => {
  try {
    res.json({ chats: await chatSummaries(req.user) });
  } catch (e) {
    res.status(500).json({ error: 'Server error' });
  }
});

router.post('/', async (req, res) => {
  try {
    const name = String(req.body.name || '').trim();
    if (!name || name.length > 100) return res.status(400).json({ error: 'Group name is required' });
    const ids = [...new Set((Array.isArray(req.body.memberIds) ? req.body.memberIds : [])
      .map((n) => parseInt(n, 10)).filter(Boolean))].filter((i) => i !== req.user.id);
    if (!ids.length) return res.status(400).json({ error: 'Pick at least one member' });
    const [users] = await pool.query('SELECT id FROM users WHERE id IN (?) AND active = 1', [ids]);
    if (users.length !== ids.length) return res.status(400).json({ error: 'Invalid member' });
    const [r] = await pool.query("INSERT INTO chats (type, name, created_by) VALUES ('group', ?, ?)", [name, req.user.id]);
    const all = [req.user.id, ...ids];
    await pool.query('INSERT INTO chat_members (chat_id, user_id) VALUES ?', [all.map((u) => [r.insertId, u])]);
    for (const u of all) if (u !== req.user.id) rt.sendToUser(u, { type: 'chat', chatId: r.insertId });
    const [chat] = await chatSummaries(req.user, r.insertId);
    res.status(201).json({ chat });
  } catch (e) {
    res.status(500).json({ error: 'Server error' });
  }
});

router.post('/dm', async (req, res) => {
  try {
    const otherId = parseInt(req.body.userId, 10);
    if (!otherId || otherId === req.user.id) return res.status(400).json({ error: 'Invalid user' });
    const [[other]] = await pool.query('SELECT id FROM users WHERE id = ? AND active = 1', [otherId]);
    if (!other) return res.status(404).json({ error: 'User not found' });
    const [[ex]] = await pool.query(
      `SELECT c.id FROM chats c
       JOIN chat_members a ON a.chat_id = c.id AND a.user_id = ?
       JOIN chat_members b ON b.chat_id = c.id AND b.user_id = ?
       WHERE c.type = 'dm' AND c.deleted_at IS NULL LIMIT 1`, [req.user.id, otherId]);
    let chatId = ex && ex.id;
    let created = false;
    if (!chatId) {
      const [r] = await pool.query("INSERT INTO chats (type, created_by) VALUES ('dm', ?)", [req.user.id]);
      chatId = r.insertId;
      await pool.query('INSERT INTO chat_members (chat_id, user_id) VALUES (?, ?), (?, ?)',
        [chatId, req.user.id, chatId, otherId]);
      created = true;
    }
    if (created) rt.sendToUser(otherId, { type: 'chat', chatId });
    const [chat] = await chatSummaries(req.user, chatId);
    res.status(created ? 201 : 200).json({ chat });
  } catch (e) {
    res.status(500).json({ error: 'Server error' });
  }
});

router.get('/:id/messages', async (req, res) => {
  try {
    const chatId = parseInt(req.params.id, 10);
    if (!(await isMember(chatId, req.user.id))) return res.status(403).json({ error: 'Not allowed' });
    const before = parseInt(req.query.before, 10);
    const after = parseInt(req.query.after, 10);
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 30, 1), 200);
    let rows;
    let hasMore = false;
    if (after) {
      [rows] = await pool.query(MSG_SELECT + 'WHERE m.chat_id = ? AND m.id > ? ORDER BY m.id ASC LIMIT 500', [chatId, after]);
    } else {
      [rows] = await pool.query(
        MSG_SELECT + 'WHERE m.chat_id = ? ' + (before ? 'AND m.id < ? ' : '') + 'ORDER BY m.id DESC LIMIT ?',
        before ? [chatId, before, limit + 1] : [chatId, limit + 1]);
      hasMore = rows.length > limit;
      rows = rows.slice(0, limit).reverse();
    }
    res.json({ messages: rows.map((r) => formatMessage(r, req.user)), hasMore, status: await statusFor(chatId, req.user.id) });
  } catch (e) {
    res.status(500).json({ error: 'Server error' });
  }
});

router.post('/:id/messages', async (req, res) => {
  try {
    const chatId = parseInt(req.params.id, 10);
    if (!(await isMember(chatId, req.user.id))) return res.status(403).json({ error: 'Not allowed' });
    const text = String(req.body.text || '').trim();
    const clientId = String(req.body.clientId || '').slice(0, 64);
    if (!text || text.length > 4000) return res.status(400).json({ error: 'Message is empty or too long' });
    if (!clientId) return res.status(400).json({ error: 'clientId is required' });
    let replyToId = null;
    if (req.body.replyToId != null && req.body.replyToId !== '') {
      replyToId = parseInt(req.body.replyToId, 10);
      if (!replyToId) return res.status(400).json({ error: 'Invalid replyToId' });
      const [[orig]] = await pool.query('SELECT 1 x FROM messages WHERE id = ? AND chat_id = ?', [replyToId, chatId]);
      if (!orig) return res.status(400).json({ error: 'Replied message not found in this chat' });
    }

    const find = async () => {
      const [[row]] = await pool.query(MSG_SELECT + 'WHERE m.sender_id = ? AND m.client_id = ?', [req.user.id, clientId]);
      return row;
    };
    let row = await find();
    if (row) return res.json({ message: formatMessage(row, req.user), duplicate: true });
    let id;
    try {
      const [r] = await pool.query(
        'INSERT INTO messages (chat_id, sender_id, body, client_id, reply_to_id) VALUES (?, ?, ?, ?, ?)',
        [chatId, req.user.id, text, clientId, replyToId]);
      id = r.insertId;
    } catch (e) {
      if (e.code === 'ER_DUP_ENTRY') {
        row = await find();
        return res.json({ message: formatMessage(row, req.user), duplicate: true });
      }
      throw e;
    }
    const [[saved]] = await pool.query(MSG_SELECT + 'WHERE m.id = ?', [id]);
    const message = formatMessage(saved, req.user);
    const [[chatRow]] = await pool.query('SELECT type FROM chats WHERE id = ?', [chatId]);
    const checkinChat = !!chatRow && chatRow.type === 'checkin';

    // sender has seen their own message; connected recipients get it delivered
    const members = await rt.memberIds(chatId);
    const online = members.filter((u) => u !== req.user.id && rt.isOnline(u));
    await pool.query(
      'UPDATE chat_members SET last_read_message_id = GREATEST(COALESCE(last_read_message_id, 0), ?), ' +
      'last_delivered_message_id = GREATEST(COALESCE(last_delivered_message_id, 0), ?) WHERE chat_id = ? AND user_id = ?',
      [id, id, chatId, req.user.id]);
    if (online.length) {
      await pool.query(
        'UPDATE chat_members SET last_delivered_message_id = GREATEST(COALESCE(last_delivered_message_id, 0), ?) ' +
        'WHERE chat_id = ? AND user_id IN (?)', [id, chatId, online]);
    }
    if (checkinChat) await checkins.botSeen(chatId, id); // Team Assistant "reads" check-in replies (ticks)
    for (const u of members) rt.sendToUser(u, { type: 'message', message });
    await rt.pushStatus(chatId);
    res.status(201).json({ message });
    // AI task engine runs after the reply; it can never delay or fail the send.
    setImmediate(() => require('../ai/engine').onMessage(message, req.user).catch((e) => console.error('ai engine:', e.message)));
    // A typed/voice reply in the member's own check-in chat is also stored as today's check-in text.
    if (checkinChat) setImmediate(() => checkins.onChatMessage(message, req.user).catch((e) => console.error('checkin:', e.message)));
  } catch (e) {
    res.status(500).json({ error: 'Server error' });
  }
});

router.post('/:id/read', async (req, res) => {
  try {
    const chatId = parseInt(req.params.id, 10);
    if (!(await isMember(chatId, req.user.id))) return res.status(403).json({ error: 'Not allowed' });
    const [[last]] = await pool.query('SELECT MAX(id) id FROM messages WHERE chat_id = ?', [chatId]);
    const upTo = Math.min(parseInt(req.body.messageId, 10) || Number(last.id || 0), Number(last.id || 0));
    if (upTo) {
      await pool.query(
        'UPDATE chat_members SET last_read_message_id = GREATEST(COALESCE(last_read_message_id, 0), ?), ' +
        'last_delivered_message_id = GREATEST(COALESCE(last_delivered_message_id, 0), ?) WHERE chat_id = ? AND user_id = ?',
        [upTo, upTo, chatId, req.user.id]);
      await rt.pushStatus(chatId);
    }
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
module.exports.formatMessage = formatMessage;
module.exports.MSG_SELECT = MSG_SELECT;
