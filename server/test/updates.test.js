// Regression suite for P0 B-01: path traversal in GET /updates/assets.
// Builds a real temp tree: <tmp>/server-like/{.env, backup/db.json, updates/2/123/...}
// and mounts the real router on that updates root (no mocks).
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const express = require('express');
const request = require('supertest');
const { createUpdatesRouter } = require('../src/routes/updates');

let tmp, app;
const BUNDLE = 'bundle-content';

before(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'upd-'));
  const updates = path.join(tmp, 'updates');
  fs.mkdirSync(path.join(updates, '2', '123', 'assets'), { recursive: true });
  fs.mkdirSync(path.join(updates, '2', '123', '_expo', 'static', 'js', 'android'), { recursive: true });
  fs.writeFileSync(path.join(updates, '2', '123', '_expo', 'static', 'js', 'android', 'index-abc.hbc'), BUNDLE);
  fs.writeFileSync(path.join(updates, '2', '123', 'assets', 'f00dbeef'), 'png-bytes'); // extensionless, like expo export
  fs.writeFileSync(path.join(updates, '2', '123', 'metadata.json'), JSON.stringify({
    fileMetadata: { android: { bundle: '_expo/static/js/android/index-abc.hbc', assets: [{ path: 'assets/f00dbeef', ext: 'png' }] } },
  }));
  fs.writeFileSync(path.join(updates, '2', '123', '.hidden'), 'nope');
  // secrets that must never be reachable
  fs.writeFileSync(path.join(tmp, '.env'), 'JWT_SECRET=leak');
  fs.mkdirSync(path.join(tmp, 'backup'));
  fs.writeFileSync(path.join(tmp, 'backup', 'db.json'), '{"leak":true}');
  app = express();
  app.use('/updates', createUpdatesRouter(updates));
});

after(() => fs.rmSync(tmp, { recursive: true, force: true }));

const get = (rv, asset) => request(app).get('/updates/assets').query({ runtimeVersion: rv, asset, platform: 'android' });
const raw = (qs) => request(app).get('/updates/assets?' + qs);
const leaked = (res) => /leak/.test(res.text || '');

test('valid bundle and extensionless asset are still served', async () => {
  const a = await get('2', '2/123/_expo/static/js/android/index-abc.hbc');
  assert.strictEqual(a.status, 200);
  assert.strictEqual(a.text, BUNDLE);
  const b = await get('2', '2/123/assets/f00dbeef');
  assert.strictEqual(b.status, 200);
});

test('manifest asset URLs resolve through /assets', async () => {
  const m = await request(app).get('/updates/manifest').set('expo-platform', 'android').set('expo-runtime-version', '2')
    .buffer(true).parse((res, cb) => { let d = ''; res.on('data', (c) => { d += c; }); res.on('end', () => cb(null, d)); });
  assert.strictEqual(m.status, 200);
  const url = /"url":"[^"]*?(\/updates\/assets\?[^"]+)"/.exec(m.body)[1];
  const r = await request(app).get(url);
  assert.strictEqual(r.status, 200);
  assert.strictEqual(r.text, BUNDLE);
});

const ATTACKS = [
  ['rv=.. reaches .env (the original exploit)', 'runtimeVersion=..&asset=../.env'],
  ['rv=.. reaches backup', 'runtimeVersion=..&asset=../backup/db.json'],
  ['rv=. with dot-dot asset', 'runtimeVersion=.&asset=../.env'],
  ['percent-encoded dots', 'runtimeVersion=%2e%2e&asset=%2e%2e%2f.env'],
  ['double-encoded dots', 'runtimeVersion=%252e%252e&asset=%252e%252e%252f.env'],
  ['encoded slash', 'runtimeVersion=2&asset=2%2f..%2f..%2f.env'],
  ['dot-dot inside valid prefix', 'runtimeVersion=2&asset=2/123/../../../.env'],
  ['backslashes', 'runtimeVersion=2&asset=2\\123\\..\\..\\..\\.env'],
  ['encoded backslashes', 'runtimeVersion=2&asset=2%5c..%5c..%5c.env'],
  ['absolute path', 'runtimeVersion=2&asset=' + encodeURIComponent(path.resolve('/etc/passwd'))],
  ['absolute windows path', 'runtimeVersion=2&asset=C:%5cWindows%5cwin.ini'],
  ['NUL byte', 'runtimeVersion=2&asset=2/123/assets/f00dbeef%00.png'],
  ['dotfile inside updates', 'runtimeVersion=2&asset=2/123/.hidden'],
  ['asset outside the given rv', 'runtimeVersion=3&asset=2/123/assets/f00dbeef'],
  ['rv folder itself', 'runtimeVersion=2&asset=2'],
  ['array params', 'runtimeVersion=2&asset=2/123/assets/f00dbeef&asset=../.env'],
];

for (const [name, qs] of ATTACKS) {
  test(`rejects: ${name}`, async () => {
    const res = await raw(qs);
    assert.ok(res.status === 400 || res.status === 404, `status ${res.status}`);
    assert.ok(!leaked(res), 'secret content leaked');
  });
}

test('manifest rejects dot runtime versions', async () => {
  for (const rv of ['..', '.', '2/..']) {
    const res = await request(app).get('/updates/manifest').set('expo-platform', 'android').set('expo-runtime-version', rv);
    assert.strictEqual(res.status, 400, rv);
  }
});
