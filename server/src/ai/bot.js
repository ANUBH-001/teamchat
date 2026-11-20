// 'Team Assistant' system user + shared helpers that post bot / system messages.
// The bot user is inactive (active = 0) with no PIN, so it can never log in and is left out of people lists,
// summaries and task assignment. Created lazily (and by seed.js).
const DT = require('./dueTime');
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

const LINK_KINDS = ['task', 'ask', 'reminder'];
// Card links (round 3): source_message_id = payload.replyTo (the human message that caused it), task_id = payload.task.id.
function linksOf(payload) {
  const p = payload || {};
  return {
    sourceMessageId: Number.isInteger(p.replyTo) ? p.replyTo : null,
    taskId: LINK_KINDS.includes(p.kind) && p.task && Number.isInteger(p.task.id) ? p.task.id : null,
  };
}

async function insertAndSend(chatId, senderId, type, body, payload, visibleTo, prefix, mentions) {
  const { MSG_SELECT, formatMessage } = require('../routes/chats'); // lazy: chats.js requires this file
  const link = type === 'bot' ? linksOf(payload) : { sourceMessageId: null, taskId: null };
  const [r] = await pool.query(
    'INSERT INTO messages (chat_id, sender_id, body, client_id, type, payload, visible_to, mentions, source_message_id, task_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    [chatId, senderId, String(body).slice(0, 4000), prefix + crypto.randomUUID(), type, payload ? JSON.stringify(payload) : null,
      visibleTo || null, mentions && mentions.length ? JSON.stringify(mentions) : null, link.sourceMessageId, link.taskId]);
  const [[row]] = await pool.query(MSG_SELECT + 'WHERE m.id = ?', [r.insertId]);
  const message = formatMessage(row, { role: 'member' });
  // Ephemeral (visibleTo set): only that user ever gets it, here and in every REST read.
  const to = visibleTo ? [visibleTo] : await rt.memberIds(chatId);
  for (const u of to) rt.sendToUser(u, { type: 'message', message });
  return message;
}

// Bot card in a chat. visibleTo = user id for an ephemeral "only visible to you" reply. mentions = user ids (notify).
const postBot = async (chatId, body, payload, visibleTo = null, mentions = null) =>
  insertAndSend(chatId, await botUserId(), 'bot', body, payload, visibleTo, 'bot-', mentions);

// Centered grey pill ("Rishit added Anubhav"); sender = the acting user.
const postSystem = (chatId, actor, body) => insertAndSend(chatId, actor.id, 'system', body, null, null, 'sys-');

const EVENT_TEXT = {
  created: 'Task assigned', completed: 'Task done', review: 'Testing', updated: 'Task updated', reassigned: 'Task reassigned',
  due: 'Due date changed', deleted: 'Task closed', closed: 'Task closed', reopened: 'Task reopened', note: 'Task note', praise: 'Praise',
  planning: 'Planning', coding: 'Coding', testing: 'Testing', change_merged: 'Change merged', done: 'Done (apna part)',
  answered: 'Jawab mila', edited: 'Task updated (edit)',
};
const namesOf = (task) => (task.assignees && task.assignees.length ? task.assignees.map((a) => a.name).join(', ') : task.assigneeName || '');

// Public task card: {kind:'task', event, task, actorId, actorName, note?, byAi?, replyTo?} (+ legacy action).
// replyTo = source message id (card shows attached under it in the app).
function taskCard(chatId, event, task, actor, extra = {}) {
  const payload = {
    kind: 'task', event, task, actorId: actor.id, actorName: actor.name || null, ...extra,
    action: event === 'created' || event === 'completed' ? event : 'updated',
  };
  const who = namesOf(task);
  // Round 4: "Task 22" code (= tasks.id); a private (admin's own) task card is visible to its creator only
  let body = (EVENT_TEXT[event] || 'Task') + ': Task ' + task.id + ' - ' + task.title + (who ? ' (' + who + ')' : '');
  if (extra.note) body += '\n' + extra.note;
  if (event === 'due') body += ' - ' + (task.dueDate ? DT.fmtDue(task.dueDate, task.dueAt) : 'no date');
  return postBot(chatId, body, payload, task.private ? actor.id : null);
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

module.exports = { linksOf, EVENT_TEXT, botUserId, postBot, postSystem, taskCard, ephemeral, errorCard, infoCard, ensureDm };
