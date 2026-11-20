// Round 4 media: POST /media (upload), GET /media/f/<yyyy>/<mm>/<file> (protected stream), GET /media/staticmap (map thumbnail).
// Files live in server/uploads/yyyy/mm/<uuid>.<ext> (git-ignored). Everything needs login; GET also accepts the JWT as ?t=<token>
// because RN <Image> / audio players cannot always send headers. Files are deleted with their messages by the weekly purge (jobs.js).
const express = require('express');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const multer = require('multer');
const { requireAuth } = require('../middleware/auth');

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

// ?t=<jwt> -> Authorization header (GET only), then the normal auth middleware (session check included).
const queryToken = (req, res, next) => {
  if (!req.headers.authorization && typeof req.query.t === 'string' && req.query.t) req.headers.authorization = 'Bearer ' + req.query.t;
  next();
};

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
  upload.single('file')(req, res, (err) => {
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
      res.status(201).json({ url: URL_PREFIX + sub + '/' + name, kind, size: f.size });
    } catch (e) {
      console.error('media upload:', e.message);
      res.status(500).json({ error: 'Server error' });
    }
  });
});

router.get('/f/*', queryToken, requireAuth, (req, res) => {
  const file = resolvePath(URL_PREFIX + String(req.params[0] || ''));
  if (!file) return res.status(400).json({ error: 'galat path' });
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

router.get('/staticmap', queryToken, requireAuth, async (req, res) => {
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
