// C-01..C-06: daily check-in upgrade (morning "Today" picks, evening tick through the normal task API, admins' summary card,
// scheduler idempotency + slot windows, AI self-task from the check-in chat).
const H = require('./helpers/harness');
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const request = require('supertest');

let app, srv, C, pool, boss, m1, m2, gone, tokBoss, tok1, tok2;
const today = () => C.localNow().date;
// an instant at hh:mm local (Asia/Kolkata, +05:30) on the local date `d`
const at = (d, hhmm) => new Date(d + 'T' + hhmm + ':00+05:30');
const prompts = async (userId, kind, date = today()) =>
  (await pool.query('SELECT * FROM checkin_prompts WHERE user_id = ? AND date = ? AND kind = ?', [userId, date, kind]))[0];
const cards = async (userId, kind) => (await pool.query(
  "SELECT m.id, m.payload FROM messages m JOIN chats c ON c.id = m.chat_id WHERE c.type = 'checkin' AND c.owner_id = ? AND m.type = 'checkin_prompt'",
  [userId]))[0].map((r) => ({ id: r.id, payload: JSON.parse(r.payload) })).filter((r) => !kind || r.payload.kind === kind);
const mkTask = async (title, assignee) => {
  const r = await request(app).post('/tasks').set(H.bearer(tokBoss)).send({ title, assigneeIds: [assignee.id] });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  return r.body.task.id;
};

before(async () => {
  await H.resetDb();
  srv = await H.startServer();
  app = require('../src/app').createApp();
  C = require('../src/checkins');
  pool = H.pool();
  boss = await H.createUser({ name: 'Rishit', role: 'boss' });
  m1 = await H.createUser({ name: 'Anubhav' });
  m2 = await H.createUser({ name: 'Tushar' });
  gone = await H.createUser({ name: 'Former' });
  await pool.query('UPDATE users SET active = 0 WHERE id = ?', [gone.id]);
  [tokBoss, tok1, tok2] = await Promise.all([boss, m1, m2].map(H.tokenFor));
  await C.updateSettings({ days: [0, 1, 2, 3, 4, 5, 6], morningTime: '10:00', eveningTime: '18:00', summaryTime: '20:30', nudgeMinutes: 0 });
});
after(async () => { await srv.close(); await H.teardown(); });

test('timezone: local date / minutes are Asia/Kolkata, the day flips at 18:30 UTC', () => {
  assert.deepEqual([C.localNow(new Date('2026-11-20T18:29:00Z')).date, C.localNow(new Date('2026-11-20T18:29:00Z')).minutes], ['2026-11-20', 23 * 60 + 59]);
  assert.deepEqual([C.localNow(new Date('2026-11-20T18:30:00Z')).date, C.localNow(new Date('2026-11-20T18:30:00Z')).minutes], ['2026-11-21', 0]);
  assert.equal(C.localNow(new Date('2026-11-20T04:30:00Z')).minutes, 10 * 60);
});

test('scheduler: nothing before 10:00 local; at 10:00 one morning card per active member, none for the bot / inactive / admin', async () => {
  const t1 = await mkTask('Write report', m1);
  const t2 = await mkTask('Fix login', m2);
  const other = await mkTask('Not yours', m2);
  await C.tick(at(today(), '09:59'));
  assert.equal((await prompts(m1.id, 'day')).length, 0);
  await C.tick(at(today(), '10:00'));
  await C.tick(at(today(), '10:01')); // a second tick (or a restart) never double-sends
  await C.tick(at(today(), '10:01'));
  const c1 = await cards(m1.id, 'day');
  assert.equal(c1.length, 1);
  assert.equal((await cards(m2.id, 'day')).length, 1);
  assert.equal((await prompts(gone.id, 'day')).length, 0);
  assert.equal((await prompts(boss.id, 'day')).length, 0);
  // payload: only the member's own open tasks, with picks
  const p = c1[0].payload;
  assert.deepEqual(p.tasks.map((t) => t.id), [t1]);
  assert.ok(!p.tasks.some((t) => t.id === t2 || t.id === other));
  assert.deepEqual(p.picks, []);
  assert.equal(p.tasks[0].status, 'todo');
  assert.ok(!('dueDate' in p.tasks[0]));
});

test('scheduler: a missed morning is not caught up in the evening; the evening card is sent once', async () => {
  const late = await H.createUser({ name: 'Latecomer' });
  await C.tick(at(today(), '19:00'));
  await C.tick(at(today(), '19:05'));
  assert.equal((await prompts(late.id, 'day')).length, 0, 'no "good morning" at 19:00');
  assert.equal((await cards(late.id, 'signoff')).length, 1);
  assert.equal((await cards(m1.id, 'signoff')).length, 1);
  await pool.query('UPDATE users SET active = 0 WHERE id = ?', [late.id]);
});

test('picks: own open task only; toggling updates the morning card and is stored for the admin', async () => {
  const mine = (await cards(m1.id, 'day'))[0].payload.tasks[0].id;
  const notMine = (await cards(m2.id, 'day'))[0].payload.tasks[0].id;
  const ws = H.wsClient(srv.url, tok1);
  await ws.hello();
  let r = await request(app).post('/checkins/picks').set(H.bearer(tok1)).send({ taskId: notMine, today: true });
  assert.equal(r.status, 400); // forged id: someone else's task
  r = await request(app).post('/checkins/picks').set(H.bearer(tokBoss)).send({ taskId: mine, today: true });
  assert.equal(r.status, 403);
  r = await request(app).post('/checkins/picks').set(H.bearer(tok1)).send({ taskId: mine });
  assert.equal(r.status, 400);
  r = await request(app).post('/checkins/picks').set(H.bearer(tok1)).send({ taskId: mine, today: true });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.deepEqual(r.body.picks, [mine]);
  const ed = await ws.waitFor((e) => e.type === 'edited' && e.message.payload && e.message.payload.kind === 'day' && e.message.payload.picks.includes(mine));
  assert.ok(ed);
  assert.deepEqual((await cards(m1.id, 'day'))[0].payload.picks, [mine]);
  const rep = await request(app).get('/admin/checkins').set(H.bearer(tokBoss));
  const row = rep.body.members.find((x) => x.id === m1.id);
  assert.deepEqual(row.morning.checkin.selectedTaskIds, [mine]);
  // un-pick
  r = await request(app).post('/checkins/picks').set(H.bearer(tok1)).send({ taskId: mine, today: false });
  assert.deepEqual(r.body.picks, []);
  r = await request(app).post('/checkins/picks').set(H.bearer(tok1)).send({ taskId: mine, today: true });
  assert.deepEqual(r.body.picks, [mine]);
  ws.close();
});

test('evening tick through PATCH /tasks: own task done, the card and the admin see it; a forged id is refused', async () => {
  const card = (await cards(m1.id, 'signoff'))[0].payload;
  const id = card.tasks[0].id;
  const notMine = (await cards(m2.id, 'signoff'))[0].payload.tasks[0].id;
  const wsBoss = H.wsClient(srv.url, tokBoss);
  const ws1 = H.wsClient(srv.url, tok1);
  await Promise.all([wsBoss.hello(), ws1.hello()]);
  // forged payload: m1 ticks m2's task through the same API -> 403, unchanged
  let r = await request(app).patch('/tasks/' + notMine).set(H.bearer(tok1)).send({ status: 'done', userId: m1.id });
  assert.ok([400, 403].includes(r.status), String(r.status)); // not an assignee of that task
  r = await request(app).patch('/tasks/' + notMine).set(H.bearer(tok1)).send({ status: 'done' });
  assert.equal(r.status, 403);
  assert.equal((await pool.query('SELECT status FROM tasks WHERE id = ?', [notMine]))[0][0].status, 'todo');
  r = await request(app).patch('/tasks/' + id).set(H.bearer(tok1)).send({ status: 'done', userId: m1.id });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const ev = await wsBoss.waitFor((e) => e.type === 'task' && e.task && e.task.id === id && e.task.status === 'done');
  assert.equal(ev.notifyAdmin, true); // the normal "member completed a task" alert, not the quiet check-in path
  const ed = await ws1.waitFor((e) => e.type === 'edited' && e.message.payload && e.message.payload.kind === 'signoff' &&
    e.message.payload.tasks.some((t) => t.id === id && t.status === 'done'), 4000);
  assert.ok(ed);
  wsBoss.close(); ws1.close();
});

test('replies in the check-in chat are stored as the report; the admins get one live summary card', async () => {
  const chat = (await pool.query("SELECT id FROM chats WHERE type = 'checkin' AND owner_id = ?", [m1.id]))[0][0].id;
  const r = await request(app).post('/chats/' + chat + '/messages').set(H.bearer(tok1)).send({ text: 'Finished the report, login fix tomorrow', clientId: 'rep-1' });
  assert.equal(r.status, 201);
  const kind = C.localNow().minutes >= 18 * 60 ? 'evening' : 'morning';
  await H.waitFor(async () => (await pool.query('SELECT text FROM checkins WHERE user_id = ? AND date = ? AND kind = ?', [m1.id, today(), kind]))[0][0]);

  await C.tick(at(today(), '20:29'));
  assert.equal((await prompts(boss.id, 'summary')).length, 0);
  await C.tick(at(today(), '20:30'));
  await C.tick(at(today(), '20:31'));
  const sum = await cards(boss.id, 'summary');
  assert.equal(sum.length, 1, 'one summary per admin per day');
  const p = sum[0].payload;
  const a = p.members.find((x) => x.id === m1.id);
  const t = p.members.find((x) => x.id === m2.id);
  assert.equal(a.replied, true);
  assert.match(a[kind === 'evening' ? 'report' : 'morning'], /Finished the report/);
  assert.equal(a.done.length, 1);
  assert.equal(a.picks.length, 1);
  assert.equal(t.replied, false);
  assert.ok(!p.members.some((x) => x.id === gone.id || x.id === boss.id));
  assert.deepEqual(p.totals, { members: p.members.length, replied: 1, done: 1, picked: 1 });
  // the admin's chat is private: only the admin and the bot are members
  const bchat = (await pool.query("SELECT id FROM chats WHERE type = 'checkin' AND owner_id = ?", [boss.id]))[0][0].id;
  const mem = (await pool.query('SELECT user_id FROM chat_members WHERE chat_id = ?', [bchat]))[0].map((x) => x.user_id);
  assert.equal(mem.length, 2);
  assert.ok(mem.includes(boss.id));
  // a member cannot read it
  assert.equal((await request(app).get('/chats/' + bchat + '/messages').set(H.bearer(tok2))).status, 403);
  // live: m2 replies -> summary payload rewritten
  const chat2 = (await pool.query("SELECT id FROM chats WHERE type = 'checkin' AND owner_id = ?", [m2.id]))[0][0].id;
  await request(app).post('/chats/' + chat2 + '/messages').set(H.bearer(tok2)).send({ text: 'Working on the login fix', clientId: 'rep-2' });
  await H.waitFor(async () => (await cards(boss.id, 'summary'))[0].payload.totals.replied === 2, 6000);
});

test('admin-only POST /admin/jobs/run {summary}', async () => {
  assert.equal((await request(app).post('/admin/jobs/run').set(H.bearer(tok1)).send({ job: 'summary' })).status, 403);
  const r = await request(app).post('/admin/jobs/run').set(H.bearer(tokBoss)).send({ job: 'summary' });
  assert.equal(r.status, 200);
  assert.equal(r.body.result.posted, 0); // already sent today
  assert.equal(r.body.result.refreshed, 1);
});

test('settings: summaryTime must be after the evening time', async () => {
  let r = await request(app).put('/admin/checkins/settings').set(H.bearer(tokBoss)).send({ summaryTime: '17:00' });
  assert.equal(r.status, 400);
  r = await request(app).put('/admin/checkins/settings').set(H.bearer(tokBoss)).send({ summaryTime: '21:00' });
  assert.equal(r.status, 200);
  assert.equal(r.body.settings.summaryTime, '21:00');
  await C.updateSettings({ summaryTime: '20:30' });
});

test('AI: "I\'ll also do X" in my own check-in chat becomes MY task; the bot never answers itself', async () => {
  const provider = require('../src/ai/provider');
  const orig = provider.decide;
  // the model gave no assignee name (common for "I'll ..."): the check-in chat owner is the assignee
  provider.decide = async () => ({ action: 'create_task', tasks: [{ title: 'Update the docs', assignee_name: null }], confidence: 0.9 });
  try {
    const chat = (await pool.query("SELECT id FROM chats WHERE type = 'checkin' AND owner_id = ?", [m2.id]))[0][0].id;
    const before = (await pool.query('SELECT COUNT(*) n FROM messages WHERE chat_id = ?', [chat]))[0][0].n;
    await request(app).post('/chats/' + chat + '/messages').set(H.bearer(tok2)).send({ text: "I'll also update the docs today", clientId: 'ai-1' });
    const task = await H.waitFor(async () => (await pool.query(
      "SELECT t.id, ta.user_id FROM tasks t JOIN task_assignees ta ON ta.task_id = t.id WHERE t.title = 'Update the docs'"))[0][0]);
    assert.equal(task.user_id, m2.id);
    await H.sleep(500);
    const after = (await pool.query('SELECT COUNT(*) n FROM messages WHERE chat_id = ?', [chat]))[0][0].n;
    assert.equal(after - before, 2, 'the member message + one bot task card, nothing more (no loop)');
  } finally { provider.decide = orig; }
});

test('AI: a bare answer to "Anything new?" in the check-in chat reaches the model; the same text in a DM does not', async () => {
  const provider = require('../src/ai/provider');
  const orig = provider.decide;
  const seen = [];
  provider.decide = async (input) => { seen.push(JSON.stringify(input)); return { action: 'create_task', tasks: [{ title: 'Prepare the release notes', assignee_name: null }], confidence: 0.9 }; };
  try {
    const chat = (await pool.query("SELECT id FROM chats WHERE type = 'checkin' AND owner_id = ?", [m2.id]))[0][0].id;
    await request(app).post('/chats/' + chat + '/messages').set(H.bearer(tok2)).send({ text: 'Also prepare the release notes', clientId: 'ai-bare-1' });
    const task = await H.waitFor(async () => (await pool.query(
      "SELECT t.id, ta.user_id FROM tasks t JOIN task_assignees ta ON ta.task_id = t.id WHERE t.title = 'Prepare the release notes'"))[0][0]);
    assert.equal(task.user_id, m2.id);
    // small talk outside the check-in chat is still filtered before any model call
    const n = seen.length;
    const dm = await request(app).post('/chats/dm').set(H.bearer(tok2)).send({ userId: boss.id });
    const dmId = dm.body.chat ? dm.body.chat.id : dm.body.chatId || dm.body.id;
    assert.ok(dmId, 'dm created: ' + JSON.stringify(dm.body));
    const r = await request(app).post('/chats/' + dmId + '/messages').set(H.bearer(tok2)).send({ text: 'Also prepare the release notes', clientId: 'ai-bare-2' });
    assert.equal(r.status, 201);
    await H.sleep(700);
    assert.equal(seen.length, n, 'no model call for a DM message without an intent word');
  } finally { provider.decide = orig; }
});
