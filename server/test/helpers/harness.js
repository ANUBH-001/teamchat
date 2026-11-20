// Integration-test harness: real MySQL, real app, real ws. SAFETY: only ever talks to the throwaway DB team_chat_audit on
// localhost; anything else aborts before a connection is made. Require this file BEFORE any ../src module (it sets env).
const mysql = require('mysql2/promise');
const fs = require('fs');
const path = require('path');
const http = require('http');
const bcrypt = require('bcryptjs');
const WebSocket = require('ws');

const cfg = {
  host: process.env.TEST_DB_HOST || '127.0.0.1',
  port: parseInt(process.env.TEST_DB_PORT, 10) || 3307,
  user: process.env.TEST_DB_USER || 'root',
  password: process.env.TEST_DB_PASSWORD || '',
  name: process.env.TEST_DB_NAME || 'team_chat_audit',
};
if (cfg.name !== 'team_chat_audit' || !['127.0.0.1', 'localhost'].includes(cfg.host)) {
  throw new Error('Refusing to run tests: DB must be team_chat_audit on 127.0.0.1/localhost (got ' + cfg.name + ' @ ' + cfg.host + ')');
}
Object.assign(process.env, {
  DB_HOST: cfg.host, DB_PORT: String(cfg.port), DB_USER: cfg.user, DB_PASSWORD: cfg.password, DB_NAME: cfg.name,
  JWT_SECRET: 'test-secret-not-for-prod', AI_PROVIDER: 'mock', AI_API_KEY: '',
});
delete process.env.AI_API_KEY;

// Drop + create the DB and load schema.sql (CREATE DATABASE / USE lines stripped). Call once in before().
async function resetDb() {
  const conn = await mysql.createConnection({ host: cfg.host, port: cfg.port, user: cfg.user, password: cfg.password, multipleStatements: true });
  try {
    await conn.query('DROP DATABASE IF EXISTS `' + cfg.name + '`');
    await conn.query('CREATE DATABASE `' + cfg.name + '` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci');
    await conn.query('USE `' + cfg.name + '`');
    const sql = fs.readFileSync(path.join(__dirname, '..', '..', 'sql', 'schema.sql'), 'utf8')
      .split(/\r?\n/).filter((l) => !/^\s*(CREATE DATABASE|USE)\b/i.test(l)).join('\n');
    await conn.query(sql);
  } finally { await conn.end(); }
}

let seq = 0;
const pool = () => require('../../src/db');

// role 'boss' | 'member'; PIN defaults to 1234. Phone is unique per call.
async function createUser({ name, role = 'member', pin = '1234', phone } = {}) {
  seq += 1;
  phone = phone || '9' + String(100000000 + seq * 7919).slice(0, 9);
  name = name || 'User' + seq;
  const hash = await bcrypt.hash(pin, 4);
  const [r] = await pool().query('INSERT INTO users (phone, name, role, pin_hash, profile_done) VALUES (?, ?, ?, ?, 1)', [phone, name, role, hash]);
  return { id: r.insertId, phone, name, role, pin };
}

// Same as /auth/login: rotates users.session_id and signs { id, sv }.
async function tokenFor(user) {
  const [[u]] = await pool().query('SELECT * FROM users WHERE id = ?', [user.id]);
  return require('../../src/routes/auth').startSession(u);
}
const bearer = (token) => ({ Authorization: 'Bearer ' + token });

async function createChat(type, name, memberIds, createdBy) {
  const [r] = await pool().query('INSERT INTO chats (type, name, created_by) VALUES (?, ?, ?)', [type, name, createdBy || memberIds[0] || null]);
  for (const id of memberIds) await pool().query('INSERT INTO chat_members (chat_id, user_id) VALUES (?, ?)', [r.insertId, id]);
  return r.insertId;
}

async function setSetting(name, value) { return require('../../src/settings').update({ [name]: value }); }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// Poll until fn() returns truthy (the AI pipeline runs after the HTTP reply).
async function waitFor(fn, ms = 4000) {
  const end = Date.now() + ms;
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() > end) throw new Error('waitFor timed out');
    await sleep(25);
  }
}

// Real http server + ws attached, on an ephemeral port.
async function startServer() {
  const { createApp } = require('../../src/app');
  const server = http.createServer(createApp());
  const wss = require('../../src/realtime').attach(server);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;
  return { server, port, url: 'ws://127.0.0.1:' + port, close: () => { for (const c of wss.clients) c.terminate(); wss.close(); server.closeAllConnections && server.closeAllConnections(); return new Promise((r) => server.close(r)); } };
}

// ws client: collects every JSON frame in .events; waitFor(pred) resolves with the first matching (incl. already received).
const allClients = [];
function wsClient(url, token, { header = true } = {}) {
  const ws = new WebSocket(header ? url : url + '/?token=' + token, header ? { headers: bearer(token) } : undefined);
  const events = [];
  const waiters = [];
  const c = { ws, events, closed: null };
  allClients.push(ws);
  ws.on('message', (d) => {
    let m; try { m = JSON.parse(String(d)); } catch (e) { return; }
    events.push(m);
    for (const w of [...waiters]) if (w.pred(m)) { waiters.splice(waiters.indexOf(w), 1); clearTimeout(w.t); w.res(m); }
  });
  c.closedP = new Promise((res) => ws.on('close', (code) => { c.closed = code; res(code); }));
  ws.on('error', () => {});
  c.open = () => new Promise((res, rej) => { ws.once('open', res); ws.once('close', () => rej(new Error('closed'))); });
  c.waitFor = (pred, ms = 3000) => {
    const hit = events.find(pred);
    if (hit) return Promise.resolve(hit);
    return new Promise((res, rej) => { const w = { pred, res, t: setTimeout(() => rej(new Error('ws waitFor timed out')), ms) }; waiters.push(w); });
  };
  c.hello = () => c.waitFor((m) => m.type === 'hello');
  c.send = (o) => ws.send(typeof o === 'string' ? o : JSON.stringify(o));
  c.close = () => { try { ws.close(); } catch (e) { /* */ } };
  return c;
}

async function teardown() {
  for (const w of allClients) { try { w.terminate(); } catch (e) { /* */ } } await pool().end().catch(() => {}); }

module.exports = { cfg, resetDb, createUser, tokenFor, bearer, createChat, setSetting, sleep, waitFor, startServer, wsClient, teardown, pool };
