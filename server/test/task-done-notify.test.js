// R-04s: ticking a task done in the Tasks tab notifies the other side (ws 'task' event + a bot card in the right chat), exactly once.
const H = require('./helpers/harness');
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const request = require('supertest');

let app, srv, boss, member, group, tokBoss, tokM;
before(async () => {
  await H.resetDb();
  app = require('../src/app').createApp();
  srv = await H.startServer();
  boss = await H.createUser({ name: 'Rishit', role: 'boss' });
  member = await H.createUser({ name: 'Anubhav' });
  group = await H.createChat('group', 'Team', [boss.id, member.id], boss.id);
  [tokBoss, tokM] = await Promise.all([boss, member].map(H.tokenFor));
});
after(async () => { await srv.close(); await H.teardown(); });

const mkTask = async (tok, body) => (await request(app).post('/tasks').set(H.bearer(tok)).send(body)).body.task;
const isDoneCard = (m) => m.type === 'message' && m.message.type === 'bot' && m.message.payload && m.message.payload.kind === 'task' &&
  m.message.payload.event === 'completed';
const isTaskEv = (m) => m.type === 'task' && m.event === 'completed';

async function scenario(taskBody, creatorTok, actorTok, receiver, receiverTok) {
  const task = await mkTask(creatorTok, taskBody);
  const w = H.wsClient(srv.url, receiverTok);
  await w.hello();
  const r = await request(app).patch('/tasks/' + task.id).set(H.bearer(actorTok)).send({ status: 'done' });
  assert.equal(r.status, 200);
  const ev = await w.waitFor(isTaskEv);
  const card = await w.waitFor(isDoneCard);
  await H.sleep(300);
  assert.equal(w.events.filter(isTaskEv).length, 1);
  assert.equal(w.events.filter(isDoneCard).length, 1);
  assert.equal(ev.task.id, task.id);
  w.close();
  return { task, ev, card };
}

test('member marks own task done -> admin gets one ws task event and one card (task made in a chat)', async () => {
  const { ev, card } = await scenario({ title: 'Report', assigneeIds: [member.id], chatId: group }, tokBoss, tokM, boss, tokBoss);
  assert.equal(ev.actorId, member.id);
  assert.equal(ev.task.status, 'done');
  assert.equal(card.message.chatId, group);
  assert.equal(card.message.payload.actorId, member.id);
});

test('member marks own task done -> admin notified even when the task has no chat (DM fallback)', async () => {
  const { card } = await scenario({ title: 'Report 2', assigneeIds: [member.id] }, tokBoss, tokM, boss, tokBoss);
  const [[chat]] = await H.pool().query('SELECT type FROM chats WHERE id = ?', [card.message.chatId]);
  assert.equal(chat.type, 'dm');
});

test('boss marks a member task done -> member gets one ws task event and one card', async () => {
  const { ev, card } = await scenario({ title: 'Deploy', assigneeIds: [member.id], chatId: group }, tokBoss, tokBoss, member, tokM);
  assert.equal(ev.actorId, boss.id);
  assert.equal(card.message.chatId, group);
});

test('boss marks a member task done (no chat) -> member gets a DM card', async () => {
  const { card } = await scenario({ title: 'Deploy 2', assigneeIds: [member.id] }, tokBoss, tokBoss, member, tokM);
  const [[chat]] = await H.pool().query('SELECT type FROM chats WHERE id = ?', [card.message.chatId]);
  assert.equal(chat.type, 'dm');
});

test('boss private self-task done posts no card', async () => {
  const t = await mkTask(tokBoss, { title: 'Mine', assigneeIds: [boss.id] });
  const [[before]] = await H.pool().query('SELECT COUNT(*) n FROM messages');
  await request(app).patch('/tasks/' + t.id).set(H.bearer(tokBoss)).send({ status: 'done' });
  const [[after2]] = await H.pool().query('SELECT COUNT(*) n FROM messages');
  assert.equal(after2.n, before.n);
});
