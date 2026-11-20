// "Show 'Admin' label in chats" per admin: UI-only flag in app_settings (adminLabelHiddenIds); permissions never change.
const H = require('./helpers/harness');
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const request = require('supertest');

let app, boss1, boss2, member, chat, tokBoss1, tokBoss2, tokMember;
before(async () => {
  await H.resetDb();
  app = require('../src/app').createApp();
  boss1 = await H.createUser({ name: 'Prashant', role: 'boss' });
  boss2 = await H.createUser({ name: 'Anubhav', role: 'boss' });
  member = await H.createUser({ name: 'Uzair' });
  chat = await H.createChat('group', 'Team', [boss1.id, boss2.id, member.id], boss1.id);
  [tokBoss1, tokBoss2, tokMember] = await Promise.all([boss1, boss2, member].map(H.tokenFor));
});
after(async () => { await H.teardown(); });

const setFlag = (tok, id, show) => request(app).put('/admin/users/' + id + '/admin-label').set(H.bearer(tok)).send({ show });
const usersOf = async (tok) => (await request(app).get('/users?includeSelf=1').set(H.bearer(tok))).body.users;
const membersOf = async (tok) => (await request(app).get('/chats/' + chat).set(H.bearer(tok))).body;

test('default: every admin shows the label, members never', async () => {
  const u = await usersOf(tokMember);
  assert.equal(u.find((x) => x.id === boss1.id).showAdminLabel, true);
  assert.equal(u.find((x) => x.id === boss2.id).showAdminLabel, true);
  assert.equal(u.find((x) => x.id === member.id).showAdminLabel, false);
});

test('only an admin can change it (member -> 403, flag unchanged)', async () => {
  const r = await setFlag(tokMember, boss2.id, false);
  assert.equal(r.status, 403);
  const u = await usersOf(tokMember);
  assert.equal(u.find((x) => x.id === boss2.id).showAdminLabel, true);
});

test('admin hides the label for one admin: payloads flip, role and permissions stay', async () => {
  const r = await setFlag(tokBoss1, boss2.id, false);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.showAdminLabel, false);
  const u = await usersOf(tokMember);
  const b2 = u.find((x) => x.id === boss2.id);
  assert.equal(b2.showAdminLabel, false);
  assert.equal(b2.role, 'boss'); // real role unchanged
  assert.equal(u.find((x) => x.id === boss1.id).showAdminLabel, true);
  const adminList = (await request(app).get('/admin/users').set(H.bearer(tokBoss1))).body.users;
  assert.equal(adminList.find((x) => x.id === boss2.id).showAdminLabel, false);
  // he can still use admin routes
  assert.equal((await request(app).get('/admin/users').set(H.bearer(tokBoss2))).status, 200);
  // login / me payload of the flagged admin carries the flag too
  const me = await request(app).get('/auth/me').set(H.bearer(tokBoss2));
  assert.equal(me.body.user.showAdminLabel, false);
  assert.equal(me.body.user.role, 'boss');
});

test('chat member list carries the flag', async () => {
  const m = await membersOf(tokMember);
  const list = m.members;
  assert.equal(list.find((x) => x.id === boss2.id).showAdminLabel, false);
  assert.equal(list.find((x) => x.id === boss1.id).showAdminLabel, true);
});

test('show again, and bad input is rejected', async () => {
  assert.equal((await setFlag(tokBoss1, boss2.id, true)).status, 200);
  assert.equal((await usersOf(tokMember)).find((x) => x.id === boss2.id).showAdminLabel, true);
  assert.equal((await request(app).put('/admin/users/' + boss2.id + '/admin-label').set(H.bearer(tokBoss1)).send({ show: 'no' })).status, 400);
  assert.equal((await setFlag(tokBoss1, member.id, false)).status, 400); // members have no label to hide
  assert.equal((await setFlag(tokBoss1, 99999, false)).status, 404);
});
