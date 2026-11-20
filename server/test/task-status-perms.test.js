// R-06: only the assignee or an admin may change a task's status; only an admin may delete (close) a task.
const H = require('./helpers/harness');
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const request = require('supertest');
const T = require('../src/tasks');

let app, boss, m1, m2, creator, tokBoss, tok1, tok2, tokCreator;
before(async () => {
  await H.resetDb();
  app = require('../src/app').createApp();
  boss = await H.createUser({ name: 'Rishit', role: 'boss' });
  m1 = await H.createUser({ name: 'Anubhav' });
  m2 = await H.createUser({ name: 'Uzair' });
  creator = await H.createUser({ name: 'Creator' });
  [tokBoss, tok1, tok2, tokCreator] = await Promise.all([boss, m1, m2, creator].map(H.tokenFor));
  await H.setSetting('membersCanAssign', true);
});
after(async () => { await H.teardown(); });

const mk = async (assignee, tok = tokBoss) => {
  const r = await request(app).post('/tasks').set(H.bearer(tok)).send({ title: 'T' + Math.random(), assigneeIds: [assignee.id] });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  return r.body.task.id;
};
const patch = (id, tok, body) => request(app).patch('/tasks/' + id).set(H.bearer(tok)).send(body);

test('status: assignee 200, other member 403, admin 200', async () => {
  const id = await mk(m1);
  assert.equal((await patch(id, tok2, { status: 'done' })).status, 403);
  assert.equal((await patch(id, tok1, { status: 'done' })).status, 200);
  assert.equal((await patch(id, tok2, { status: 'todo' })).status, 403);
  assert.equal((await patch(id, tokBoss, { status: 'todo' })).status, 200);
});

test('undo: other member 403, assignee 200', async () => {
  const id = await mk(m1);
  await patch(id, tok1, { status: 'done' });
  assert.equal((await request(app).post('/tasks/' + id + '/undo').set(H.bearer(tok2))).status, 403);
  assert.equal((await request(app).post('/tasks/' + id + '/undo').set(H.bearer(tok1))).status, 200);
});

test('creator who is not the assignee cannot tick the task; admin can', async () => {
  const id = await mk(m1, tokCreator);
  assert.equal((await patch(id, tokCreator, { status: 'done' })).status, 403);
  assert.equal((await patch(id, tokBoss, { status: 'done' })).status, 200);
});

test('assignee cannot set another assignee\'s status', async () => {
  const r = await request(app).post('/tasks').set(H.bearer(tokBoss)).send({ title: 'two', assigneeIds: [m1.id, m2.id] });
  const id = r.body.task.id;
  assert.equal((await patch(id, tok1, { status: 'done', userId: m2.id })).status, 403);
});

test('delete/close/reopen: non-admin 403 (even the creator and the assignee), admin 200', async () => {
  const id = await mk(m1, tokCreator);
  for (const tok of [tok1, tok2, tokCreator]) {
    assert.equal((await request(app).delete('/tasks/' + id).set(H.bearer(tok))).status, 403);
    assert.equal((await request(app).post('/tasks/' + id + '/close').set(H.bearer(tok))).status, 403);
  }
  assert.equal((await request(app).delete('/tasks/' + id).set(H.bearer(tokBoss))).status, 200);
  assert.equal((await request(app).post('/tasks/' + id + '/reopen').set(H.bearer(tokCreator))).status, 403);
  assert.equal((await request(app).post('/tasks/' + id + '/reopen').set(H.bearer(tokBoss))).status, 200);
});

test('task logic (used by ws, slash commands and the AI) enforces the same rule', async () => {
  const id = await mk(m1);
  await assert.rejects(T.updateTaskStatus(id, 'done', m2, 'ai'), (e) => e.status === 403);
  await assert.rejects(T.closeTask(id, m1, 'ai'), (e) => e.status === 403);
  await assert.rejects(T.deleteTask(id, m2, 'command'), (e) => e.status === 403);
  assert.equal((await T.updateTaskStatus(id, 'done', m1, 'ai')).status, 'done');
  assert.equal((await T.closeTask(id, boss, 'ai')).status, 'closed');
});
