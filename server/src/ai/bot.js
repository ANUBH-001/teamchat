// 'Team Assistant' system user + shared helpers that post bot / system messages.
// The bot user is inactive (active = 0) with no PIN, so it can never log in and is left out of people lists,
// summaries and task assignment. Created lazily (and by seed.js).
const crypto = require('crypto');
const pool = require('../db');
const rt = require('../realtime');

let cached = null;
async function botUserId() {
  if (cached) return cached;
  await pool.query("INSERT IGNORE INTO users (phone, name, role, active, is_bot) VALUES ('bot', 'Team Assistant', 'member', 0, 1)");
  const [[u]] = await pool.query('SELECT id FROM users WHERE is_bot = 1 ORDER BY id LIMIT 1');
  cached = u.id;
  return cached;
}

async function insertAndSend(chatId, senderId, type, body, payload, visibleTo, prefix) {
  const { MSG_SELECT, formatMessage } = require('../routes/chats'); // lazy: chats.js requires this file
  const [r] = await pool.query(
    'INSERT INTO messages (chat_id, sender_id, body, client_id, type, payload, visible_to) VALUES (?, ?, ?, ?, ?, ?, ?)',
    [chatId, senderId, String(body).slice(0, 4000), prefix + crypto.randomUUID(), type, payload ? JSON.stringify(payload) : null,
      visibleTo || null]);
  const [[row]] = await pool.query(MSG_SELECT + 'WHERE m.id = ?', [r.insertId]);
  const message = formatMessage(row, { role: 'member' });
  // Ephemeral (visibleTo set): only that user ever gets it, here and in every REST read.
  const to = visibleTo ? [visibleTo] : await rt.memberIds(chatId);
  for (const u of to) rt.sendToUser(u, { type: 'message', message });
  return message;
}

// Bot card in a chat. visibleTo = user id for an ephemeral "only visible to you" reply.
const postBot = async (chatId, body, payload, visibleTo = null) =>
  insertAndSend(chatId, await botUserId(), 'bot', body, payload, visibleTo, 'bot-');

// Centered grey pill ("Rishit added Anubhav"); sender = the acting user.
const postSystem = (chatId, actor, body) => insertAndSend(chatId, actor.id, 'system', body, null, null, 'sys-');

const EVENT_TEXT = {
  created: 'Task assigned', completed: 'Task done', review: 'Testing', updated: 'Task updated', reassigned: 'Task reassigned',
  due: 'Due date changed', deleted: 'Task deleted', note: 'Task note', praise: 'Praise',
};

// Public task card: {kind:'task', event, task, actorId, actorName, note?, byAi?} (+ legacy action/replyTo for old app builds).
function taskCard(chatId, event, task, actor, extra = {}) {
  const payload = {
    kind: 'task', event, task, actorId: actor.id, actorName: actor.name || null, ...extra,
    action: event === 'created' || event === 'completed' ? event : 'updated',
  };
  let body = (EVENT_TEXT[event] || 'Task') + ': ' + task.title + (task.assigneeName ? ' (' + task.assigneeName + ')' : '');
  if (extra.note) body += '\n' + extra.note;
  if (event === 'due') body += ' - ' + (task.dueDate || 'no date');
  return postBot(chatId, body, payload);
}

// Ephemeral cards for one user.
const ephemeral = (chatId, userId, body, payload) => postBot(chatId, body, payload, userId);
const errorCard = (chatId, userId, code, message) => ephemeral(chatId, userId, message, { kind: 'error', code, message });
const infoCard = (chatId, userId, text) => ephemeral(chatId, userId, text, { kind: 'info', text });

// Find or create the DM between two users -> {chatId, created}.
async function ensureDm(aId, bId) {
  const [[ex]] = await pool.query(
    `SELECT c.id FROM chats c
     JOIN chat_members a ON a.chat_id = c.id AND a.user_id = ?
     JOIN chat_members b ON b.chat_id = c.id AND b.user_id = ?
     WHERE c.type = 'dm' AND c.deleted_at IS NULL LIMIT 1`, [aId, bId]);
  if (ex) return { chatId: ex.id, created: false };
  const [r] = await pool.query("INSERT INTO chats (type, created_by) VALUES ('dm', ?)", [aId]);
  await pool.query('INSERT INTO chat_members (chat_id, user_id) VALUES (?, ?), (?, ?)', [r.insertId, aId, r.insertId, bId]);
  return { chatId: r.insertId, created: true };
}

module.exports = { botUserId, postBot, postSystem, taskCard, ephemeral, errorCard, infoCard, ensureDm };
