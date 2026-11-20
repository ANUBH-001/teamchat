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

function sendToAll(event) {
  const data = JSON.stringify(event);
  for (const set of clients.values()) for (const ws of set) if (ws.readyState === 1) ws.send(data);
}

// Tell every connected boss something changed (e.g. member list) so their screens refetch.
async function sendToBosses(event) {
  const [rows] = await pool.query("SELECT id FROM users WHERE role = 'boss' AND active = 1");
  for (const r of rows) sendToUser(r.id, event);
}

// Privacy guard (aliases c = chats, cm = chat_members, u = users of cm): a 'checkin' chat counts only its owner
// and the bot as members, even if some other chat_members row existed by mistake (boss included).
const MEMBER_OK = "(c.type <> 'checkin' OR cm.user_id = c.owner_id OR u.is_bot = 1)";
const MEMBER_FROM = 'FROM chat_members cm JOIN chats c ON c.id = cm.chat_id JOIN users u ON u.id = cm.user_id ';

async function memberIds(chatId) {
  const [rows] = await pool.query(
    'SELECT cm.user_id ' + MEMBER_FROM + 'WHERE cm.chat_id = ? AND cm.left_at IS NULL AND ' + MEMBER_OK, [chatId]);
  return rows.map((r) => r.user_id);
}

async function isChatMember(chatId, userId) {
  const [[r]] = await pool.query(
    'SELECT 1 x ' + MEMBER_FROM + 'WHERE cm.chat_id = ? AND cm.user_id = ? AND cm.left_at IS NULL AND c.deleted_at IS NULL AND ' +
    MEMBER_OK, [chatId, userId]);
  return !!r;
}

async function sendToChat(chatId, event, exceptUserId) {
  for (const id of await memberIds(chatId)) if (id !== exceptUserId) sendToUser(id, event);
}

// Per member S: lowest delivered/read pointer among the OTHER members (own messages with id <= pointer got that tick).
async function pushStatus(chatId) {
  const [rows] = await pool.query(
    'SELECT cm.user_id, u.is_bot, cm.last_read_message_id r, cm.last_delivered_message_id d ' + MEMBER_FROM +
    'WHERE cm.chat_id = ? AND cm.left_at IS NULL AND ' + MEMBER_OK, [chatId]);
  for (const me of rows) {
    if (me.is_bot) continue;
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
    'SELECT cm.chat_id ' + MEMBER_FROM + 'WHERE cm.user_id = ? AND cm.left_at IS NULL AND ' + MEMBER_OK, [userId]);
  for (const { chat_id } of chats) {
    const [r] = await pool.query(
      `UPDATE chat_members SET last_delivered_message_id = (SELECT MAX(id) FROM messages WHERE chat_id = ?)
       WHERE chat_id = ? AND user_id = ? AND (last_delivered_message_id IS NULL
         OR last_delivered_message_id < (SELECT MAX(id) FROM messages WHERE chat_id = ?))`,
      [chat_id, chat_id, userId, chat_id]);
    if (r.affectedRows) await pushStatus(chat_id);
  }
}

// Drop every live socket of a user: 4401 deactivated / logged out by admin, 4409 SESSION_REPLACED (login on another phone).
function closeUser(userId, code = 4401, reason = 'Not authenticated') {
  const set = clients.get(userId);
  if (set) for (const ws of set) ws.close(code, reason);
}

function attach(server) {
  const wss = new WebSocketServer({ server });
  wss.on('connection', async (ws, req) => {
    let user;
    try {
      const params = new url.URL(req.url, 'http://x').searchParams;
      // Force update: app version below minVersionCode (query v, missing = 0) -> closed with 4426.
      const s = await require('./settings').all();
      if (s.minVersionCode > (parseInt(params.get('v'), 10) || 0)) return ws.close(4426, 'UPDATE_REQUIRED');
      // token: Authorization header (app 0.4.0+, keeps it out of proxy logs), else ?token= (old apps; drop once min >= 4)
      const h = String(req.headers.authorization || '');
      const token = h.startsWith('Bearer ') ? h.slice(7) : params.get('token');
      const payload = jwt.verify(token, process.env.JWT_SECRET, { algorithms: ['HS256'] });
      const [[u]] = await pool.query('SELECT id, name, active, session_id FROM users WHERE id = ?', [payload.id]);
      if (!u || !u.active) throw new Error('bad user');
      if (!require('./middleware/auth').sessionOk(u, payload)) return ws.close(4409, 'SESSION_REPLACED');
      user = { id: u.id, name: u.name };
    } catch (e) {
      return ws.close(4401, 'Not authenticated');
    }
    if (ws.readyState !== 1) return; // client left while we were checking the token
    if (!clients.has(user.id)) clients.set(user.id, new Set());
    clients.get(user.id).add(ws);
    ws.isAlive = true;
    ws.on('pong', () => { ws.isAlive = true; });
    ws.send(JSON.stringify({ type: 'hello' }));
    markDeliveredOnConnect(user.id).catch(() => {});

    ws.on('message', async (raw) => {
      try {
        const m = JSON.parse(String(raw));
        // A-03 app heartbeat: the client pings, we answer this socket only (lets the app detect half-dead connections)
        if (m.type === 'ping') { if (ws.readyState === 1) ws.send(JSON.stringify({ type: 'pong', t: Date.now() })); return; }
        if (m.type !== 'typing') return;
        const chatId = parseInt(m.chatId, 10);
        if (await isChatMember(chatId, user.id)) await sendToChat(chatId, { type: 'typing', chatId, userId: user.id, name: user.name }, user.id);
      } catch (e) { /* ignore bad frames */ }
    });
    ws.on('close', () => {
      const set = clients.get(user.id);
      if (set) { set.delete(ws); if (!set.size) clients.delete(user.id); }
    });
  });
  // drop dead connections
  const beat = setInterval(() => {
    for (const ws of wss.clients) {
      if (!ws.isAlive) { ws.terminate(); continue; }
      ws.isAlive = false;
      ws.ping();
    }
  }, 30000);
  beat.unref();
  wss.on('close', () => clearInterval(beat));
  return wss;
}

module.exports = {
  attach, closeUser, isOnline, sendToUser, sendToAll, sendToChat, sendToBosses, memberIds, isChatMember, pushStatus, MEMBER_OK, MEMBER_FROM,
};
