// Daily check-in API. `member`: /checkins (own data only). `admin`: /admin/checkins (boss only, pull-only Reports).
const express = require('express');
const { requireAuth, requireBoss } = require('../middleware/auth');
const C = require('../checkins');

// CheckinError -> its status; anything else -> 500. Every error is {error}.
const h = (fn) => async (req, res) => {
  try {
    res.json(await fn(req, res));
  } catch (e) {
    if (e instanceof C.CheckinError) return res.status(e.status).json({ error: e.message });
    console.error('checkins api:', e.message);
    res.status(500).json({ error: 'Server error' });
  }
};

const member = express.Router();
member.use(requireAuth);
member.get('/today', h((req) => C.today(req.user)));
member.get('/mine', h((req) => {
  if (req.user.role !== 'member') throw new C.CheckinError(403, 'Not allowed'); // boss uses /admin/checkins
  return C.history(req.user.id, req.query.from, req.query.to);
}));
member.post('/picks', h((req) => C.setPick(req.user, req.body))); // morning card "Today" toggle
member.post('/signoff', h(async (req, res) => {
  const out = await C.signoff(req.user, req.body);
  res.status(out.created ? 201 : 200);
  return out;
}));

const admin = express.Router();
admin.use(requireAuth, requireBoss);
admin.get('/', h((req) => C.dayReport(req.query.date)));
admin.get('/settings', h(async () => ({ settings: await C.getSettings() })));
admin.put('/settings', h(async (req) => ({ settings: await C.updateSettings(req.body) })));
admin.get('/user/:id', h((req) => C.userHistory(req.params.id, req.query.from, req.query.to)));

module.exports = { member, admin };
