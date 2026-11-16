const url = require('url');
const jwt = require('jsonwebtoken');
const { WebSocketServer } = require('ws');
const pool = require('./db');

const clients = new Map(); // userId -> Set<ws>

const isOnline = (userId) => clients.has(userId);

function sendToUser(userId, event) {
  const set = clients.get(userId);
  if (!set) return;
  const data = JSON.stringify(event);
  for (const ws of set) if (ws.readyState === 1) ws.send(data);
}

async function memberIds(chatId) {
  const [rows] = await pool.query('SELECT user_id FROM chat_members WHERE chat_id = ? AND left_at IS NULL', [chatId]);
  return rows.map((r) => r.user_id);
}

async function sendToChat(chatId, event, exceptUserId) {
  for (const id of await memberIds(chatId)) if (id !== exceptUserId) sendToUser(id, event);
}

// Per member S: lowest delivered/read pointer among the OTHER members (own messages with id <= pointer got that tick).
async function pushStatus(chatId) {
  const [rows] = await pool.query(
    'SELECT user_id, last_read_message_id r, last_delivered_message_id d FROM chat_members WHERE chat_id = ? AND left_at IS NULL',
    [chatId]);
  for (const me of rows) {
    const others = rows.filter((o) => o.user_id !== me.user_id);
    if (!others.length) continue;
    const read = Math.min(...others.map((o) => Number(o.r || 0)));
    const delivered = Math.max(read, Math.min(...others.map((o) => Number(o.d || 0))));
    sendToUser(me.user_id, { type: 'read', chatId, read, delivered });
  }
}

// Mark everything in the user's chats as delivered (they are now connected).
async function markDeliveredOnConnect(userId) {
  const [chats] = await pool.query(
    'SELECT chat_id FROM chat_members WHERE user_id = ? AND left_at IS NULL', [userId]);
  for (const { chat_id } of chats) {
    const [r] = await pool.query(
      `UPDATE chat_members SET last_delivered_message_id = (SELECT MAX(id) FROM messages WHERE chat_id = ?)
       WHERE chat_id = ? AND user_id = ? AND (last_delivered_message_id IS NULL
         OR last_delivered_message_id < (SELECT MAX(id) FROM messages WHERE chat_id = ?))`,
      [chat_id, chat_id, userId, chat_id]);
    if (r.affectedRows) await pushStatus(chat_id);
  }
}

function attach(server) {
  const wss = new WebSocketServer({ server });
  wss.on('connection', async (ws, req) => {
    let user;
    try {
      const token = new url.URL(req.url, 'http://x').searchParams.get('token');
      const payload = jwt.verify(token, process.env.JWT_SECRET);
      const [[u]] = await pool.query('SELECT id, name, active FROM users WHERE id = ?', [payload.id]);
      if (!u || !u.active) throw new Error('bad user');
      user = u;
    } catch (e) {
      return ws.close(4401, 'Not authenticated');
    }
    if (!clients.has(user.id)) clients.set(user.id, new Set());
    clients.get(user.id).add(ws);
    ws.isAlive = true;
    ws.on('pong', () => { ws.isAlive = true; });
    ws.send(JSON.stringify({ type: 'hello' }));
    markDeliveredOnConnect(user.id).catch(() => {});

    ws.on('message', async (raw) => {
      try {
        const m = JSON.parse(String(raw));
        if (m.type !== 'typing') return;
        const chatId = parseInt(m.chatId, 10);
        const [[mem]] = await pool.query(
          'SELECT 1 x FROM chat_members WHERE chat_id = ? AND user_id = ? AND left_at IS NULL', [chatId, user.id]);
        if (mem) await sendToChat(chatId, { type: 'typing', chatId, userId: user.id, name: user.name }, user.id);
      } catch (e) { /* ignore bad frames */ }
    });
    ws.on('close', () => {
      const set = clients.get(user.id);
      if (set) { set.delete(ws); if (!set.size) clients.delete(user.id); }
    });
  });
  // drop dead connections
  setInterval(() => {
    for (const ws of wss.clients) {
      if (!ws.isAlive) { ws.terminate(); continue; }
      ws.isAlive = false;
      ws.ping();
    }
  }, 30000);
}

module.exports = { attach, isOnline, sendToUser, sendToChat, memberIds, pushStatus };
