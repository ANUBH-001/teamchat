// Self-hosted Expo Updates (protocol v1, no code signing). Port of expo/custom-expo-updates-server.
// Files: server/updates/<runtimeVersion>/<timestamp>/ = `expo export` output + expoConfig.json. Newest folder wins.
const express = require('express');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..', 'updates'); // constant: never built from request input
// Segments must start with a letter/digit/_/-: this rejects ".", "..", and dotfiles (.env, .env.bak-*).
const SEG = '[A-Za-z0-9_-][A-Za-z0-9._-]*';
const RV_RE = new RegExp(`^${SEG}$`);
const ASSET_RE = new RegExp(`^${SEG}(/${SEG})*$`); // forward slashes only: no "\", ":", NUL, "%"

// Returns the absolute file for a validated asset request, or null. B-01 (P0) regression guard.
function safeAssetPath(root, rv, asset) {
  if (typeof rv !== 'string' || typeof asset !== 'string') return null; // ?asset=a&asset=b gives an array
  if (!RV_RE.test(rv) || !ASSET_RE.test(asset)) return null;
  const parts = asset.split('/');
  // manifest only hands out <rv>/<timestamp>/<path>
  if (parts.length < 3 || parts[0] !== rv || !/^\d+$/.test(parts[1])) return null;
  const rvDir = path.resolve(root, rv);
  const file = path.resolve(root, asset);
  for (const [base, target] of [[root, rvDir], [rvDir, file]]) {
    const rel = path.relative(path.resolve(base), target);
    if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) return null;
  }
  // symlinks: the real file must still be inside the real updates root
  let real;
  try { real = fs.realpathSync(file); } catch { return null; }
  const relReal = path.relative(fs.realpathSync(root), real);
  if (!relReal || relReal.startsWith('..') || path.isAbsolute(relReal)) return null;
  return real;
}
const TYPES = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', svg: 'image/svg+xml',
  ttf: 'font/ttf', otf: 'font/otf', json: 'application/json', js: 'application/javascript', hbc: 'application/javascript',
  mp3: 'audio/mpeg', mp4: 'video/mp4', wav: 'audio/wav', txt: 'text/plain',
};
const typeOf = (ext) => TYPES[String(ext).toLowerCase().replace(/^\./, '')] || 'application/octet-stream';
const hashOf = (buf, algo, enc) => crypto.createHash(algo).update(buf).digest(enc);
const readJson = (file) => JSON.parse(fs.readFileSync(file, 'utf8').replace(/^﻿/, ''));

function latestDir(root, rv) {
  const base = path.join(root, rv);
  if (!fs.existsSync(base)) return null;
  // only <timestamp> folders (digits): a half-copied or renamed folder is never served
  const names = fs.readdirSync(base).filter((n) => /^\d+$/.test(n) && fs.statSync(path.join(base, n)).isDirectory());
  if (!names.length) return null;
  names.sort((a, b) => (a.length - b.length) || (a < b ? -1 : a > b ? 1 : 0)); // numeric-ish: longer/larger last
  return path.join(base, names[names.length - 1]);
}

function baseUrl(req) {
  return (process.env.PUBLIC_BASE_URL || `${req.protocol}://${req.get('host')}`).replace(/\/+$/, '');
}

function part(boundary, name, json) {
  return `--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\nContent-Type: application/json; charset=utf-8\r\n\r\n${JSON.stringify(json)}\r\n`;
}

function createUpdatesRouter(root = ROOT) {
const router = express.Router();

router.get('/manifest', (req, res) => {
  const platform = req.get('expo-platform') || req.query.platform;
  const rv = req.get('expo-runtime-version') || req.query['runtime-version'];
  if (platform !== 'android') return res.status(400).json({ error: 'platform must be android' });
  if (!rv || !RV_RE.test(rv)) return res.status(400).json({ error: 'invalid runtime version' });
  try {
    const dir = latestDir(root, rv);
    if (!dir) {
      // nothing published for this runtime: tell the app "no update" (not an error), it keeps its current code
      if (req.get('expo-protocol-version') !== '1') return res.status(404).json({ error: 'no update for this runtime' });
      res.set({ 'expo-protocol-version': '1', 'expo-sfv-version': '0', 'cache-control': 'private, max-age=0' });
      const b = crypto.randomBytes(16).toString('hex');
      res.setHeader('content-type', `multipart/mixed; boundary=${b}`);
      return res.end(Buffer.from(part(b, 'directive', { type: 'noUpdateAvailable' }) + `--${b}--\r\n`, 'utf8'));
    }
    const metaRaw = fs.readFileSync(path.join(dir, 'metadata.json'));
    const meta = JSON.parse(metaRaw.toString('utf8').replace(/^﻿/, ''));
    const h = hashOf(metaRaw, 'sha256', 'hex');
    const id = `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}`;
    const fm = meta.fileMetadata && meta.fileMetadata.android;
    if (!fm || !fm.bundle) return res.status(404).json({ error: 'android bundle not found' });
    const rel = path.relative(root, dir).split(path.sep).join('/'); // <rv>/<timestamp>
    const base = baseUrl(req);
    const mk = (rawPath, ext) => {
      const relPath = String(rawPath).replace(/\\/g, '/'); // export on Windows writes "assets\\<hash>"
      const buf = fs.readFileSync(path.join(dir, relPath));
      return {
        hash: hashOf(buf, 'sha256', 'base64url'),
        key: hashOf(buf, 'md5', 'hex'),
        fileExtension: ext,
        contentType: typeOf(ext),
        url: `${base}/updates/assets?asset=${encodeURIComponent(rel + '/' + relPath)}&runtimeVersion=${encodeURIComponent(rv)}&platform=android`,
      };
    };
    const launchAsset = mk(fm.bundle, '.hbc');
    launchAsset.contentType = 'application/javascript';
    const assets = (fm.assets || []).map((a) => mk(a.path, a.ext ? '.' + a.ext : ''));
    let expoClient = {};
    const cfg = path.join(dir, 'expoConfig.json');
    if (fs.existsSync(cfg)) expoClient = readJson(cfg);
    const manifest = {
      id, createdAt: fs.statSync(dir).mtime.toISOString(), runtimeVersion: rv,
      launchAsset, assets, metadata: {}, extra: { expoClient },
    };
    res.set({ 'expo-protocol-version': '1', 'expo-sfv-version': '0', 'cache-control': 'private, max-age=0' });
    const boundary = crypto.randomBytes(16).toString('hex');
    let body;
    if (req.get('expo-current-update-id') === id && req.get('expo-protocol-version') === '1') {
      body = part(boundary, 'directive', { type: 'noUpdateAvailable' });
    } else {
      body = part(boundary, 'manifest', manifest) + part(boundary, 'extensions', { assetRequestHeaders: {} });
    }
    // raw end (not res.send): send() would append "; charset=utf-8" to the multipart Content-Type
    res.setHeader('content-type', `multipart/mixed; boundary=${boundary}`);
    res.end(Buffer.from(body + `--${boundary}--\r\n`, 'utf8'));
  } catch (e) {
    console.error('updates manifest', e.message);
    res.status(500).json({ error: 'could not build the update manifest' });
  }
});

router.get('/assets', (req, res) => {
  const file = safeAssetPath(root, req.query.runtimeVersion, req.query.asset);
  if (!file) return res.status(400).json({ error: 'invalid request' });
  if (!fs.statSync(file).isFile()) return res.status(404).json({ error: 'file not found' });
  res.set({ 'content-type': typeOf(path.extname(file)), 'cache-control': 'public, max-age=31536000, immutable' });
  fs.createReadStream(file).pipe(res);
});

return router;
}

module.exports = createUpdatesRouter();
module.exports.createUpdatesRouter = createUpdatesRouter;
