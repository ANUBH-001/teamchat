// A-07 / B-02 signed media URLs, B-03 media access control, A-05 server-side logout.
const H = require('./helpers/harness');
const { test, before, after, afterEach } = require('node:test');
const assert = require('node:assert');
const request = require('supertest');

let app, srv, boss, a, b, c, gone, chat, tokBoss, tokA, tokB, tokC, tokGone;
const env0 = { ...process.env };
const png = Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex'); // just bytes, type comes from the multipart mime

before(async () => {
  await H.resetDb();
  app = require('../src/app').createApp();
  srv = await H.startServer();
  boss = await H.createUser({ name: 'Boss', role: 'boss' });
  a = await H.createUser({ name: 'Alice' });
  b = await H.createUser({ name: 'Bob' });
  c = await H.createUser({ name: 'Carol' }); // never in the chat
  gone = await H.createUser({ name: 'Gone' }); // removed from the chat later
  chat = await H.createChat('group', 'Team', [a.id, b.id, gone.id], a.id); // boss is NOT a member
  [tokBoss, tokA, tokB, tokC, tokGone] = await Promise.all([boss, a, b, c, gone].map(H.tokenFor));
});
afterEach(() => {
  for (const k of ['MEDIA_ALLOW_TOKEN_QUERY', 'MEDIA_URL_SECRET', 'MEDIA_URL_TTL_SEC']) {
    if (env0[k] === undefined) delete process.env[k]; else process.env[k] = env0[k];
  }
});
after(async () => {
  const fs = require('fs');
  const { resolvePath } = require('../src/routes/media');
  const [rows] = await H.pool().query('SELECT path FROM media_files');
  for (const r of rows) { const f = resolvePath(r.path); if (f && fs.existsSync(f)) fs.unlinkSync(f); }
  await srv.close(); await H.teardown();
});

const upload = async (tok) => {
  const r = await request(app).post('/media').set(H.bearer(tok)).field('kind', 'image').attach('file', png, { filename: 'p.png', contentType: 'image/png' });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  return r.body.url;
};
const sign = (tok, paths) => request(app).post('/media/sign').set(H.bearer(tok)).send({ paths });
const signOne = async (tok, p) => { const r = await sign(tok, [p]); assert.equal(r.status, 200, JSON.stringify(r.body)); return r.body.urls[p]; };
let n = 0;
const sendImage = async (tok, url) => request(app).post('/chats/' + chat + '/messages').set(H.bearer(tok))
  .send({ type: 'image', mediaUrl: url, clientId: 'img-' + (++n), media: { kind: 'image', w: 1, h: 1 } });

test('B-03: uploader can sign before send; nobody else can (not even a chat member or the boss)', async () => {
  const url = await upload(tokA);
  const [[row]] = await H.pool().query('SELECT uploader_id FROM media_files WHERE path = ?', [url]);
  assert.equal(row.uploader_id, a.id);
  const mine = await signOne(tokA, url);
  assert.match(mine, /^\/media\/f\/.+\?u=\d+&e=\d+&s=[A-Za-z0-9_-]{43}$/);
  assert.ok(mine.startsWith(url + '?u=' + a.id + '&'));
  assert.equal(await signOne(tokB, url), null);
  assert.equal(await signOne(tokBoss, url), null);
  const got = await request(app).get(mine); // no Authorization header: the signature is the capability
  assert.equal(got.status, 200);
  assert.equal(got.headers['content-type'], 'image/png');
});

test('B-03: after send: member yes, non-member no, removed member no, boss yes; deleted message only boss', async () => {
  const url = await upload(tokA);
  assert.equal((await sendImage(tokA, url)).status, 201);
  assert.ok(await signOne(tokB, url), 'member');
  assert.equal(await signOne(tokC, url), null, 'non-member');
  assert.ok(await signOne(tokBoss, url), 'boss reads every non-check-in chat (admin viewer)');
  assert.ok(await signOne(tokGone, url), 'still a member');
  await H.pool().query('UPDATE chat_members SET left_at = NOW() WHERE chat_id = ? AND user_id = ?', [chat, gone.id]);
  assert.equal(await signOne(tokGone, url), null, 'removed member');
  // header auth (old / other clients) is access-checked the same way
  assert.equal((await request(app).get(url).set(H.bearer(tokB))).status, 200);
  assert.equal((await request(app).get(url).set(H.bearer(tokC))).status, 403);
  assert.equal((await request(app).get(url).set(H.bearer(tokGone))).status, 403);
  // deleted message: members lose it, the boss keeps it
  const [[m]] = await H.pool().query('SELECT id FROM messages WHERE media_url = ?', [url]);
  await H.pool().query('UPDATE messages SET deleted_at = NOW() WHERE id = ?', [m.id]);
  assert.equal(await signOne(tokB, url), null);
  assert.ok(await signOne(tokBoss, url));
  assert.ok(await signOne(tokA, url), 'the uploader still has it');
});

test('B-03: check-in chat media is private to its owner, even for the boss', async () => {
  const url = await upload(tokB);
  const [r] = await H.pool().query("INSERT INTO chats (type, name, created_by, owner_id) VALUES ('checkin', 'Daily Check-in', ?, ?)", [b.id, b.id]);
  await H.pool().query('INSERT INTO chat_members (chat_id, user_id) VALUES (?, ?), (?, ?)', [r.insertId, b.id, r.insertId, boss.id]);
  await H.pool().query("INSERT INTO messages (chat_id, sender_id, body, type, media_url) VALUES (?, ?, '', 'image', ?)", [r.insertId, b.id, url]);
  await H.pool().query('DELETE FROM media_files WHERE path = ?', [url]); // only the message grants access now
  assert.ok(await signOne(tokB, url));
  assert.equal(await signOne(tokBoss, url), null);
});

test('B-03: a profile photo is visible to every logged-in user; only your own upload can become your photo', async () => {
  const url = await upload(tokC);
  const other = await upload(tokA);
  const bad = await request(app).patch('/auth/me').set(H.bearer(tokC)).send({ avatarUrl: other });
  assert.equal(bad.status, 400);
  assert.equal(bad.body.code, 'BAD_AVATAR');
  assert.equal((await request(app).patch('/auth/me').set(H.bearer(tokC)).send({ avatarUrl: url })).status, 200);
  assert.ok(await signOne(tokB, url));
  assert.ok(await signOne(tokBoss, url));
  assert.equal((await request(app).get('/media/f/x').query({})).status, 401); // still login / signature required
});

test('B-03: a message cannot re-share a file the sender may not see', async () => {
  const url = await upload(tokA); // never sent
  const r = await sendImage(tokB, url);
  assert.equal(r.status, 403);
  assert.equal(r.body.code, 'NOT_ALLOWED');
});

test('A-07: tampered, cross-user, expired and malformed signatures are rejected', async () => {
  const url = await upload(tokA);
  const good = await signOne(tokA, url);
  assert.equal((await request(app).get(good)).status, 200);
  const q = new URLSearchParams(good.split('?')[1]);
  const s = q.get('s');
  const flip = s.slice(0, -1) + (s.endsWith('A') ? 'B' : 'A');
  const cases = [
    url + '?u=' + a.id + '&e=' + q.get('e') + '&s=' + flip, // tampered sig
    url + '?u=' + b.id + '&e=' + q.get('e') + '&s=' + s, // other user
    url + '?u=' + a.id + '&e=' + (Number(q.get('e')) + 3600) + '&s=' + s, // extended expiry
    url.replace(/\.png$/, '.jpg') + '?u=' + a.id + '&e=' + q.get('e') + '&s=' + s, // other file
    url + '?u=' + a.id + '&e=abc&s=' + s,
    url + '?u=' + a.id + '&e=' + q.get('e') + '&s=short',
  ];
  for (const bad of cases) {
    const r = await request(app).get(bad);
    assert.equal(r.status, 403, bad);
    assert.equal(r.body.code, 'BAD_SIGNATURE');
  }
  const mediaAuth = require('../src/mediaAuth');
  const old = mediaAuth.sign(url, a.id, Date.now() - 2 * 3600 * 1000);
  const exp = await request(app).get(url + '?' + old.qs);
  assert.equal(exp.status, 403);
  assert.equal(exp.body.code, 'EXPIRED');
  // a different secret invalidates everything
  process.env.MEDIA_URL_SECRET = 'rotated-secret-for-test';
  assert.equal((await request(app).get(good)).status, 403);
});

test('A-07: TTL is 30 min by default and expiresAt is returned; sign validates input', async () => {
  const url = await upload(tokA);
  const r = await sign(tokA, [url, '/media/f/../../src/app.js', '/media/f/%2e%2e/x.png', 'http://evil/x.png', 42]);
  assert.equal(r.status, 200);
  const e = Number(new URLSearchParams(r.body.urls[url].split('?')[1]).get('e'));
  const left = e - Date.now() / 1000;
  assert.ok(left > 1790 && left <= 1801, String(left));
  assert.equal(r.body.expiresAt, e * 1000);
  assert.equal(r.body.urls['/media/f/../../src/app.js'], null);
  assert.equal(r.body.urls['/media/f/%2e%2e/x.png'], null);
  assert.equal(r.body.urls['http://evil/x.png'], null);
  assert.equal((await sign(tokA, 'nope')).status, 400);
  assert.equal((await sign(tokA, Array(101).fill(url))).status, 400);
  assert.equal((await request(app).post('/media/sign').send({ paths: [url] })).status, 401);
});

test('A-07: legacy ?t=<jwt> works only while MEDIA_ALLOW_TOKEN_QUERY is on, and is access-checked', async () => {
  const url = await upload(tokA);
  assert.equal((await sendImage(tokA, url)).status, 201);
  assert.equal((await request(app).get(url).query({ t: tokB })).status, 200);
  assert.equal((await request(app).get(url).query({ t: tokC })).status, 403);
  process.env.MEDIA_ALLOW_TOKEN_QUERY = 'false';
  assert.equal((await request(app).get(url).query({ t: tokB })).status, 401);
  assert.equal((await request(app).get(url).set(H.bearer(tokB))).status, 200, 'header auth is never affected');
  assert.ok(await signOne(tokB, url));
});

test('path traversal is still blocked (header and signed)', async () => {
  for (const p of ['/media/f/..%2f..%2fsrc%2fapp.js', '/media/f/%2e%2e/%2e%2e/package.json', '/media/f/..%5c..%5cpackage.json']) {
    const r = await request(app).get(p).set(H.bearer(tokA));
    assert.ok([400, 403, 404].includes(r.status), p + ' -> ' + r.status);
    assert.ok(!/teamchat-server|createApp/.test(r.text));
  }
  const mediaAuth = require('../src/mediaAuth');
  const forged = mediaAuth.sign('/media/f/../package.json', a.id); // even a valid signature cannot escape the root
  const r = await request(app).get('/media/f/..%2fpackage.json?' + forged.qs);
  assert.ok([400, 403].includes(r.status), String(r.status));
});

test('A-07: static map: signed URL works without the JWT; a bad signature does not', async () => {
  const p = '/media/staticmap?lat=99&lng=10&z=16'; // lat out of range -> 400 after auth, so no tile is fetched
  const u = await signOne(tokA, p);
  assert.ok(u && u.startsWith(p + '&u='), u);
  assert.equal((await request(app).get(u)).status, 400);
  assert.equal((await request(app).get(u.replace('lng=10', 'lng=11'))).status, 403);
  assert.equal((await request(app).get(p)).status, 401);
});

test('A-05: POST /auth/logout revokes the token (REST 401, live socket closed, reconnect refused)', async () => {
  const tok = await H.tokenFor(b);
  const w = H.wsClient(srv.url, tok);
  await w.hello();
  const r = await request(app).post('/auth/logout').set(H.bearer(tok));
  assert.equal(r.status, 200);
  assert.deepEqual(r.body, { ok: true });
  assert.equal(await w.closedP, 4401);
  assert.equal((await request(app).get('/auth/me').set(H.bearer(tok))).status, 401);
  assert.equal((await request(app).post('/media/sign').set(H.bearer(tok)).send({ paths: [] })).status, 401);
  const w2 = H.wsClient(srv.url, tok);
  const code = await w2.closedP;
  assert.ok([4401, 4409].includes(code), String(code));
  assert.equal(w2.events.filter((m) => m.type === 'hello').length, 0);
  assert.equal((await request(app).post('/auth/logout').set(H.bearer(tok))).status, 401); // already revoked
  // a fresh login works again
  const again = await request(app).post('/auth/login').send({ phone: b.phone, pin: '1234' });
  assert.equal(again.status, 200);
  assert.equal((await request(app).get('/auth/me').set(H.bearer(again.body.token))).status, 200);
  tokB = again.body.token;
});
