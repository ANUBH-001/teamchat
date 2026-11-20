// A-07 / B-02 / B-03: short-lived signed media URLs + per-file access check.
// The app never puts its session JWT in a URL any more. It asks POST /media/sign {paths} (JWT in the header); the server checks,
// per path, that this user may see the file, and returns '/media/f/<path>?u=<uid>&e=<exp>&s=<sig>'. The signed URL is the
// capability: GET /media/f/* with a valid, unexpired signature streams the file without a DB lookup.
//   sig = base64url(HMAC-SHA256(secret, 'v1\n' + resource + '\n' + uid + '\n' + exp))
//   secret = MEDIA_URL_SECRET, else HMAC(JWT_SECRET, 'teamchat media-url v1') (distinct from the JWT key itself)
// TTL: MEDIA_URL_TTL_SEC (default 1800 = 30 min). Short enough that a URL copied out of a proxy log or a cache is useless
// soon after, and that removal from a chat takes effect within 30 min for URLs already handed out; long enough that a voice
// note paused / seeked or a screen left open keeps working (the app re-signs 5 min before expiry).
const crypto = require('crypto');
const pool = require('./db');
const { MEMBER_OK } = require('./realtime');

const URL_PREFIX = '/media/f/';
const PATH_RE = /^\/media\/f\/[A-Za-z0-9_-]+(?:\/[A-Za-z0-9_-]+)*\/[A-Za-z0-9_-]+\.[A-Za-z0-9]{1,8}$/; // no '..', '%', '\', NUL
const MAX_PATHS = 100;

const ttlSec = () => {
  const n = parseInt(process.env.MEDIA_URL_TTL_SEC, 10);
  return n >= 60 && n <= 86400 ? n : 1800;
};
// Legacy ?t=<jwt> on GET /media (apps before the signed-URL release). Default on during the transition; set
// MEDIA_ALLOW_TOKEN_QUERY=false once every installed app is on the signed-URL version.
const allowTokenQuery = () => !/^(0|false|no|off)$/i.test(String(process.env.MEDIA_ALLOW_TOKEN_QUERY || 'true').trim());

function secret() {
  if (process.env.MEDIA_URL_SECRET) return Buffer.from(process.env.MEDIA_URL_SECRET);
  if (!process.env.JWT_SECRET) throw new Error('JWT_SECRET missing');
  return crypto.createHmac('sha256', process.env.JWT_SECRET).update('teamchat media-url v1').digest();
}
const mac = (resource, uid, exp) =>
  crypto.createHmac('sha256', secret()).update('v1\n' + resource + '\n' + uid + '\n' + exp).digest('base64url');

// Canonical resource of a request: the file path, or the static map key (lat/lng/z as sent).
const mapResource = (q) => 'staticmap:' + String(q.lat || '') + ',' + String(q.lng || '') + ',' + String(q.z || '');

function sign(resource, uid, nowMs = Date.now()) {
  const exp = Math.floor(nowMs / 1000) + ttlSec();
  return { exp, qs: 'u=' + uid + '&e=' + exp + '&s=' + mac(resource, uid, exp) };
}

// -> {ok:true, uid} | {ok:false, code: 'EXPIRED' | 'BAD_SIGNATURE'}
function verify(resource, q, nowMs = Date.now()) {
  const u = String(q.u || ''); const e = String(q.e || ''); const s = String(q.s || '');
  if (!/^\d{1,10}$/.test(u) || !/^\d{1,12}$/.test(e) || !/^[A-Za-z0-9_-]{43}$/.test(s)) return { ok: false, code: 'BAD_SIGNATURE' };
  const want = Buffer.from(mac(resource, Number(u), Number(e)));
  const got = Buffer.from(s);
  if (want.length !== got.length || !crypto.timingSafeEqual(want, got)) return { ok: false, code: 'BAD_SIGNATURE' };
  if (Number(e) * 1000 <= nowMs) return { ok: false, code: 'EXPIRED' };
  return { ok: true, uid: Number(u) };
}

const validPath = (p) => typeof p === 'string' && p.length <= 255 && PATH_RE.test(p);

// B-03: which of these /media/f/ paths may `user` ({id, role}) see? -> Set of allowed paths.
//  - a profile photo (users.avatar_url): every logged-in user
//  - a file this user uploaded (media_files.uploader_id): needed between upload and send
//  - the media of a message the user can read: active member of the chat (check-in privacy guard included), message not
//    deleted (the boss also sees deleted ones), ephemeral messages only for their target; the boss also reads any
//    non-check-in chat (Admin -> chat viewer, /admin/chats/:id/messages)
async function accessible(user, paths) {
  const list = [...new Set(paths.filter(validPath))];
  const ok = new Set();
  if (!list.length) return ok;
  const boss = user.role === 'boss' ? 1 : 0;
  const [av] = await pool.query('SELECT DISTINCT avatar_url p FROM users WHERE avatar_url IN (?)', [list]);
  const [up] = await pool.query('SELECT path p FROM media_files WHERE uploader_id = ? AND path IN (?)', [user.id, list]);
  const [ms] = await pool.query(
    'SELECT DISTINCT m.media_url p FROM messages m JOIN chats c ON c.id = m.chat_id ' +
    'LEFT JOIN chat_members cm ON cm.chat_id = m.chat_id AND cm.user_id = ? AND cm.left_at IS NULL ' +
    'LEFT JOIN users u ON u.id = cm.user_id ' +
    'WHERE m.media_url IN (?) AND (m.visible_to IS NULL OR m.visible_to = ?) AND (' +
    '  (cm.user_id IS NOT NULL AND c.deleted_at IS NULL AND ' + MEMBER_OK + ' AND (m.deleted_at IS NULL OR ? = 1))' +
    "  OR (? = 1 AND c.type <> 'checkin'))",
    [user.id, list, user.id, boss, boss]);
  for (const r of [...av, ...up, ...ms]) ok.add(r.p);
  return ok;
}
const canAccess = async (user, p) => (await accessible(user, [p])).has(p);

// POST /media: remember who uploaded the file. Needs migrate_011 (media_files); without it uploads answer 500.
async function recordUpload(p, uploaderId) {
  await pool.query('INSERT IGNORE INTO media_files (path, uploader_id) VALUES (?, ?)', [p, uploaderId]);
}

module.exports = { URL_PREFIX, MAX_PATHS, sign, verify, mapResource, accessible, canAccess, recordUpload, validPath, allowTokenQuery, ttlSec };
