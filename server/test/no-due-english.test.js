// R-07 (no task due date) and R-08 (all user-facing text is English).
const H = require('./helpers/harness');
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const request = require('supertest');
const fs = require('fs');
const path = require('path');

let app, boss, m1, tokBoss, tok1;
before(async () => {
  await H.resetDb();
  app = require('../src/app').createApp();
  boss = await H.createUser({ name: 'Rishit', role: 'boss' });
  m1 = await H.createUser({ name: 'Anubhav' });
  [tokBoss, tok1] = await Promise.all([boss, m1].map(H.tokenFor));
});
after(async () => { await H.teardown(); });

test('R-07: create ignores dueDate (even an invalid one); the task has no due fields', async () => {
  for (const dueDate of ['2030-01-05', 'garbage', '2030-01-05 17:30']) {
    const r = await request(app).post('/tasks').set(H.bearer(tokBoss)).send({ title: 'No due', assigneeIds: [m1.id], dueDate });
    assert.equal(r.status, 201, JSON.stringify(r.body));
    for (const k of ['dueDate', 'dueAt', 'hasTime', 'overdue']) assert.ok(!(k in r.body.task), k);
    const [[row]] = await H.pool().query('SELECT due_at FROM tasks WHERE id = ?', [r.body.task.id]);
    assert.equal(row.due_at, null);
  }
});

test('R-07: PATCH with only dueDate (old app) is a harmless no-op, not an error; with other fields they still apply', async () => {
  const c = await request(app).post('/tasks').set(H.bearer(tokBoss)).send({ title: 'Old app', assigneeIds: [m1.id] });
  const id = c.body.task.id;
  const only = await request(app).patch('/tasks/' + id).set(H.bearer(tokBoss)).send({ dueDate: '2030-02-02' });
  assert.equal(only.status, 200, JSON.stringify(only.body));
  const both = await request(app).patch('/tasks/' + id).set(H.bearer(tokBoss)).send({ dueDate: '2030-02-02', title: 'Renamed' });
  assert.equal(both.status, 200);
  assert.equal(both.body.task.title, 'Renamed');
  const [[row]] = await H.pool().query('SELECT due_at FROM tasks WHERE id = ?', [id]);
  assert.equal(row.due_at, null);
  const other = await request(app).patch('/tasks/' + id).set(H.bearer(tok1)).send({ dueDate: '2030-02-02' });
  assert.equal(other.status, 200); // assignee may view; still a no-op
  const none = await request(app).patch('/tasks/' + id).set(H.bearer(tokBoss)).send({});
  assert.equal(none.status, 400);
});

test('R-07: list / summary responses carry no due data', async () => {
  const l = await request(app).get('/tasks').set(H.bearer(tokBoss));
  for (const t of l.body.tasks) assert.ok(!('dueDate' in t) && !('overdue' in t));
  const s = await request(app).get('/tasks/mine/summary').set(H.bearer(tok1));
  assert.equal(s.status, 200);
  for (const k of Object.keys(s.body)) for (const t of s.body[k]) assert.ok(!('dueDate' in t));
});

test('R-08: no Hindi/Hinglish user-facing phrases left in server code', () => {
  const banned = /(\bnahi (hai|mila|hua|bana)|dobara try|kisko|likhiye|pehle se|\bkarein\b|ho paya|chuniye|\bjawab\b|\bpooch|\bbaaki\b|Aaj diye|din se pending|galat hai)/i;
  const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]));
  const bad = [];
  for (const f of walk(path.join(__dirname, '..', 'src')).filter((x) => x.endsWith('.js'))) {
    fs.readFileSync(f, 'utf8').split('\n').forEach((line, i) => {
      if (f.endsWith('names.js') || /you must understand|FILLER = /.test(line)) return; // Hindi name aliases / input vocabulary (understanding, not output)
      if (f.endsWith('names.js') || /you must understand|FILLER = |^  'wo', 'woh'/.test(line)) return; // Hindi name aliases / input vocabulary (understanding, not output)
      if (/^\s*\/\//.test(line) || /\/.*\|.*\//.test(line)) return; // comments and input-matching regexes are fine
      if (banned.test(line) || /[ऀ-ॿ]/.test(line.replace(/\/[^/]*[ऀ-ॿ][^/]*\/[a-z]*/g, ''))) bad.push(path.basename(f) + ':' + (i + 1));
    });
  }
  assert.deepEqual(bad, []);
});

test('R-08: AI prompts ask for English output and no due date', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'ai', 'provider.js'), 'utf8');
  assert.match(src, /ENGLISH/);
  assert.doesNotMatch(src, /due_date/);
});
