// Device test 2026-11-20 (A-06 follow-up): after logout the phone's HTTP disk cache (OkHttp) still held chat messages,
// tasks and the people list, because API JSON went out with only an ETag. Authenticated API answers must be no-store.
const H = require('./helpers/harness');
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const request = require('supertest');

let app, srv, a, tokA, chat;
before(async () => {
  await H.resetDb();
  app = require('../src/app').createApp();
  srv = await H.startServer();
  a = await H.createUser({ name: 'Alice' });
  const b = await H.createUser({ name: 'Bob' });
  chat = await H.createChat('group', 'Team', [a.id, b.id], a.id);
  tokA = await H.tokenFor(a);
});
after(async () => { await srv.close(); await H.teardown(); });

for (const path of ['/chats', () => '/chats/' + chat.id + '/messages?limit=30', '/tasks?scope=mine', '/users?includeSelf=1', '/auth/me']) {
  test('no-store on ' + (typeof path === 'string' ? path : '/chats/:id/messages'), async () => {
    const r = await request(app).get(typeof path === 'string' ? path : path()).set(H.bearer(tokA));
    assert.ok(r.status < 500, String(r.status));
    assert.match(r.headers['cache-control'] || '', /no-store/);
  });
}

test('errors (401) are no-store too', async () => {
  const r = await request(app).get('/chats');
  assert.equal(r.status, 401);
  assert.match(r.headers['cache-control'] || '', /no-store/);
});

test('OTA manifest and health are untouched by the API rule', async () => {
  const h = await request(app).get('/health');
  assert.doesNotMatch(h.headers['cache-control'] || '', /no-store/);
});
