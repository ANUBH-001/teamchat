// V-01..V-03: voice notes drive the same AI pipeline as typed text; transcription failures are recorded and retryable.
// Only the external Gemini call (transcribe) is stubbed; everything else is real (DB, routes, engine, tasks).
const H = require('./helpers/harness');
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const request = require('supertest');

let app, boss, anubhav, uzair, chat, tokBoss, tokA, tokU, audioUrl, audioFile;
let nextResult = { text: 'noop' };
const transcribeMod = require('../src/ai/transcribe');
const realTranscribe = transcribeMod.transcribe;

before(async () => {
  await H.resetDb();
  app = require('../src/app').createApp();
  boss = await H.createUser({ name: 'Rishit', role: 'boss' });
  anubhav = await H.createUser({ name: 'Anubhav' });
  uzair = await H.createUser({ name: 'Uzair' });
  chat = await H.createChat('group', 'Team', [boss.id, anubhav.id, uzair.id], boss.id);
  [tokBoss, tokA, tokU] = await Promise.all([boss, anubhav, uzair].map(H.tokenFor));
  const dir = path.join(__dirname, '..', 'uploads', 'test-voice');
  fs.mkdirSync(dir, { recursive: true });
  audioFile = path.join(dir, 'v.m4a');
  fs.writeFileSync(audioFile, 'fake-audio');
  audioUrl = '/media/f/test-voice/v.m4a';
  // B-03: a sender may only post media they can see. The fixture file was never uploaded through POST /media, so give the
  // chat one earlier message carrying it: every member can then (re)send it, like a forward.
  await H.pool().query("INSERT INTO messages (chat_id, sender_id, body, type, media_url) VALUES (?, ?, '', 'audio', ?)", [chat, boss.id, audioUrl]);
  transcribeMod.transcribe = async () => nextResult;
});
after(async () => {
  transcribeMod.transcribe = realTranscribe;
  fs.rmSync(path.dirname(audioFile), { recursive: true, force: true });
  await H.teardown();
});

let n = 0;
async function voice(tok, result) {
  nextResult = result;
  const r = await request(app).post('/chats/' + chat + '/messages').set(H.bearer(tok))
    .send({ type: 'audio', mediaUrl: audioUrl, media: { durationMs: 5000 }, clientId: 'v-' + (++n) });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  return r.body.message.id;
}
const mediaOf = async (id) => { const [[r]] = await H.pool().query('SELECT media FROM messages WHERE id = ?', [id]); return JSON.parse(r.media); };
const settled = (id) => H.waitFor(async () => { const m = await mediaOf(id); return m.transcriptStatus !== 'pending' ? m : null; });
const tasksFor = async (msgId) => (await H.pool().query('SELECT * FROM tasks WHERE source_message_id = ?', [msgId]))[0];
const botMsgs = async (afterId, visibleTo) => (await H.pool().query(
  'SELECT * FROM messages WHERE chat_id = ? AND id > ? AND type = ? AND (visible_to IS NULL OR visible_to = ?) ORDER BY id', [chat, afterId, 'bot', visibleTo]))[0];
const someTasks = (id) => H.waitFor(async () => { const t = await tasksFor(id); return t.length ? t : null; });

test('V-03a: boss voice note assigns a task to Anubhav (source = the voice message, card posted)', async () => {
  const id = await voice(tokBoss, { text: 'Anubhav ko team app banani hai, ye task assign kar raha hun' });
  const ts = await someTasks(id);
  assert.equal(ts.length, 1);
  assert.equal(ts[0].assignee_id, anubhav.id);
  assert.equal(Number(ts[0].source_message_id), id);
  assert.equal(ts[0].private, 0);
  const cards = await H.waitFor(async () => { const b = await botMsgs(id, boss.id); return b.length ? b : null; });
  assert.equal(JSON.parse(cards[0].payload).kind, 'task');
  assert.equal((await settled(id)).transcriptStatus, 'done');
});

test('V-03b: member voice assigning someone else: note when off, task when on', async () => {
  await H.setSetting('membersCanAssign', false);
  const id = await voice(tokA, { text: 'Uzair ko login page banana hai' });
  const note = await H.waitFor(async () => { const b = await botMsgs(id, anubhav.id); return b.length ? b : null; });
  assert.equal(note[0].visible_to, anubhav.id);
  assert.match(note[0].body, /admin/i);
  assert.equal((await tasksFor(id)).length, 0);
  await H.setSetting('membersCanAssign', true);
  const id2 = await voice(tokA, { text: 'Uzair ko login page banana hai' });
  const ts = await someTasks(id2);
  assert.equal(ts[0].assignee_id, uzair.id);
  assert.equal(ts[0].created_by, anubhav.id);
});

test('V-03c: member "mujhe kal tak report banani hai" is a self-task even with toggle off', async () => {
  await H.setSetting('membersCanAssign', false);
  const id = await voice(tokA, { text: 'mujhe kal tak report banani hai' });
  const ts = await someTasks(id);
  assert.equal(ts[0].assignee_id, anubhav.id);
  assert.equal(ts[0].private, 0);
});

test('V-02e: failure stores a transcriptError code', async () => {
  const id = await voice(tokA, { error: 'off' });
  const m = await settled(id);
  assert.equal(m.transcriptStatus, 'failed');
  assert.equal(m.transcriptError, 'off');
  const list = await request(app).get('/chats/' + chat + '/messages').set(H.bearer(tokA));
  assert.equal(list.body.messages.find((x) => x.id === id).media.transcriptError, 'off');
});

test('V-02d: retry endpoint permissions, eligibility, and no duplicate tasks', async () => {
  await H.setSetting('membersCanAssign', true);
  const outsider = await H.createUser({ name: 'Out' });
  const tokO = await H.tokenFor(outsider);
  const id = await voice(tokA, { error: 'api' });
  assert.equal((await settled(id)).transcriptError, 'api');
  const url = '/chats/' + chat + '/messages/' + id + '/transcribe';
  assert.equal((await request(app).post(url)).status, 401);
  assert.equal((await request(app).post(url).set(H.bearer(tokO))).status, 403); // not a chat member
  assert.equal((await request(app).post(url).set(H.bearer(tokU))).status, 403); // member, not the sender
  const t = await request(app).post('/chats/' + chat + '/messages').set(H.bearer(tokA)).send({ text: 'plain', clientId: 'p-1' });
  assert.equal((await request(app).post('/chats/' + chat + '/messages/' + t.body.message.id + '/transcribe').set(H.bearer(tokA))).status, 400);
  assert.equal((await request(app).post('/chats/' + chat + '/messages/999999/transcribe').set(H.bearer(tokA))).status, 404);

  nextResult = { text: 'Uzair ko report banani hai' };
  const r = await request(app).post(url).set(H.bearer(tokA));
  assert.equal(r.status, 202);
  await H.waitFor(async () => (await mediaOf(id)).transcriptStatus === 'done');
  const ts = await someTasks(id);
  assert.equal(ts.length, 1);
  assert.equal((await mediaOf(id)).transcriptError, undefined);
  assert.equal((await request(app).post(url).set(H.bearer(tokA))).status, 409);
  assert.equal((await request(app).post(url).set(H.bearer(tokBoss))).status, 409);
  await H.sleep(200);
  assert.equal((await tasksFor(id)).length, 1);
});

test('V-02d: boss may retry; fresh pending is not retryable, stale pending is', async () => {
  const id = await voice(tokA, { error: 'api' });
  await settled(id);
  nextResult = { text: 'kuch nahi bas chat' };
  const url = '/chats/' + chat + '/messages/' + id + '/transcribe';
  assert.equal((await request(app).post(url).set(H.bearer(tokBoss))).status, 202);
  await H.waitFor(async () => (await mediaOf(id)).transcriptStatus === 'done');
  const m = await mediaOf(id);
  await H.pool().query('UPDATE messages SET media = ? WHERE id = ?', [JSON.stringify({ ...m, transcriptStatus: 'pending' }), id]);
  assert.equal((await request(app).post(url).set(H.bearer(tokA))).status, 409);
  await H.pool().query('UPDATE messages SET created_at = NOW() - INTERVAL 5 MINUTE WHERE id = ?', [id]);
  assert.equal((await request(app).post(url).set(H.bearer(tokA))).status, 202);
});

test('V-02: startup requeue picks up stale pending voice notes and transcribes them', async () => {
  const id = await voice(tokA, { error: 'api' });
  await settled(id);
  const m = await mediaOf(id);
  delete m.transcriptError;
  await H.pool().query('UPDATE messages SET media = ?, created_at = NOW() - INTERVAL 10 MINUTE WHERE id = ?', [JSON.stringify({ ...m, transcriptStatus: 'pending' }), id]);
  nextResult = { text: 'bas ek note' };
  const count = await require('../src/routes/chats').requeueVoiceNotes();
  assert.ok(count >= 1);
  await H.waitFor(async () => (await mediaOf(id)).transcriptStatus === 'done');
});
