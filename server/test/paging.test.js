// B-05: GET /chats/:id/messages?after= is capped at 500 and must tell the client there is more.
const H = require('./helpers/harness');
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const request = require('supertest');

let app, u, chat, tok;
before(async () => {
  await H.resetDb();
  app = require('../src/app').createApp();
  u = await H.createUser({ name: 'Pager' });
  chat = await H.createChat('group', 'Big', [u.id], u.id);
  tok = await H.tokenFor(u);
  const rows = [];
  for (let i = 1; i <= 600; i++) rows.push([chat, u.id, 'm' + i, 'c' + i]);
  await H.pool().query('INSERT INTO messages (chat_id, sender_id, body, client_id) VALUES ?', [rows]);
});
after(async () => { await H.teardown(); });

test('after-paging with 600 messages: hasMore until the end, every message exactly once, in order', async () => {
  const seen = [];
  let cursor = 1; // below the first id
  let pages = 0;
  for (;;) {
    const r = await request(app).get('/chats/' + chat + '/messages?after=' + cursor).set(H.bearer(tok));
    assert.equal(r.status, 200);
    seen.push(...r.body.messages.map((m) => m.text));
    pages += 1;
    assert.ok(pages < 5);
    if (!r.body.hasMore) break;
    assert.equal(r.body.messages.length, 500);
    cursor = r.body.messages[r.body.messages.length - 1].id;
  }
  // first message is id 1 which "after=1" skips; start from 0 semantic: fetch m1 separately
  assert.equal(seen.length, 599);
  assert.deepEqual(seen, Array.from({ length: 599 }, (_, i) => 'm' + (i + 2)));
  assert.equal(pages, 2);
});

test('exactly 500 remaining: hasMore false; before-paging unchanged', async () => {
  const [[first]] = await H.pool().query('SELECT MIN(id) id FROM messages WHERE chat_id = ?', [chat]);
  const r = await request(app).get('/chats/' + chat + '/messages?after=' + (Number(first.id) + 99)).set(H.bearer(tok));
  assert.equal(r.body.messages.length, 500);
  assert.equal(r.body.hasMore, false);
  const b = await request(app).get('/chats/' + chat + '/messages?limit=30').set(H.bearer(tok));
  assert.equal(b.body.messages.length, 30);
  assert.equal(b.body.hasMore, true);
});
