// R-01: create/assign rules. Self-task always allowed; assigning others = boss OR settings.membersCanAssign.
const H = require('./helpers/harness');
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const request = require('supertest');

let app, boss, m1, m2, chat, tokBoss, tok1, tok2;
before(async () => {
  await H.resetDb();
  app = require('../src/app').createApp();
  boss = await H.createUser({ name: 'Rishit', role: 'boss' });
  m1 = await H.createUser({ name: 'Anubhav' });
  m2 = await H.createUser({ name: 'Uzair' });
  chat = await H.createChat('group', 'Team', [boss.id, m1.id, m2.id], boss.id);
  [tokBoss, tok1, tok2] = await Promise.all([boss, m1, m2].map(H.tokenFor));
});
after(async () => { await H.teardown(); });

const mk = (tok, body) => request(app).post('/tasks').set(H.bearer(tok)).send(body);

test('member self-task via REST works and is NOT private (toggle off)', async () => {
  await H.setSetting('membersCanAssign', false);
  const r = await mk(tok1, { title: 'My report', assigneeIds: [m1.id] });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  assert.equal(r.body.task.private, false);
  assert.equal(r.body.task.createdBy, m1.id);
  const seen = await request(app).get('/tasks/' + r.body.task.id).set(H.bearer(tokBoss));
  assert.equal(seen.status, 200); // admin can see it
});

test('member -> other: 403 with toggle off, 201 with toggle on', async () => {
  await H.setSetting('membersCanAssign', false);
  const no = await mk(tok1, { title: 'For Uzair', assigneeIds: [m2.id] });
  assert.equal(no.status, 403);
  assert.equal(no.body.code, 'NOT_ALLOWED');
  const mixed = await mk(tok1, { title: 'Both', assigneeIds: [m1.id, m2.id] });
  assert.equal(mixed.status, 403);
  await H.setSetting('membersCanAssign', true);
  const yes = await mk(tok1, { title: 'For Uzair', assigneeIds: [m2.id] });
  assert.equal(yes.status, 201);
  assert.equal(yes.body.task.private, false);
});

test('boss unchanged: assigns anyone; boss self-only task stays private', async () => {
  await H.setSetting('membersCanAssign', false);
  const other = await mk(tokBoss, { title: 'Boss->member', assigneeIds: [m1.id] });
  assert.equal(other.status, 201);
  assert.equal(other.body.task.private, false);
  const self = await mk(tokBoss, { title: 'Boss own', assigneeIds: [boss.id] });
  assert.equal(self.status, 201);
  assert.equal(self.body.task.private, true);
});

test('members cannot manage tasks they neither created nor are assigned to', async () => {
  await H.setSetting('membersCanAssign', true);
  const t = await mk(tokBoss, { title: 'Boss task', assigneeIds: [m1.id] });
  const id = t.body.task.id;
  const other = await request(app).patch('/tasks/' + id).set(H.bearer(tok2)).send({ title: 'hijack' });
  assert.equal(other.status, 403);
  const assignee = await request(app).patch('/tasks/' + id).set(H.bearer(tok1)).send({ title: 'renamed' });
  assert.equal(assignee.status, 200);
  await H.setSetting('membersCanAssign', false);
  const off = await request(app).patch('/tasks/' + id).set(H.bearer(tok1)).send({ title: 'again' });
  assert.equal(off.status, 403); // toggle off: members cannot reassign/rename
});

// ---- /task command path ----
async function say(tok, user, text) {
  const r = await request(app).post('/chats/' + chat + '/messages').set(H.bearer(tok)).send({ text, clientId: 'c-' + Math.random() });
  assert.equal(r.status, 201);
  return r.body.message.id;
}
const botAfter = (msgId, userId) => H.waitFor(async () => {
  const [rows] = await H.pool().query(
    'SELECT * FROM messages WHERE chat_id = ? AND id > ? AND type = ? AND (visible_to IS NULL OR visible_to = ?) ORDER BY id LIMIT 1', [chat, msgId, 'bot', userId]);
  return rows[0];
});

test('/task khud ... by a member creates a self-task (toggle off)', async () => {
  await H.setSetting('membersCanAssign', false);
  const id = await say(tok1, m1, '/task khud login page fix karna hai');
  const row = await botAfter(id, m1.id);
  const p = JSON.parse(row.payload);
  assert.equal(p.kind, 'task', row.body);
  assert.equal(p.task.assigneeId, m1.id);
  assert.equal(p.task.private, false);
});

test('/task @Uzair by a member: NOT_ALLOWED off, created on', async () => {
  await H.setSetting('membersCanAssign', false);
  const id = await say(tok1, m1, '/task @Uzair report banani hai');
  const row = await botAfter(id, m1.id);
  assert.match(row.body, /admin/i);
  assert.equal(row.visible_to, m1.id);
  const [[n]] = await H.pool().query("SELECT COUNT(*) n FROM tasks WHERE title LIKE '%eport%' AND assignee_id = ?", [m2.id]);
  assert.equal(n.n, 0);
  await H.setSetting('membersCanAssign', true);
  const id2 = await say(tok1, m1, '/task @Uzair report banani hai');
  const row2 = await botAfter(id2, m1.id);
  assert.equal(JSON.parse(row2.payload).kind, 'task');
});
