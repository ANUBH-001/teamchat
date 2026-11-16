// Android push (FCM HTTP v1 via firebase-admin). Silently off unless FIREBASE_SERVICE_ACCOUNT (path to json) is set.
const path = require('path');
const express = require('express');
const pool = require('./db');
const { requireAuth } = require('./middleware/auth');
const rt = require('./realtime');

const router = express.Router();
router.use(requireAuth);

// Save/refresh this device's FCM token for the logged-in user.
router.post('/token', async (req, res) => {
  try {
    const token = String(req.body.token || '').trim();
    if (!token || token.length > 255) return res.status(400).json({ error: 'Invalid token' });
    await pool.query(
      'INSERT INTO push_tokens (user_id, token) VALUES (?, ?) ON DUPLICATE KEY UPDATE user_id = VALUES(user_id)',
      [req.user.id, token]);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: 'Server error' });
  }
});

let messaging; // undefined = not tried yet, null = disabled
function getMessaging() {
  if (messaging !== undefined) return messaging;
  messaging = null;
  const file = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (!file) { console.log('push: disabled (FIREBASE_SERVICE_ACCOUNT not set)'); return null; }
  try {
    const admin = require('firebase-admin');
    admin.initializeApp({ credential: admin.credential.cert(path.resolve(file)) });
    messaging = admin.messaging();
  } catch (e) {
    console.log('push: disabled (' + e.message + ')');
  }
  return messaging;
}

const preview = (s) => {
  const t = String(s || '').replace(/\s+/g, ' ').trim();
  return t.length > 100 ? t.slice(0, 97) + '...' : t;
};

async function sendPush(userIds, title, body, chatId) {
  const m = getMessaging();
  if (!m || !userIds.length) return;
  const [rows] = await pool.query('SELECT token FROM push_tokens WHERE user_id IN (?)', [userIds]);
  if (!rows.length) return;
  const tokens = rows.map((r) => r.token);
  const r = await m.sendEach(tokens.map((token) => ({
    token,
    notification: { title, body },
    data: { chatId: String(chatId) },
    android: { priority: 'high', notification: { channelId: 'messages' } },
  })));
  const bad = [];
  r.responses.forEach((x, i) => {
    const code = x.error && x.error.code;
    if (code === 'messaging/registration-token-not-registered' || code === 'messaging/invalid-registration-token') bad.push(tokens[i]);
  });
  if (bad.length) await pool.query('DELETE FROM push_tokens WHERE token IN (?)', [bad]);
}

// Called after a message is saved and broadcast (text or bot). Never throws.
async function notifyMessage(message) {
  try {
    if (!getMessaging() || message.deleted) return;
    const p = message.payload;
    let targets;
    let title;
    let body;
    if (message.type === 'bot') {
      // only a freshly created task notifies, and only its assignee
      if (!p || p.kind !== 'task' || p.action !== 'created' || !p.task || !p.task.assigneeId) return;
      targets = [p.task.assigneeId];
      title = 'New task';
      body = preview(p.task.title);
    } else {
      const [[chat]] = await pool.query('SELECT type, name FROM chats WHERE id = ?', [message.chatId]);
      const group = chat && chat.type !== 'dm' && chat.name;
      targets = (await rt.memberIds(message.chatId)).filter((u) => u !== message.senderId);
      title = group ? chat.name : message.senderName;
      body = (group ? message.senderName + ': ' : '') + preview(message.text);
    }
    targets = targets.filter((u) => !rt.isOnline(u));
    await sendPush(targets, title, body, message.chatId);
  } catch (e) {
    // push must never affect sending
  }
}

module.exports = { router, notifyMessage };
