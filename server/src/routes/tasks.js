const express = require('express');
const { requireAuth } = require('../middleware/auth');
const T = require('../tasks');

const router = express.Router();
router.use(requireAuth);

// Wrap a handler: TaskError -> its status, anything else -> 500.
const h = (fn) => async (req, res) => {
  try {
    res.json(await fn(req));
  } catch (e) {
    if (e instanceof T.TaskError) return res.status(e.status).json({ error: e.message });
    res.status(500).json({ error: 'Server error' });
  }
};
const id = (req) => parseInt(req.params.id, 10) || 0;

router.get('/', h(async (req) => ({ tasks: await T.listTasks(req.query, req.user) })));
router.get('/summary', h(() => T.summary()));
router.get('/mine/summary', h((req) => T.mySummary(req.user.id)));

router.post('/', async (req, res) => {
  try {
    res.status(201).json({ task: await T.createTask(req.body || {}, req.user) });
  } catch (e) {
    if (e instanceof T.TaskError) return res.status(e.status).json({ error: e.message });
    res.status(500).json({ error: 'Server error' });
  }
});

router.patch('/:id', h(async (req) => ({ task: await T.updateTask(id(req), req.body || {}, req.user) })));
router.post('/:id/undo', h(async (req) => ({ task: await T.undoTask(id(req), req.user) })));
router.delete('/:id', h(async (req) => { await T.deleteTask(id(req), req.user); return { ok: true }; }));

module.exports = router;
