// Round 4 media: POST /media (upload), GET /media/f/<yyyy>/<mm>/<file> (protected stream), GET /media/staticmap (map thumbnail).
// Files live in server/uploads/yyyy/mm/<uuid>.<ext> (git-ignored). Files are deleted with their messages by the weekly purge (jobs.js).
// A-07 / B-02: the app gets short-lived signed URLs from POST /media/sign (see ../mediaAuth.js) instead of putting its JWT in
// the URL. GET also accepts the Authorization header, and (transition only, MEDIA_ALLOW_TOKEN_QUERY) the old ?t=<jwt>.
// B-03: every way in is access-checked (signing checks before signing; header / ?t= check on each GET).
const express = require('express');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const multer = require('multer');
const { requireAuth } = require('../middleware/auth');
const mediaAuth = require('../mediaAuth');

const router = express.Router();
const ROOT = path.resolve(__dirname, '..', '..', 'uploads');
const URL_PREFIX = '/media/f/';
const IMAGE_MAX = 10 * 1024 * 1024;
const AUDIO_MAX = 15 * 1024 * 1024;
const IMAGE_TYPES = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };
const AUDIO_TYPES = {
  'audio/mp4': 'm4a', 'audio/m4a': 'm4a', 'audio/x-m4a': 'm4a', 'audio/aac': 'aac', 'audio/mpeg': 'mp3', 'audio/mp3': 'mp3',
  'audio/ogg': 'ogg', 'audio/webm': 'webm',
};
const EXT_TYPE = { jpg: 'image/jpeg', png: 'image/png', webp: 'image/webp', m4a: 'audio/mp4', aac: 'audio/aac', mp3: 'audio/mpeg', ogg: 'audio/ogg', webm: 'audio/webm' };

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: AUDIO_MAX, files: 1, fields: 5 } });

// GET auth: a signed URL (?u=&e=&s=) -> req.signed = {uid}; else the Authorization header; else the legacy ?t=<jwt> while
// MEDIA_ALLOW_TOKEN_QUERY is on (apps before the signed-URL release; remove once they are all updated). resource(req) is
// what the signature must cover.
const mediaGate = (resource) => (req, res, next) => {
  if (req.query.s !== undefined || req.query.u !== undefined || req.query.e !== undefined) {
    const v = mediaAuth.verify(resource(req), req.query);
    if (!v.ok) return res.status(403).json({ error: v.code === 'EXPIRED' ? 'Link expire ho gaya' : 'Galat link', code: v.code });
    req.signed = { uid: v.uid };
    return next();
  }
  if (!req.headers.authorization && typeof req.query.t === 'string' && req.query.t && mediaAuth.allowTokenQuery()) {
    req.headers.authorization = 'Bearer ' + req.query.t;
  }
  return requireAuth(req, res, next);
};
const fileResource = (req) => URL_PREFIX + String(req.params[0] || '');

// '/media/f/2026/11/abc.jpg' -> absolute path inside ROOT, or null (traversal / bad shape).
function resolvePath(url) {
  const s = String(url || '');
  if (!s.startsWith(URL_PREFIX) || s.includes('\0')) return null;
  const rel = s.slice(URL_PREFIX.length);
  const file = path.resolve(ROOT, rel);
  return file.startsWith(ROOT + path.sep) ? file : null; // no path traversal
}

// Delete the file of a purged message (never throws).
function removeFile(url) {
  try {
    const file = resolvePath(url);
    if (file && fs.existsSync(file)) fs.unlinkSync(file);
  } catch (e) { console.error('media remove:', e.message); }
}

router.post('/', requireAuth, (req, res) => {
  upload.single('file')(req, res, async (err) => {
    if (err) {
      const big = err.code === 'LIMIT_FILE_SIZE';
      return res.status(big ? 413 : 400).json({ error: big ? 'File bahut badi hai' : 'Upload nahi hua', code: big ? 'TOO_LARGE' : 'BAD_REQUEST' });
    }
    try {
      const f = req.file;
      if (!f) return res.status(400).json({ error: 'file is required', code: 'BAD_REQUEST' });
      const mime = String(f.mimetype || '').toLowerCase().split(';')[0].trim();
      let kind = String((req.body && req.body.kind) || '').toLowerCase();
      if (kind !== 'image' && kind !== 'audio') kind = IMAGE_TYPES[mime] ? 'image' : 'audio';
      const ext = kind === 'image' ? IMAGE_TYPES[mime] : AUDIO_TYPES[mime];
      const max = kind === 'image' ? IMAGE_MAX : AUDIO_MAX;
      if (!ext) return res.status(415).json({ error: 'File type allowed nahi hai', code: 'BAD_TYPE' });
      if (f.size > max) return res.status(413).json({ error: 'File bahut badi hai', code: 'TOO_LARGE' });
      const now = new Date();
      const sub = now.getFullYear() + '/' + String(now.getMonth() + 1).padStart(2, '0');
      const name = crypto.randomUUID() + '.' + ext;
      fs.mkdirSync(path.join(ROOT, sub), { recursive: true });
      fs.writeFileSync(path.join(ROOT, sub, name), f.buffer);
      const url = URL_PREFIX + sub + '/' + name;
      await mediaAuth.recordUpload(url, req.user.id); // B-03: the uploader may see it before it is sent
      res.status(201).json({ url, kind, size: f.size });
    } catch (e) {
      console.error('media upload:', e.message);
      res.status(500).json({ error: 'Server error' });
    }
  });
});

// POST /media/sign {paths: [...]} (max 100) -> {urls: {path: signedUrl | null}, expiresAt: ms}. null = no such file / not
// allowed / bad path (one answer for all three, so it does not reveal which files exist). Paths: '/media/f/...' files, or
// '/media/staticmap?lat=&lng=&z=' (any logged-in user).
router.post('/sign', requireAuth, async (req, res) => {
  try {
    const paths = req.body && req.body.paths;
    if (!Array.isArray(paths) || paths.length > mediaAuth.MAX_PATHS) {
      return res.status(400).json({ error: 'paths must be an array of at most ' + mediaAuth.MAX_PATHS, code: 'BAD_REQUEST' });
    }
    const files = paths.filter((p) => mediaAuth.validPath(p) && resolvePath(p));
    const allowed = await mediaAuth.accessible(req.user, files);
    const urls = {};
    let exp = 0;
    for (const p of paths) {
      if (typeof p !== 'string') continue;
      let resource = null;
      if (allowed.has(p) && fs.existsSync(resolvePath(p))) resource = p;
      else if (p.startsWith('/media/staticmap?') && p.length <= 255) {
        const q = Object.fromEntries(new URLSearchParams(p.slice(p.indexOf('?') + 1)));
        if (q.lat && q.lng && !q.u && !q.e && !q.s) resource = mediaAuth.mapResource(q);
      }
      if (!resource) { urls[p] = null; continue; }
      const sig = mediaAuth.sign(resource, req.user.id);
      exp = sig.exp;
      urls[p] = p + (p.includes('?') ? '&' : '?') + sig.qs;
    }
    res.json({ urls, expiresAt: (exp || Math.floor(Date.now() / 1000) + mediaAuth.ttlSec()) * 1000 });
  } catch (e) {
    console.error('media sign:', e.message);
    res.status(500).json({ error: 'Server error' });
  }
});

router.get('/f/*', mediaGate(fileResource), async (req, res) => {
  const rel = fileResource(req);
  const file = resolvePath(rel);
  if (!file) return res.status(400).json({ error: 'galat path' });
  // B-03: header / ?t= requests are checked per file (a signed URL was checked when it was signed)
  if (!req.signed) {
    try {
      if (!(await mediaAuth.canAccess(req.user, rel))) return res.status(403).json({ error: 'Not allowed', code: 'NOT_ALLOWED' });
    } catch (e) { return res.status(500).json({ error: 'Server error' }); }
  }
  let st;
  try { st = fs.statSync(file); } catch (e) { return res.status(404).json({ error: 'file nahi mili' }); }
  if (!st.isFile()) return res.status(404).json({ error: 'file nahi mili' });
  // sendFile = Range (audio seek) + ETag; private cache only
  res.sendFile(file, {
    headers: { 'Content-Type': EXT_TYPE[path.extname(file).slice(1).toLowerCase()] || 'application/octet-stream', 'Cache-Control': 'private, max-age=86400' },
  }, (e) => { if (e && !res.headersSent) res.status(e.status || 500).end(); });
});

// ---------- map thumbnail (key stays on the server) ----------
const mapCache = new Map(); // 'lat,lng,z' (rounded) -> {type, buf}
const MAP_CACHE_MAX = 300;
const remember = (k, v) => {
  if (mapCache.size >= MAP_CACHE_MAX) mapCache.delete(mapCache.keys().next().value);
  mapCache.set(k, v);
};

async function fetchBuf(url, headers) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 8000);
  try {
    const r = await fetch(url, { headers, signal: ctrl.signal });
    if (!r.ok) return null;
    return { type: r.headers.get('content-type') || 'image/png', buf: Buffer.from(await r.arrayBuffer()) };
  } catch (e) {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function osmTile(lat, lng, z) {
  const n = 2 ** z;
  const x = Math.floor(((lng + 180) / 360) * n);
  const rad = (lat * Math.PI) / 180;
  const y = Math.floor(((1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2) * n);
  return { x: Math.min(Math.max(x, 0), n - 1), y: Math.min(Math.max(y, 0), n - 1) };
}

router.get('/staticmap', mediaGate((req) => mediaAuth.mapResource(req.query)), async (req, res) => {
  const lat = parseFloat(req.query.lat);
  const lng = parseFloat(req.query.lng);
  let z = parseInt(req.query.z, 10);
  if (!isFinite(lat) || !isFinite(lng) || Math.abs(lat) > 85 || Math.abs(lng) > 180) return res.status(400).json({ error: 'lat/lng galat hai' });
  if (!(z >= 3 && z <= 19)) z = 16;
  const key = lat.toFixed(4) + ',' + lng.toFixed(4) + ',' + z;
  let hit = mapCache.get(key);
  if (!hit) {
    const apiKey = process.env.GOOGLE_MAPS_API_KEY;
    if (apiKey) {
      hit = await fetchBuf('https://maps.googleapis.com/maps/api/staticmap?center=' + lat + ',' + lng + '&zoom=' + z +
        '&size=160x160&scale=2&maptype=roadmap&markers=color:red%7C' + lat + ',' + lng + '&key=' + encodeURIComponent(apiKey));
      if (hit && !/^image\//.test(hit.type)) hit = null;
    }
    if (!hit) { // no key / Google refused: one free OpenStreetMap tile (usage policy: proper User-Agent)
      const t = osmTile(lat, lng, z);
      hit = await fetchBuf('https://tile.openstreetmap.org/' + z + '/' + t.x + '/' + t.y + '.png', { 'User-Agent': 'TeamChat/1.0' });
    }
    if (!hit) return res.status(502).json({ error: 'Map abhi nahi mila' });
    remember(key, hit);
  }
  res.set({ 'Content-Type': hit.type, 'Cache-Control': 'private, max-age=86400' });
  res.send(hit.buf);
});

module.exports = router;
module.exports.removeFile = removeFile;
module.exports.resolvePath = resolvePath;
module.exports.URL_PREFIX = URL_PREFIX;
