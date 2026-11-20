// Server-side switches set by the boss (Admin -> Settings). Global ones live in app_settings (name, value JSON),
// per-chat ones in chat_settings (chat_id, name, value JSON). Both are cached in memory; writes refresh the cache.
// Check-in settings ('checkin.*' rows) are separate and handled by checkins.js.
const pool = require('./db');

const DEFAULTS = {
  aiEnabled: true, aiDetect: true, commandsEnabled: true, membersCanAssign: true, notifyAdminOnMemberChanges: true,
  quietTaskNotifs: true, praiseEnabled: true,
  minVersionCode: 0, latestVersionCode: 4, latestVersionName: '0.4.0', apkUrl: '', updateMessage: '',
  // retention (jobs.js): weekly message purge + 14-day task cleanup only when retentionEnabled; reminder 0 = off
  retentionEnabled: true, taskReminderDays: 6, taskDeleteDays: 14, messageRetentionDays: 7,
};
const CHAT_DEFAULTS = { botEnabled: true, aiDetect: true, notifyAdmin: true };
const PUBLIC_KEYS = ['commandsEnabled', 'membersCanAssign', 'praiseEnabled', 'quietTaskNotifs', 'notifyAdminOnMemberChanges',
  'taskReminderDays'];
const STRING_MAX = { latestVersionName: 20, apkUrl: 500, updateMessage: 300 };
const RANGE = { taskReminderDays: [0, 90], taskDeleteDays: [1, 3650], messageRetentionDays: [1, 3650] };

class SettingsError extends Error {
  constructor(message) { super(message); this.status = 400; }
}

let cache = null; // global
const chatCache = new Map(); // chatId -> settings

const parse = (s) => { try { return JSON.parse(s); } catch (e) { return undefined; } };

// Keep only known keys with the right type (bad DB rows fall back to defaults).
function clean(raw, defaults, strict) {
  const out = {};
  for (const [k, v] of Object.entries(raw || {})) {
    if (!(k in defaults)) { if (strict) throw new SettingsError('Unknown setting: ' + k); continue; }
    const d = defaults[k];
    let ok = typeof v === typeof d;
    if (ok && typeof d === 'number') ok = Number.isInteger(v) && v >= (RANGE[k] ? RANGE[k][0] : 0) && v <= (RANGE[k] ? RANGE[k][1] : 1e9);
    if (ok && typeof d === 'string') ok = v.length <= (STRING_MAX[k] || 200);
    if (!ok) { if (strict) throw new SettingsError('Invalid value for ' + k); continue; }
    out[k] = typeof v === 'string' ? v.trim() : v;
  }
  return out;
}

async function all() {
  if (cache) return cache;
  const [rows] = await pool.query('SELECT name, value FROM app_settings WHERE name IN (?)', [Object.keys(DEFAULTS)]);
  const raw = {};
  for (const r of rows) raw[r.name] = parse(r.value);
  cache = { ...DEFAULTS, ...clean(raw, DEFAULTS, false) };
  return cache;
}

// Sync read for hot paths; null until the first all() finished (callers then use the defaults).
const get = () => cache || { ...DEFAULTS };

async function update(partial) {
  if (!partial || typeof partial !== 'object' || Array.isArray(partial)) throw new SettingsError('Nothing to update');
  const vals = clean(partial, DEFAULTS, true);
  if (!Object.keys(vals).length) throw new SettingsError('Nothing to update');
  for (const [k, v] of Object.entries(vals)) {
    const j = JSON.stringify(v);
    await pool.query('INSERT INTO app_settings (name, value) VALUES (?, ?) ON DUPLICATE KEY UPDATE value = ?', [k, j, j]);
  }
  cache = null;
  return all();
}

async function forChat(chatId) {
  if (chatCache.has(chatId)) return chatCache.get(chatId);
  const [rows] = await pool.query('SELECT name, value FROM chat_settings WHERE chat_id = ?', [chatId]);
  const raw = {};
  for (const r of rows) raw[r.name] = parse(r.value);
  const s = { ...CHAT_DEFAULTS, ...clean(raw, CHAT_DEFAULTS, false) };
  chatCache.set(chatId, s);
  return s;
}

async function updateChat(chatId, partial) {
  if (!partial || typeof partial !== 'object' || Array.isArray(partial)) throw new SettingsError('Nothing to update');
  const vals = clean(partial, CHAT_DEFAULTS, true);
  if (!Object.keys(vals).length) throw new SettingsError('Nothing to update');
  for (const [k, v] of Object.entries(vals)) {
    const j = JSON.stringify(v);
    await pool.query('INSERT INTO chat_settings (chat_id, name, value) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE value = ?',
      [chatId, k, j, j]);
  }
  chatCache.delete(chatId);
  return forChat(chatId);
}

async function publicSettings() {
  const s = await all();
  const out = {};
  for (const k of PUBLIC_KEYS) out[k] = s[k];
  return out;
}

// "Show 'Admin' label in chats" opt-out: app_settings row `adminLabelHiddenIds` = JSON array of user ids. Only affects what
// the UI shows (role stays 'boss' with all its permissions). Read straight from the DB, no cache: tiny table, rare writes.
const HIDDEN_ADMIN_KEY = 'adminLabelHiddenIds';

async function hiddenAdminIds() {
  const [[row]] = await pool.query('SELECT value FROM app_settings WHERE name = ?', [HIDDEN_ADMIN_KEY]);
  const v = row ? parse(row.value) : [];
  return new Set(Array.isArray(v) ? v.filter((x) => Number.isInteger(x)) : []);
}

async function setAdminLabelHidden(userId, hidden) {
  const ids = await hiddenAdminIds();
  if (hidden) ids.add(userId); else ids.delete(userId);
  const j = JSON.stringify([...ids].sort((a, b) => a - b));
  await pool.query('INSERT INTO app_settings (name, value) VALUES (?, ?) ON DUPLICATE KEY UPDATE value = ?', [HIDDEN_ADMIN_KEY, j, j]);
}

// Effective "show as admin" flag for a user row/object: true only for a boss who is not in the hidden list.
const showAdminLabel = (role, id, hiddenSet) => role === 'boss' && !hiddenSet.has(id);

module.exports = { hiddenAdminIds, setAdminLabelHidden, showAdminLabel, DEFAULTS, CHAT_DEFAULTS, SettingsError, all, get, update, forChat, updateChat, publicSettings };
