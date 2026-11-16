const jwt = require('jsonwebtoken');
const pool = require('../db');

async function requireAuth(req, res, next) {
  try {
    const h = req.headers.authorization || '';
    const token = h.startsWith('Bearer ') ? h.slice(7) : null;
    if (!token) return res.status(401).json({ error: 'Not authenticated' });
    let payload;
    try {
      payload = jwt.verify(token, process.env.JWT_SECRET);
    } catch (e) {
      return res.status(401).json({ error: 'Not authenticated' });
    }
    const [[u]] = await pool.query(
      'SELECT id, phone, name, role, active FROM users WHERE id = ?', [payload.id]);
    if (!u || !u.active) return res.status(401).json({ error: 'Not authenticated' });
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

module.exports = { requireAuth, requireBoss };
