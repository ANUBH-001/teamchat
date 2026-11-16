// Nightly JSON backup -> server/backup/YYYY-MM-DD.json (keeps the last 30). `npm run backup` runs one now.
require('./env');
const fs = require('fs');
const path = require('path');
const pool = require('./db');

const DIR = path.join(__dirname, '..', 'backup');
const KEEP = 30;

const pad = (n) => String(n).padStart(2, '0');
const today = () => { const d = new Date(); return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); };

async function runBackup() {
  const q = async (sql) => (await pool.query(sql))[0];
  const data = {
    exportedAt: new Date().toISOString(),
    users: await q('SELECT id, phone, name, role, active, is_bot, created_at FROM users'), // no pin_hash, no invites
    chats: await q('SELECT * FROM chats'),
    chat_members: await q('SELECT * FROM chat_members'),
    messages: await q('SELECT * FROM messages'), // includes soft-deleted (deleted_at)
    message_revisions: await q('SELECT * FROM message_revisions'),
    tasks: await q('SELECT * FROM tasks'),
    task_events: await q('SELECT * FROM task_events'),
  };
  fs.mkdirSync(DIR, { recursive: true });
  const file = path.join(DIR, today() + '.json');
  fs.writeFileSync(file + '.tmp', JSON.stringify(data));
  fs.renameSync(file + '.tmp', file);
  const old = fs.readdirSync(DIR).filter((f) => /^\d{4}-\d{2}-\d{2}\.json$/.test(f)).sort().slice(0, -KEEP);
  for (const f of old) fs.unlinkSync(path.join(DIR, f));
  return file;
}

// Checks every minute; runs once per day after BACKUP_HOUR (local time, default 2). Also catches up after downtime.
function start() {
  const hour = parseInt(process.env.BACKUP_HOUR, 10);
  const at = Number.isInteger(hour) && hour >= 0 && hour <= 23 ? hour : 2;
  let busy = false;
  const tick = async () => {
    if (busy || new Date().getHours() < at || fs.existsSync(path.join(DIR, today() + '.json'))) return;
    busy = true;
    try { console.log('backup: wrote ' + (await runBackup())); } catch (e) { console.error('backup failed:', e.message); }
    busy = false;
  };
  setInterval(tick, 60000);
  tick();
}

module.exports = { start, runBackup };

if (require.main === module) {
  runBackup()
    .then((f) => { console.log('backup: wrote ' + f); return pool.end(); })
    .catch((e) => { console.error('backup failed:', e.message); process.exit(1); });
}
