const jwt = require('jsonwebtoken');
const pool = require('../db');

// One login per user (round 3): the JWT carries sv = users.session_id at login. A newer login rotates session_id, so the
// old token fails with 401 SESSION_REPLACED. session_id NULL (never logged in since round 3) accepts only tokens without sv.
const sessionOk = (u, payload) => (u.session_id ? payload.sv === u.session_id : !payload.sv);

async function requireAuth(req, res, next) {
  try {
    const h = req.headers.authorization || '';
    const token = h.startsWith('Bearer ') ? h.slice(7) : null;
    if (!token) return res.status(401).json({ error: 'Not authenticated' });
    let payload;
    try {
      payload = jwt.verify(token, process.env.JWT_SECRET, { algorithms: ['HS256'] });
    } catch (e) {
      return res.status(401).json({ error: 'Not authenticated' });
    }
    const [[u]] = await pool.query(
      'SELECT id, phone, name, role, active, avatar_emoji, session_id FROM users WHERE id = ?', [payload.id]);
    if (!u || !u.active) return res.status(401).json({ error: 'Not authenticated' });
    if (!sessionOk(u, payload)) {
      return res.status(401).json({ error: 'Aap kisi aur phone par login ho gaye', code: 'SESSION_REPLACED' });
    }
    delete u.session_id;
    req.user = u;
    next();
  } catch (e) {
    res.status(500).json({ error: 'Server error' });
  }
}

function requireBoss(req, res, next) {
  if (!req.user || req.user.role !== 'boss') return res.status(403).json({ error: 'Not allowed' });
  next();
}

module.exports = { requireAuth, requireBoss, sessionOk };
