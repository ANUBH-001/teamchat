const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const pool = require('../db');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();
const MAX_ATTEMPTS = 5;
const LOCK_MINUTES = 15;
const PIN_RE = /^\d{4,6}$/;

const hashCode = (code) => crypto.createHash('sha256').update(String(code).trim().toUpperCase()).digest('hex');
const publicUser = (u) => ({ id: u.id, phone: u.phone, name: u.name, role: u.role });
const sign = (u) => jwt.sign({ id: u.id }, process.env.JWT_SECRET, { expiresIn: '30d' });
const normPhone = (p) => String(p || '').replace(/\s+/g, '');

router.post('/activate', async (req, res) => {
  try {
    const phone = normPhone(req.body.phone);
    const { inviteCode, pin } = req.body;
    const fail = () => res.status(400).json({ error: 'Invalid phone or invite code' });
    if (!phone || !inviteCode) return fail();
    if (!PIN_RE.test(String(pin || ''))) return res.status(400).json({ error: 'PIN must be 4 to 6 digits' });
    const [[u]] = await pool.query('SELECT * FROM users WHERE phone = ? AND active = 1', [phone]);
    if (!u) return fail();
    const [[inv]] = await pool.query(
      'SELECT id FROM invites WHERE user_id = ? AND code = ? AND used_at IS NULL', [u.id, hashCode(inviteCode)]);
    if (!inv) return fail();
    const pinHash = await bcrypt.hash(String(pin), 10);
    await pool.query('UPDATE users SET pin_hash = ?, failed_attempts = 0, locked_until = NULL WHERE id = ?', [pinHash, u.id]);
    await pool.query('UPDATE invites SET used_at = NOW() WHERE id = ?', [inv.id]);
    require('../realtime').sendToBosses({ type: 'users' }).catch(() => {});
    res.json({ token: sign(u), user: publicUser(u) });
  } catch (e) {
    res.status(500).json({ error: 'Server error' });
  }
});

router.post('/login', async (req, res) => {
  try {
    const phone = normPhone(req.body.phone);
    const pin = String(req.body.pin || '');
    const bad = () => res.status(401).json({ error: 'Invalid phone or PIN' });
    const [[u]] = await pool.query('SELECT * FROM users WHERE phone = ?', [phone]);
    if (!u || !u.active || !u.pin_hash) return bad();
    if (u.locked_until && new Date(u.locked_until) > new Date()) {
      return res.status(429).json({ error: 'Too many attempts. Try again later.' });
    }
    const ok = await bcrypt.compare(pin, u.pin_hash);
    if (!ok) {
      const expired = u.locked_until && new Date(u.locked_until) <= new Date();
      const attempts = (expired ? 0 : u.failed_attempts) + 1;
      if (attempts >= MAX_ATTEMPTS) {
        await pool.query(
          'UPDATE users SET failed_attempts = 0, locked_until = DATE_ADD(NOW(), INTERVAL ? MINUTE) WHERE id = ?',
          [LOCK_MINUTES, u.id]);
      } else {
        await pool.query('UPDATE users SET failed_attempts = ?, locked_until = NULL WHERE id = ?', [attempts, u.id]);
      }
      return bad();
    }
    await pool.query('UPDATE users SET failed_attempts = 0, locked_until = NULL WHERE id = ?', [u.id]);
    res.json({ token: sign(u), user: publicUser(u) });
  } catch (e) {
    res.status(500).json({ error: 'Server error' });
  }
});

router.get('/me', requireAuth, (req, res) => {
  res.json({ user: publicUser(req.user) });
});

module.exports = router;
module.exports.hashCode = hashCode;
