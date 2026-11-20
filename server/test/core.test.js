// Core flows against a real MySQL (team_chat_audit), real Express app and real ws server.
const H = require('./helpers/harness');
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const request = require('supertest');

let app, srv, boss, a, b, outsider, chat, tokA, tokB, tokO, tokBoss;
before(async () => {
  await H.resetDb();
  app = require('../src/app').createApp();
  srv = await H.startServer();
  boss = await H.createUser({ name: 'Boss', role: 'boss' });
  a = await H.createUser({ name: 'Alice' });
  b = await H.createUser({ name: 'Bob' });
  outsider = await H.createUser({ name: 'Outsider' });
  chat = await H.createChat('group', 'Team', [boss.id, a.id, b.id], boss.id);
  [tokA, tokB, tokO, tokBoss] = await Promise.all([a, b, outsider, boss].map(H.tokenFor));
});
after(async () => { await srv.close(); await H.teardown(); });

const post = (tok, id, body) => request(app).post('/chats/' + id + '/messages').set(H.bearer(tok)).send(body);

test('login ok and bad PIN', async () => {
  const ok = await request(app).post('/auth/login').send({ phone: a.phone, pin: '1234' });
  assert.equal(ok.status, 200);
  assert.ok(ok.body.token);
  assert.equal(ok.body.user.id, a.id);
  tokA = ok.body.token; // login rotates the session
  const bad = await request(app).post('/auth/login').send({ phone: a.phone, pin: '9999' });
  assert.equal(bad.status, 401);
  assert.equal(bad.body.token, undefined);
  const me = await request(app).get('/auth/me').set(H.bearer(tokA));
  assert.equal(me.status, 200);
});

test('old token is rejected after a newer login (session id check)', async () => {
  const old = await H.tokenFor(b);
  await H.tokenFor(b);
  const r = await request(app).get('/auth/me').set(H.bearer(old));
  assert.equal(r.status, 401);
  assert.equal(r.body.code, 'SESSION_REPLACED');
  tokB = await H.tokenFor(b);
});

test('messages: unauthenticated 401, non-member 403, member ok', async () => {
  assert.equal((await request(app).get('/chats/' + chat + '/messages')).status, 401);
  assert.equal((await request(app).post('/chats/' + chat + '/messages').send({ text: 'x', clientId: 'u1' })).status, 401);
  assert.equal((await request(app).get('/chats/' + chat + '/messages').set(H.bearer(tokO))).status, 403);
  assert.equal((await post(tokO, chat, { text: 'hi', clientId: 'o1' })).status, 403);
  const sent = await post(tokA, chat, { text: 'hello team', clientId: 'a-1' });
  assert.equal(sent.status, 201);
  const list = await request(app).get('/chats/' + chat + '/messages').set(H.bearer(tokB));
  assert.equal(list.status, 200);
  assert.ok(list.body.messages.some((m) => m.text === 'hello team'));
  assert.equal((await request(app).get('/chats/99999/messages').set(H.bearer(tokA))).status, 403);
});

test('idempotent send: same clientId twice = one row, same id', async () => {
  const r1 = await post(tokA, chat, { text: 'once', clientId: 'dup-1' });
  const r2 = await post(tokA, chat, { text: 'once', clientId: 'dup-1' });
  assert.equal(r1.status, 201);
  assert.equal(r2.status, 200);
  assert.equal(r2.body.duplicate, true);
  assert.equal(r2.body.message.id, r1.body.message.id);
  const [[c]] = await H.pool().query('SELECT COUNT(*) n FROM messages WHERE sender_id = ? AND client_id = ?', [a.id, 'dup-1']);
  assert.equal(c.n, 1);
});

test('realtime: A sends via REST, B receives exactly once', async () => {
  const wb = H.wsClient(srv.url, tokB);
  await wb.hello();
  const r = await post(tokA, chat, { text: 'ping B', clientId: 'rt-1' });
  const id = r.body.message.id;
  await wb.waitFor((m) => m.type === 'message' && m.message.id === id);
  await H.sleep(300);
  assert.equal(wb.events.filter((m) => m.type === 'message' && m.message.id === id).length, 1);
  wb.close();
});

test('typing: member is relayed, non-member is ignored', async () => {
  const wb = H.wsClient(srv.url, tokB);
  const wo = H.wsClient(srv.url, tokO);
  const wa = H.wsClient(srv.url, tokA);
  await Promise.all([wb.hello(), wo.hello(), wa.hello()]);
  wo.send({ type: 'typing', chatId: chat });
  await H.sleep(300);
  assert.equal(wb.events.filter((m) => m.type === 'typing').length, 0);
  wa.send({ type: 'typing', chatId: chat });
  const t = await wb.waitFor((m) => m.type === 'typing');
  assert.equal(t.userId, a.id);
  [wa, wb, wo].forEach((w) => w.close());
});

test('bad token closes ws with 4401', async () => {
  const w = H.wsClient(srv.url, 'not-a-token');
  assert.equal(await w.closedP, 4401);
});
