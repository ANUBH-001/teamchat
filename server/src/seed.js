// Run once after schema.sql: npm run seed
const crypto = require('crypto');
const pool = require('./db');
const { hashCode } = require('./routes/auth');
const { botUserId } = require('./ai/bot');
const { ensureChat } = require('./checkins');

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
function newCode() {
  let c = '';
  for (let i = 0; i < 8; i++) c += ALPHABET[crypto.randomInt(ALPHABET.length)];
  return c;
}

const people = [
  ['9000000001', 'Anubhav', 'member'],
  ['9000000002', 'Arushit', 'member'],
  ['9000000003', 'Tushar', 'member'],
  ['9000000004', 'Rishit', 'boss'],
];
for (let i = 5; i <= 11; i++) {
  people.push(['90000000' + String(i).padStart(2, '0'), 'Member ' + i, 'member']);
}

(async () => {
  const ids = [];
  for (const [phone, name, role] of people) {
    await pool.query(
      'INSERT INTO users (phone, name, role) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE name = VALUES(name)',
      [phone, name, role]
    );
    const [[u]] = await pool.query('SELECT id FROM users WHERE phone = ?', [phone]);
    ids.push(u.id);
  }
  let [[chat]] = await pool.query("SELECT id FROM chats WHERE type = 'all' LIMIT 1");
  if (!chat) {
    const [r] = await pool.query("INSERT INTO chats (type, name, created_by) VALUES ('all', 'All Team', ?)", [ids[3]]);
    chat = { id: r.insertId };
  }
  for (const id of ids) {
    await pool.query('INSERT IGNORE INTO chat_members (chat_id, user_id) VALUES (?, ?)', [chat.id, id]);
  }
  await botUserId(); // 'Team Assistant' system user for AI bot messages
  // private 'Daily Check-in' chat (member + bot) for every member; the boss gets none
  for (let i = 0; i < people.length; i++) if (people[i][2] === 'member') await ensureChat(ids[i]);
  console.log('Seeded ' + ids.length + ' users, Team Assistant bot, All Team chat and Daily Check-in chats');

  // Invite codes (SHA-256 hashed, same as routes/admin.js). Plaintext shown only here, once.
  console.log('\nInvite codes (shown once):');
  for (let i = 0; i < people.length; i++) {
    const [[u]] = await pool.query('SELECT pin_hash FROM users WHERE id = ?', [ids[i]]);
    if (u.pin_hash) { console.log(people[i][1] + ' ' + people[i][0] + ' already activated, skipped'); continue; }
    await pool.query('UPDATE invites SET used_at = NOW() WHERE user_id = ? AND used_at IS NULL', [ids[i]]);
    const code = newCode();
    await pool.query('INSERT INTO invites (user_id, code) VALUES (?, ?)', [ids[i], hashCode(code)]);
    console.log(people[i][1] + '  ' + people[i][0] + '  ' + code);
  }
  await pool.end();
})().catch((e) => { console.error(e); process.exit(1); });
