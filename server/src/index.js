require('dotenv').config();
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
app.use('/admin', require('./routes/admin'));
app.use('/chats', require('./routes/chats'));
app.use('/push', require('./push').router);
app.use('/tasks', require('./routes/tasks'));
app.use('/', require('./routes/misc'));

const server = http.createServer(app);
require('./realtime').attach(server);

const port = process.env.PORT || 3000;
server.listen(port, () => console.log('Server on :' + port));
require('./backup').start();
