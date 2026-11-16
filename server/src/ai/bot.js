// 'Team Assistant' system user. Inactive (active = 0) and no PIN, so it can never log in and is
// left out of people lists, summaries and task assignment. Created lazily (and by seed.js).
const pool = require('../db');

let cached = null;
async function botUserId() {
  if (cached) return cached;
  await pool.query("INSERT IGNORE INTO users (phone, name, role, active, is_bot) VALUES ('bot', 'Team Assistant', 'member', 0, 1)");
  const [[u]] = await pool.query('SELECT id FROM users WHERE is_bot = 1 ORDER BY id LIMIT 1');
  cached = u.id;
  return cached;
}

module.exports = { botUserId };
