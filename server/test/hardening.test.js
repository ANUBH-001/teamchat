// A-03 ping/pong, B-21 JSON errors, B-12 ws payload cap, B-15 invite race.
const H = require('./helpers/harness');
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const request = require('supertest');

let app, srv, a, tokA;
before(async () => {
  await H.resetDb();
  app = require('../src/app').createApp();
  srv = await H.startServer();
  a = await H.createUser({ name: 'Alice' });
  tokA = await H.tokenFor(a);
});
after(async () => { await srv.close(); await H.teardown(); });

test('A-03: ws {"type":"ping"} gets {"type":"pong","t":<ms>} on that socket only', async () => {
  const w1 = H.wsClient(srv.url, tokA);
  const w2 = H.wsClient(srv.url, tokA); // same user, other device
  await Promise.all([w1.hello(), w2.hello()]);
  const before = Date.now();
  w1.send({ type: 'ping' });
  const pong = await w1.waitFor((m) => m.type === 'pong');
  assert.equal(typeof pong.t, 'number');
  assert.ok(pong.t >= before - 5 && pong.t <= Date.now() + 5);
  await H.sleep(200);
  assert.equal(w2.events.filter((m) => m.type === 'pong').length, 0);
  w1.close(); w2.close();
});

test('B-21: malformed JSON body -> 400 JSON, not an HTML stack', async () => {
  const r = await request(app).post('/auth/login').set('Content-Type', 'application/json').send('{"phone": "98');
  assert.equal(r.status, 400);
  assert.match(r.headers['content-type'], /application\/json/);
  assert.equal(r.body.code, 'BAD_JSON');
  assert.ok(!/<html|at .*\.js/i.test(r.text));
  const big = await request(app).post('/auth/login').set('Content-Type', 'application/json').send(JSON.stringify({ x: 'a'.repeat(300000) }));
  assert.equal(big.status, 413);
  assert.match(big.headers['content-type'], /application\/json/);
});

test('B-12: an oversize ws frame closes the socket (1009); small frames still work', async () => {
  const w = H.wsClient(srv.url, tokA);
  await w.hello();
  w.send({ type: 'ping' });
  await w.waitFor((m) => m.type === 'pong');
  w.send('x'.repeat(70 * 1024));
  assert.equal(await w.closedP, 1009);
});

test('B-15: two concurrent activations with one invite -> exactly one succeeds', async () => {
  const { hashCode } = require('../src/routes/auth');
  const [r] = await H.pool().query("INSERT INTO users (phone, name, role) VALUES ('9000000001', 'Newbie', 'member')");
  await H.pool().query('INSERT INTO invites (user_id, code) VALUES (?, ?)', [r.insertId, hashCode('ABCD1234')]);
  const go = (pin) => request(app).post('/auth/activate').send({ phone: '9000000001', inviteCode: 'ABCD1234', pin });
  const res = await Promise.all([go('1111'), go('2222'), go('3333'), go('4444')]);
  const ok = res.filter((x) => x.status === 200);
  assert.equal(ok.length, 1, res.map((x) => x.status).join(','));
  assert.ok(res.filter((x) => x.status === 400).length === 3);
  // the PIN that won is the one that works
  const winner = ['1111', '2222', '3333', '4444'][res.indexOf(ok[0])];
  const login = await request(app).post('/auth/login').send({ phone: '9000000001', pin: winner });
  assert.equal(login.status, 200);
  const [[inv]] = await H.pool().query('SELECT used_at FROM invites WHERE user_id = ?', [r.insertId]);
  assert.ok(inv.used_at);
});
