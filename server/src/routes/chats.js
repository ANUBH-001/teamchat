const express = require('express');
const pool = require('../db');
const { requireAuth } = require('../middleware/auth');
const rt = require('../realtime');
const checkins = require('../checkins');
const bot = require('../ai/bot');

const router = express.Router();
router.use(requireAuth);
router.param('id', (req, res, next, v) => (/^\d{1,10}$/.test(v) ? next() : res.status(404).json({ error: 'Not found', code: 'NOT_FOUND' }))); // junk chat id: 404, not 500

// Shape a messages row (joined with sender name) for the API. Boss still gets text of deleted ones.
// reactions are filled by withReactions() (REST reads); new messages have none.
function formatMessage(r, viewer) {
  const deleted = !!r.deleted_at;
  return {
    id: Number(r.id),
    chatId: r.chat_id,
    senderId: r.sender_id,
    senderName: r.sender_name,
    senderEmoji: r.sender_emoji || null,
    text: deleted && viewer.role !== 'boss' ? null : r.body,
    deleted,
    clientId: r.client_id,
    createdAt: r.created_at,
    editedAt: r.edited_at || null,
    type: r.type || 'text',
    payload: parsePayload(deleted && viewer.role !== 'boss' ? null : r.payload),
    replyTo: r.reply_to_id ? {
      id: Number(r.reply_to_id),
      senderName: r.reply_sender_name || '',
      text: r.reply_deleted_at ? null : String(r.reply_body || '').slice(0, 200),
      deleted: !!r.reply_deleted_at,
    } : null,
    visibleTo: r.visible_to || null,
    mentions: (parsePayload(r.mentions) || []).filter((n) => Number.isInteger(n)),
    reactions: [],
    sourceMessageId: r.source_message_id ? Number(r.source_message_id) : null,
    taskId: r.task_id || null,
    mediaUrl: deleted && viewer.role !== 'boss' ? null : (r.media_url || null), // Round 4: /media/f/... (image / audio)
    media: deleted && viewer.role !== 'boss' ? null : parsePayload(r.media),
    senderAvatarUrl: r.sender_avatar_url || null,
  };
}

// Round 4: chat-list preview text of a media message ("📷 Photo", "📍 Photo · <address>", "🎤 Voice note (0:14)").
function mediaPreview(type, media) {
  const m = media || {};
  if (type === 'audio') {
    const sec = Math.max(0, Math.round((Number(m.durationMs) || 0) / 1000));
    return '🎤 Voice note (' + Math.floor(sec / 60) + ':' + String(sec % 60).padStart(2, '0') + ')';
  }
  if (m.kind === 'geo_image') return '📍 Photo' + (m.address ? ' · ' + String(m.address).slice(0, 80) : '');
  return '📷 Photo';
}

function parsePayload(s) {
  if (!s) return null;
  try { return JSON.parse(s); } catch (e) { return null; }
}

const MSG_SELECT =
  'SELECT m.id, m.chat_id, m.sender_id, m.body, m.created_at, m.edited_at, m.deleted_at, m.client_id, m.type, m.payload, m.reply_to_id, ' +
  'm.visible_to, m.mentions, m.source_message_id, m.task_id, m.media_url, m.media, u.name sender_name, u.avatar_emoji sender_emoji, u.avatar_url sender_avatar_url, rm.body reply_body, rm.deleted_at reply_deleted_at, ru.name reply_sender_name ' +
  'FROM messages m JOIN users u ON u.id = m.sender_id ' +
  'LEFT JOIN messages rm ON rm.id = m.reply_to_id LEFT JOIN users ru ON ru.id = rm.sender_id ';
// Ephemeral filter for every message read (one placeholder: the viewer id).
const VISIBLE = '(m.visible_to IS NULL OR m.visible_to = ?) ';

// Reactions of some messages -> Map(messageId -> [{emoji, userIds}]).
async function reactionsFor(ids) {
  const out = new Map();
  if (!ids.length) return out;
  const [rows] = await pool.query(
    'SELECT message_id, user_id, emoji FROM message_reactions WHERE message_id IN (?) AND deleted_at IS NULL ORDER BY created_at, user_id', [ids]);
  for (const r of rows) {
    const id = Number(r.message_id);
    if (!out.has(id)) out.set(id, []);
    const list = out.get(id);
    let e = list.find((x) => x.emoji === r.emoji);
    if (!e) { e = { emoji: r.emoji, userIds: [] }; list.push(e); }
    e.userIds.push(r.user_id);
  }
  return out;
}

async function withReactions(messages) {
  const map = await reactionsFor(messages.map((m) => m.id));
  for (const m of messages) m.reactions = map.get(m.id) || [];
  return messages;
}

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

// Chat list rows for a user (optionally just one chat). Ephemeral messages of other users are never counted/shown.
async function chatSummaries(user, onlyChatId) {
  const [rows] = await pool.query(
    `SELECT c.id, c.type, c.name, c.created_by, cm.muted, cm.pinned, cm.favourite, cm.last_read_message_id my_last_read,
       lm.id lm_id, lm.body lm_body, lm.type lm_type, lm.media lm_media, lm.sender_id lm_sender_id, lm.created_at lm_at, lm.deleted_at lm_deleted,
       su.name lm_sender, pm.id pm_id, pm.body pm_body, pu.name pm_sender,
       (SELECT COUNT(*) FROM chat_members x WHERE x.chat_id = c.id AND x.left_at IS NULL) members,
       (SELECT COUNT(*) FROM messages un WHERE un.chat_id = c.id AND un.id > COALESCE(cm.last_read_message_id, 0)
          AND un.sender_id <> ? AND un.deleted_at IS NULL AND (un.visible_to IS NULL OR un.visible_to = ?)) unread
     FROM chat_members cm
     JOIN chats c ON c.id = cm.chat_id
     LEFT JOIN messages lm ON lm.id = (SELECT MAX(id) FROM messages WHERE chat_id = c.id AND (visible_to IS NULL OR visible_to = ?))
     LEFT JOIN users su ON su.id = lm.sender_id
     LEFT JOIN messages pm ON pm.id = c.pinned_message_id AND pm.deleted_at IS NULL
     LEFT JOIN users pu ON pu.id = pm.sender_id
     WHERE cm.user_id = ? AND cm.left_at IS NULL AND c.deleted_at IS NULL
       AND (c.type <> 'checkin' OR c.owner_id = cm.user_id)` + (onlyChatId ? ' AND c.id = ?' : ''),
    [user.id, user.id, user.id, user.id, ...(onlyChatId ? [onlyChatId] : [])]);
  const dmIds = rows.filter((r) => r.type === 'dm').map((r) => r.id);
  const others = {};
  if (dmIds.length) {
    const [o] = await pool.query(
      'SELECT cm.chat_id, u.id, u.name, u.avatar_emoji, u.avatar_url FROM chat_members cm JOIN users u ON u.id = cm.user_id ' +
      'WHERE cm.chat_id IN (?) AND cm.user_id <> ?', [dmIds, user.id]);
    for (const r of o) others[r.chat_id] = r;
  }
  const list = rows.map((r) => ({
    id: r.id,
    type: r.type,
    name: r.type === 'dm' ? (others[r.id] ? others[r.id].name : 'Chat') : r.name,
    otherUserId: r.type === 'dm' && others[r.id] ? others[r.id].id : null,
    otherUserEmoji: r.type === 'dm' && others[r.id] ? others[r.id].avatar_emoji || null : null,
    otherUserAvatarUrl: r.type === 'dm' && others[r.id] ? others[r.id].avatar_url || null : null,
    createdBy: r.created_by,
    membersCount: Number(r.members),
    unread: Number(r.unread),
    muted: !!r.muted,
    pinned: !!r.pinned,
    favourite: !!r.favourite,
    myLastRead: r.my_last_read ? Number(r.my_last_read) : null,
    pinnedMessage: r.pm_id ? { id: Number(r.pm_id), body: String(r.pm_body || '').slice(0, 200), senderName: r.pm_sender } : null,
    lastMessage: r.lm_id ? {
      id: Number(r.lm_id),
      senderId: r.lm_sender_id,
      senderName: r.lm_sender,
      text: r.lm_deleted && user.role !== 'boss' ? null : (r.lm_type === 'image' || r.lm_type === 'audio') ? mediaPreview(r.lm_type, parsePayload(r.lm_media)) : r.lm_body,
      type: r.lm_type || 'text',
      deleted: !!r.lm_deleted,
      createdAt: r.lm_at,
    } : null,
  }));
  // Pinned chats first; then All Team, Daily Check-in; then newest message.
  const rank = (c) => (c.type === 'all' ? 0 : c.type === 'checkin' ? 1 : 2);
  list.sort((a, b) => {
    if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
    if (rank(a) !== rank(b)) return rank(a) - rank(b);
    const ta = a.lastMessage ? new Date(a.lastMessage.createdAt).getTime() : 0;
    const tb = b.lastMessage ? new Date(b.lastMessage.createdAt).getTime() : 0;
    return tb - ta;
  });
  return list;
}

// Current members (no bot), check-in guard applied.
async function memberList(chatId, createdBy) {
  const [rows] = await pool.query(
    'SELECT u.id, u.name, u.role, u.phone, u.avatar_emoji, u.avatar_url ' + rt.MEMBER_FROM + 'WHERE cm.chat_id = ? AND cm.left_at IS NULL AND u.is_bot = 0 AND ' +
    rt.MEMBER_OK + ' ORDER BY u.name', [chatId]);
  return rows.map((u) => ({ id: u.id, name: u.name, role: u.role, phone: u.phone, avatarEmoji: u.avatar_emoji || null, avatarUrl: u.avatar_url || null, isCreator: u.id === createdBy }));
}

// Group management guard: member + group chat (+ creator or boss when manage). -> chat row, or sends the error.
async function groupFor(req, res, manage) {
  const chatId = parseInt(req.params.id, 10);
  if (!(await isMember(chatId, req.user.id))) { res.status(403).json({ error: 'Not allowed', code: 'NOT_ALLOWED' }); return null; }
  const [[chat]] = await pool.query('SELECT id, type, name, created_by FROM chats WHERE id = ?', [chatId]);
  if (!chat || chat.type !== 'group') { res.status(400).json({ error: 'Only for groups', code: 'BAD_REQUEST' }); return null; }
  if (manage && chat.created_by !== req.user.id && req.user.role !== 'boss') {
    res.status(403).json({ error: 'Only the group creator or an admin can do this', code: 'NOT_ALLOWED' });
    return null;
  }
  return chat;
}

const notifyChat = (chatId) => rt.sendToChat(chatId, { type: 'chat', chatId });

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
    const [users] = await pool.query('SELECT id FROM users WHERE id IN (?) AND active = 1 AND is_bot = 0', [ids]);
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
    const [[other]] = await pool.query('SELECT id FROM users WHERE id = ? AND active = 1 AND is_bot = 0', [otherId]);
    if (!other) return res.status(404).json({ error: 'User not found' });
    const { chatId, created } = await bot.ensureDm(req.user.id, otherId);
    if (created) rt.sendToUser(otherId, { type: 'chat', chatId });
    const [chat] = await chatSummaries(req.user, chatId);
    res.status(created ? 201 : 200).json({ chat });
  } catch (e) {
    res.status(500).json({ error: 'Server error' });
  }
});

// Chat info + members (Group Info screen). chat = same object as in GET /chats (muted/pinned are the caller's).
router.get('/:id', async (req, res) => {
  try {
    const chatId = parseInt(req.params.id, 10);
    if (!(await isMember(chatId, req.user.id))) return res.status(403).json({ error: 'Not allowed', code: 'NOT_ALLOWED' });
    const [chat] = await chatSummaries(req.user, chatId);
    if (!chat) return res.status(404).json({ error: 'Chat not found', code: 'NOT_FOUND' });
    // open tasks made in this chat (brief for tasks the viewer cannot open); DMs also show tasks shared by the two people
    const T = require('../tasks');
    const [trows] = await pool.query(T.SELECT + " AND t.chat_id = ? AND t.status NOT IN ('done', 'closed') AND (t.private = 0 OR t.created_by = ?) ORDER BY t.id DESC LIMIT 50", [chatId, req.user.id]);
    let tasks = await T.shapeRows(trows);
    if (chat.type === 'dm' && chat.otherUserId) {
      const shared = (await T.listTasks({ with: chat.otherUserId, status: 'open' }, req.user)).filter((t) => !tasks.some((x) => x.id === t.id));
      tasks = [...tasks, ...shared].slice(0, 80);
    }
    res.json({ chat, members: await memberList(chatId, chat.createdBy), tasks: tasks.map((t) => T.forViewer(t, req.user)) });
  } catch (e) {
    res.status(500).json({ error: 'Server error' });
  }
});

// Add members (group; creator or boss). Re-adding someone who left clears left_at. System message "X added Y, Z".
router.post('/:id/members', async (req, res) => {
  try {
    const chat = await groupFor(req, res, true);
    if (!chat) return;
    const ids = [...new Set((Array.isArray(req.body.userIds) ? req.body.userIds : []).map((n) => parseInt(n, 10)).filter(Boolean))];
    if (!ids.length) return res.status(400).json({ error: 'Pick at least one member' });
    const [users] = await pool.query('SELECT id, name FROM users WHERE id IN (?) AND active = 1 AND is_bot = 0', [ids]);
    if (users.length !== ids.length) return res.status(400).json({ error: 'Invalid member' });
    const current = new Set((await rt.memberIds(chat.id)));
    const added = users.filter((u) => !current.has(u.id));
    if (added.length) {
      const [[last]] = await pool.query('SELECT MAX(id) id FROM messages WHERE chat_id = ?', [chat.id]);
      const upTo = last.id || null; // new joiners start with nothing unread
      for (const u of added) {
        await pool.query(
          'INSERT INTO chat_members (chat_id, user_id, last_read_message_id, last_delivered_message_id) VALUES (?, ?, ?, ?) ' +
          'ON DUPLICATE KEY UPDATE left_at = NULL, joined_at = NOW(), muted = 0, pinned = 0, ' +
          'last_read_message_id = VALUES(last_read_message_id), last_delivered_message_id = VALUES(last_delivered_message_id)',
          [chat.id, u.id, upTo, upTo]);
      }
      await bot.postSystem(chat.id, req.user, req.user.name + ' added ' + added.map((u) => u.name).join(', '));
      await notifyChat(chat.id);
    }
    res.json({ ok: true, members: await memberList(chat.id, chat.created_by) });
  } catch (e) {
    res.status(500).json({ error: 'Server error' });
  }
});

// Remove a member (creator or boss) or leave (self). Soft: sets left_at. Removed user gets {type:'chat', chatId, removed:true}.
router.delete('/:id/members/:userId', async (req, res) => {
  try {
    const target = parseInt(req.params.userId, 10);
    const self = target === req.user.id;
    const chat = await groupFor(req, res, !self);
    if (!chat) return;
    const [[u]] = await pool.query(
      'SELECT u.id, u.name FROM chat_members cm JOIN users u ON u.id = cm.user_id WHERE cm.chat_id = ? AND cm.user_id = ? AND cm.left_at IS NULL',
      [chat.id, target]);
    if (!u) return res.status(404).json({ error: 'Member not found', code: 'NOT_FOUND' });
    await pool.query('UPDATE chat_members SET left_at = NOW(), pinned = 0 WHERE chat_id = ? AND user_id = ?', [chat.id, target]);
    rt.sendToUser(target, { type: 'chat', chatId: chat.id, removed: true });
    await bot.postSystem(chat.id, req.user, self ? req.user.name + ' left' : req.user.name + ' removed ' + u.name);
    await notifyChat(chat.id);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: 'Server error' });
  }
});

// Rename (group; creator or boss).
router.patch('/:id', async (req, res) => {
  try {
    const chat = await groupFor(req, res, true);
    if (!chat) return;
    const name = String(req.body.name || '').trim();
    if (!name || name.length > 100) return res.status(400).json({ error: 'Group name is required' });
    if (name !== chat.name) {
      await pool.query('UPDATE chats SET name = ? WHERE id = ?', [name, chat.id]);
      await bot.postSystem(chat.id, req.user, req.user.name + ' renamed the group to ' + name);
      await notifyChat(chat.id);
    }
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: 'Server error' });
  }
});

// My own chat flags: mute / pin to top of the chat list / favourite (Round 4).
router.patch('/:id/me', async (req, res) => {
  try {
    const chatId = parseInt(req.params.id, 10);
    if (!(await isMember(chatId, req.user.id))) return res.status(403).json({ error: 'Not allowed', code: 'NOT_ALLOWED' });
    const sets = []; const vals = [];
    for (const k of ['muted', 'pinned', 'favourite']) {
      if (req.body[k] === undefined) continue;
      if (typeof req.body[k] !== 'boolean') return res.status(400).json({ error: k + ' must be true or false' });
      sets.push(k + ' = ?'); vals.push(req.body[k] ? 1 : 0);
    }
    if (!sets.length) return res.status(400).json({ error: 'Nothing to update' });
    await pool.query('UPDATE chat_members SET ' + sets.join(', ') + ' WHERE chat_id = ? AND user_id = ?', [...vals, chatId, req.user.id]);
    rt.sendToUser(req.user.id, { type: 'chat', chatId }); // my other devices
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: 'Server error' });
  }
});

// Pin / unpin (messageId null) a message for everyone in the chat (any member).
router.post('/:id/pin', async (req, res) => {
  try {
    const chatId = parseInt(req.params.id, 10);
    if (!(await isMember(chatId, req.user.id))) return res.status(403).json({ error: 'Not allowed', code: 'NOT_ALLOWED' });
    let pinnedMessage = null;
    if (req.body.messageId != null) {
      const id = parseInt(req.body.messageId, 10);
      const [[m]] = await pool.query(
        'SELECT m.id, m.body, u.name sender_name FROM messages m JOIN users u ON u.id = m.sender_id ' +
        'WHERE m.id = ? AND m.chat_id = ? AND m.deleted_at IS NULL AND m.visible_to IS NULL', [id || 0, chatId]);
      if (!m) return res.status(404).json({ error: 'Message not found', code: 'NOT_FOUND' });
      pinnedMessage = { id: Number(m.id), body: String(m.body || '').slice(0, 200), senderName: m.sender_name };
    }
    await pool.query('UPDATE chats SET pinned_message_id = ? WHERE id = ?', [pinnedMessage ? pinnedMessage.id : null, chatId]);
    await rt.sendToChat(chatId, { type: 'pin', chatId, pinnedMessage });
    if (pinnedMessage) await bot.postSystem(chatId, req.user, req.user.name + ' pinned a message');
    res.json({ ok: true });
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
    const me = req.user.id;
    // kind: all (default) | ai = bot cards only | chat = human text messages only
    const kind = req.query.kind === 'ai' ? "AND m.type = 'bot' " : req.query.kind === 'chat' ? "AND m.type IN ('text', 'image', 'audio') " : '';
    let rows;
    let hasMore = false;
    if (after) {
      [rows] = await pool.query(MSG_SELECT + 'WHERE m.chat_id = ? AND m.id > ? ' + kind + 'AND ' + VISIBLE + 'ORDER BY m.id ASC LIMIT 500',
        [chatId, after, me]);
    } else {
      [rows] = await pool.query(
        MSG_SELECT + 'WHERE m.chat_id = ? ' + (before ? 'AND m.id < ? ' : '') + kind + 'AND ' + VISIBLE + 'ORDER BY m.id DESC LIMIT ?',
        before ? [chatId, before, me, limit + 1] : [chatId, me, limit + 1]);
      hasMore = rows.length > limit;
      rows = rows.slice(0, limit).reverse();
    }
    const messages = await withReactions(rows.map((r) => formatMessage(r, req.user)));
    res.json({ messages, hasMore, status: await statusFor(chatId, me) });
  } catch (e) {
    res.status(500).json({ error: 'Server error' });
  }
});

// Mentions -> {ids, tagged}. tagged = [{token, id}]: "@Name" tokens the app sent with structured mentionIds (picker),
// trusted as-is, so two people with the same name can be told apart. Other "@Name" tokens: chat members by first name
// (case-insensitive), else the fuzzy matcher; only a single hit counts (an ambiguous name mentions nobody).
async function resolveMentions(text, chatId, rawIds) {
  if (!text.includes('@')) return { ids: [], tagged: [] };
  const { bestMatches, tagMentions, cleanToken, MENTION_RE } = require('../ai/names');
  const want = [...new Set((Array.isArray(rawIds) ? rawIds : []).map((n) => parseInt(n, 10)).filter((n) => n > 0))].slice(0, 20);
  let tagged = [];
  if (want.length) {
    const [users] = await pool.query('SELECT id, name FROM users WHERE id IN (?) AND active = 1 AND is_bot = 0', [want]);
    tagged = tagMentions(text, want, users);
  }
  const [rows] = await pool.query(
    'SELECT u.id, u.name FROM chat_members cm JOIN users u ON u.id = cm.user_id WHERE cm.chat_id = ? AND cm.left_at IS NULL AND u.is_bot = 0',
    [chatId]);
  const ids = new Set(tagged.map((x) => x.id));
  const skip = tagged.map((x) => x.token);
  for (const m of text.matchAll(MENTION_RE)) {
    const tok = cleanToken(m[2]);
    if (!tok) continue;
    const k = skip.indexOf(tok);
    if (k >= 0) { skip.splice(k, 1); continue; }
    const first = rows.filter((r) => String(r.name).trim().split(/\s+/)[0].toLowerCase() === tok);
    const hits = first.length === 1 ? first : bestMatches(tok, rows).people;
    if (hits.length === 1) ids.add(hits[0].id);
  }
  return { ids: [...ids].slice(0, 50), tagged };
}

// Plain text with exactly one "#N" token for an existing task the sender can view -> that task id (message link).
async function hashTask(text, user) {
  const ids = [...new Set([...text.matchAll(/(^|\s)#(\d{1,9})(?=[\s.,!?:;)]|$)/g)].map((m) => Number(m[2])))];
  if (ids.length !== 1) return null;
  const T = require('../tasks');
  try {
    const t = await T.getTask(ids[0]);
    return T.canView(t, user) ? t.id : null;
  } catch (e) { return null; }
}

// ---------- Round 4 helpers: media JSON, quote, message pipeline, voice notes ----------
const num = (v, lo, hi) => (typeof v === 'number' && isFinite(v) && v >= lo && v <= hi ? v : undefined);
const short = (v, n) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, n) : undefined);

// Whitelist of media fields from the client; transcript fields are server-owned.
function cleanMedia(type, raw) {
  const m = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  const kind = type === 'audio' ? 'audio' : m.kind === 'geo_image' ? 'geo_image' : 'image';
  const out = { kind, w: num(m.w, 1, 20000), h: num(m.h, 1, 20000), durationMs: num(m.durationMs, 0, 3600000),
    lat: num(m.lat, -90, 90), lng: num(m.lng, -180, 180), address: short(m.address, 300), takenAt: short(m.takenAt, 40) };
  if (Array.isArray(m.waveform)) out.waveform = m.waveform.slice(0, 200).map((x) => (typeof x === 'number' && isFinite(x) ? Math.round(x * 1000) / 1000 : 0));
  if (type === 'audio') out.transcriptStatus = 'pending';
  for (const k of Object.keys(out)) if (out[k] === undefined) delete out[k];
  return out;
}

// payload.quote for "Reply privately": {chatId, messageId, senderName, text}
function cleanQuote(q) {
  if (!q || typeof q !== 'object') return null;
  const chatId = parseInt(q.chatId, 10); const messageId = parseInt(q.messageId, 10);
  if (!chatId || !messageId) return null;
  return { chatId, messageId, senderName: String(q.senderName || '').slice(0, 100), text: String(q.text || '').slice(0, 300) };
}

// @AI answer, then slash command, then task-linked reply, then the natural-language task engine.
async function runPipeline(message, user, tagged) {
  try {
    const cmd = require('../ai/commands');
    const engine = require('../ai/engine');
    if (await engine.answerIfAsked(message, user)) return;
    if (await cmd.handle(message, user, { tagged })) return;
    if (await cmd.handleLinked(message, user)) return;
    await engine.onMessage(message, user);
  } catch (e) { console.error('ai engine:', e.message); }
}

// Audio message: transcribe in the background, store + broadcast the transcript (ws 'edited', same as edits), then treat the
// transcript like typed text (commands, @AI, task engine, check-in text). A failure stores media.transcriptError (a reason code:
// off | no_file | too_large | type | api | empty) and can be retried (POST .../transcribe). The text pipeline runs at most once per
// message (media.pipelineDone, claimed atomically) so a retry or restart never creates the same task twice.
async function voiceNote(message, user, chatId, checkinChat) {
  try {
    const r = await require('../ai/transcribe').transcribe(message.mediaUrl);
    const media = { ...(message.media || {}), kind: 'audio' };
    delete media.transcribeStartedAt;
    if (r.text) { media.transcript = r.text; media.transcriptStatus = 'done'; delete media.transcriptError; }
    else { media.transcriptStatus = 'failed'; media.transcriptError = r.error || 'api'; }
    await pool.query('UPDATE messages SET media = ? WHERE id = ?', [JSON.stringify(media), message.id]);
    const [[row]] = await pool.query(MSG_SELECT + 'WHERE m.id = ?', [message.id]);
    const fresh = formatMessage(row, user);
    fresh.reactions = (await reactionsFor([fresh.id])).get(fresh.id) || [];
    await rt.sendToChat(chatId, { type: 'edited', chatId, message: fresh });
    if (!r.text) return;
    // A forwarded voice note is never run again as the forwarder's command / task text.
    const cap = String(message.text || '').trim();
    if (cap.startsWith('↪ Forwarded')) return;
    const [claim] = await pool.query(
      "UPDATE messages SET media = JSON_SET(media, '$.pipelineDone', true) WHERE id = ? AND JSON_EXTRACT(media, '$.pipelineDone') IS NULL", [message.id]);
    if (!claim.affectedRows) return; // already processed
    // Typed command + spoken rest: caption "/task @Anubhav" + transcript "site visit roster" -> one command.
    const spoken = cap.startsWith('/') && !r.text.startsWith('/') ? cap + ' ' + r.text : r.text;
    const { tagged } = await resolveMentions(spoken, chatId, message.mentions || []).catch(() => ({ tagged: [] }));
    const asText = { ...fresh, type: 'text', text: spoken };
    await runPipeline(asText, user, tagged);
    if (checkinChat && !spoken.startsWith('/')) await checkins.onChatMessage(asText, user);
  } catch (e) { console.error('voice note:', e.message); }
}

// A voice note may be (re)transcribed when it failed, or is still pending after 2 minutes (server restart / lost request).
const STALE_MS = 2 * 60 * 1000;
function retryable(row) {
  const media = parsePayload(row.media) || {};
  if (row.type !== 'audio') return false;
  if (media.transcriptStatus === 'failed') return true;
  if (media.transcriptStatus !== 'pending') return false;
  const since = Number(media.transcribeStartedAt) || new Date(row.created_at).getTime();
  return Date.now() - since > STALE_MS;
}

// Mark pending (with a start time so a second tap does not double-run) and run voiceNote as the message's sender.
async function startVoiceNote(row) {
  const media = { ...(parsePayload(row.media) || {}), transcriptStatus: 'pending', transcribeStartedAt: Date.now() };
  delete media.transcriptError;
  await pool.query('UPDATE messages SET media = ? WHERE id = ?', [JSON.stringify(media), row.id]);
  const [[sender]] = await pool.query('SELECT id, name, role FROM users WHERE id = ?', [row.sender_id]);
  const [[chat]] = await pool.query('SELECT type FROM chats WHERE id = ?', [row.chat_id]);
  const message = formatMessage({ ...row, media: JSON.stringify(media) }, sender);
  return voiceNote(message, sender, row.chat_id, !!chat && chat.type === 'checkin');
}

// On server start: pick up audio messages left 'pending' for over 2 minutes (max 20). -> number started.
async function requeueVoiceNotes() {
  const [rows] = await pool.query(MSG_SELECT + "WHERE m.type = 'audio' AND m.deleted_at IS NULL AND m.media LIKE '%\"pending\"%' " +
    'AND m.created_at < (NOW() - INTERVAL 2 MINUTE) ORDER BY m.id DESC LIMIT 20');
  const todo = rows.filter(retryable);
  for (const row of todo) setImmediate(() => startVoiceNote(row).catch((e) => console.error('voice requeue:', e.message)));
  return todo.length;
}

// Retry a failed / stuck transcription. Chat member, and only the sender or the boss.
router.post('/:id/messages/:messageId/transcribe', async (req, res) => {
  try {
    const chatId = parseInt(req.params.id, 10);
    if (!(await isMember(chatId, req.user.id))) return res.status(403).json({ error: 'Not allowed', code: 'NOT_ALLOWED' });
    const mid = /^\d{1,18}$/.test(req.params.messageId) ? req.params.messageId : '0';
    const [[row]] = await pool.query(MSG_SELECT + 'WHERE m.id = ? AND m.chat_id = ? AND m.deleted_at IS NULL', [mid, chatId]);
    if (!row) return res.status(404).json({ error: 'Message not found', code: 'NOT_FOUND' });
    if (row.sender_id !== req.user.id && req.user.role !== 'boss') return res.status(403).json({ error: 'Not allowed', code: 'NOT_ALLOWED' });
    if (row.type !== 'audio') return res.status(400).json({ error: 'Not a voice note', code: 'BAD_REQUEST' });
    if (!retryable(row)) return res.status(409).json({ error: 'Transcript retry not needed', code: 'NOT_RETRYABLE' });
    // claim: only one concurrent retry wins
    const [c] = await pool.query('UPDATE messages SET media = ? WHERE id = ? AND media = ?', [
      JSON.stringify({ ...(parsePayload(row.media) || {}), transcriptStatus: 'pending', transcribeStartedAt: Date.now() }), row.id, row.media]);
    if (!c.affectedRows) return res.status(409).json({ error: 'Transcript retry not needed', code: 'NOT_RETRYABLE' });
    const [[again]] = await pool.query(MSG_SELECT + 'WHERE m.id = ?', [row.id]);
    res.status(202).json({ ok: true });
    setImmediate(() => startVoiceNote(again).catch((e) => console.error('voice retry:', e.message)));
  } catch (e) {
    res.status(500).json({ error: 'Server error' });
  }
});

router.post('/:id/messages', async (req, res) => {
  try {
    const chatId = parseInt(req.params.id, 10);
    if (!(await isMember(chatId, req.user.id))) return res.status(403).json({ error: 'Not allowed' });
    const mtype = req.body.type === 'image' || req.body.type === 'audio' ? req.body.type : 'text';
    const text = String(req.body.text != null ? req.body.text : req.body.body || '').trim(); // media: optional caption
    const clientId = String(req.body.clientId || '').slice(0, 64);
    if ((!text && mtype === 'text') || text.length > 4000) return res.status(400).json({ error: 'Message is empty or too long' });
    // Round 4: media message {type, mediaUrl (/media/f/...), media {...}, text = caption} and payload.quote ("Reply privately")
    let mediaUrl = null; let media = null;
    if (mtype !== 'text') {
      mediaUrl = String(req.body.mediaUrl || '');
      const file = mediaUrl.startsWith('/media/f/') && mediaUrl.length <= 255 ? require('./media').resolvePath(mediaUrl) : null;
      if (!file || !require('fs').existsSync(file)) return res.status(400).json({ error: 'Invalid mediaUrl', code: 'BAD_REQUEST' });
      media = cleanMedia(mtype, req.body.media);
    }
    const quote = cleanQuote(req.body.payload && req.body.payload.quote);
    if (!clientId) return res.status(400).json({ error: 'clientId is required' });
    let replyToId = null;
    let taskId = null;
    if (req.body.replyToId != null && req.body.replyToId !== '') {
      replyToId = parseInt(req.body.replyToId, 10);
      if (!replyToId) return res.status(400).json({ error: 'Invalid replyToId' });
      const [[orig]] = await pool.query(
        'SELECT m.task_id FROM messages m WHERE m.id = ? AND m.chat_id = ? AND ' + VISIBLE, [replyToId, chatId, req.user.id]);
      if (!orig) return res.status(400).json({ error: 'Replied message not found in this chat' });
      taskId = orig.task_id || null; // reply chain: a reply to a task-linked message is linked to the same task
    }
    if (!taskId && mtype === 'text' && !text.startsWith('/')) taskId = await hashTask(text, req.user);

    const find = async () => {
      const [[row]] = await pool.query(MSG_SELECT + 'WHERE m.sender_id = ? AND m.client_id = ?', [req.user.id, clientId]);
      return row;
    };
    let row = await find();
    if (row) return res.json({ message: (await withReactions([formatMessage(row, req.user)]))[0], duplicate: true });
    const { ids: mentions, tagged } = await resolveMentions(text, chatId, req.body.mentionIds);
    let id;
    try {
      const [r] = await pool.query(
        'INSERT INTO messages (chat_id, sender_id, body, client_id, reply_to_id, mentions, task_id, type, payload, media_url, media) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [chatId, req.user.id, text, clientId, replyToId, mentions.length ? JSON.stringify(mentions) : null, taskId, mtype,
          quote ? JSON.stringify({ quote }) : null, mediaUrl, media ? JSON.stringify(media) : null]);
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
    // Slash command first, then a task-linked message (card reply / reply chain / #N: note, "desc:", answer), else the
    // natural-language AI engine. Runs after the reply, never delays or fails the send.
    setImmediate(() => {
      if (mtype === 'audio') return voiceNote(message, req.user, chatId, checkinChat);
      if (mtype !== 'text') return; // photos: nothing to parse
      runPipeline(message, req.user, tagged);
    });
    // A typed/voice reply in the member's own check-in chat is also stored as today's check-in text (not commands).
    if (checkinChat && mtype === 'text' && !text.startsWith('/')) {
      setImmediate(() => checkins.onChatMessage(message, req.user).catch((e) => console.error('checkin:', e.message)));
    }
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
module.exports.requeueVoiceNotes = requeueVoiceNotes;
module.exports.MSG_SELECT = MSG_SELECT;
module.exports.VISIBLE = VISIBLE;
module.exports.reactionsFor = reactionsFor;
module.exports.resolveMentions = resolveMentions;
