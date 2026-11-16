require('./env');
if (!process.env.JWT_SECRET || process.env.JWT_SECRET === 'change-me') {
  console.error('Set a real JWT_SECRET in server/.env');
  process.exit(1);
}
const http = require('http');
const express = require('express');
const pool = require('./db');

const app = express();
app.use(express.json());
app.get('/health', async (req, res) => {
  try {
    await pool.query('SELECT 1');
    res.json({ ok: true, db: true });
  } catch (e) {
    res.status(500).json({ ok: false, db: false });
  }
});

app.use('/auth', require('./routes/auth'));
app.use('/admin/checkins', require('./routes/checkins').admin); // boss-only Reports (before /admin)
app.use('/admin', require('./routes/admin'));
app.use('/checkins', require('./routes/checkins').member);
app.use('/chats', require('./routes/chats'));
app.use('/tasks', require('./routes/tasks'));
app.use('/', require('./routes/misc'));

const server = http.createServer(app);
require('./realtime').attach(server);

const port = process.env.PORT || 3000;
server.listen(port, () => console.log('Server on :' + port));
require('./backup').start();
require('./checkins').start(); // daily check-in prompts / nudges (1-minute tick, TZ)
