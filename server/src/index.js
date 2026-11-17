require('./env');
if (!process.env.JWT_SECRET || process.env.JWT_SECRET === 'change-me') {
  console.error('Set a real JWT_SECRET in server/.env');
  process.exit(1);
}
const http = require('http');
const express = require('express');
const path = require('path');
const pool = require('./db');
const settings = require('./settings');

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

// Force update info (public). apkUrl etc. come from Admin -> Settings.
app.get('/app/version', async (req, res) => {
  try {
    const s = await settings.all();
    res.json({ minVersionCode: s.minVersionCode, latestVersionCode: s.latestVersionCode, latestVersionName: s.latestVersionName,
      apkUrl: s.apkUrl, message: s.updateMessage });
  } catch (e) {
    res.status(500).json({ error: 'Server error' });
  }
});
// APK download folder (server/public/download, *.apk git-ignored), e.g. /download/TeamChat.apk
app.use('/download', express.static(path.join(__dirname, '..', 'public', 'download')));

// Every other route: header X-App-Version (missing = 0) below minVersionCode -> 426 UPDATE_REQUIRED.
app.use(async (req, res, next) => {
  try {
    const s = await settings.all();
    if (s.minVersionCode > (parseInt(req.get('X-App-Version'), 10) || 0)) {
      return res.status(426).json({ error: 'TeamChat ka naya version install karein (app update required)', code: 'UPDATE_REQUIRED', apkUrl: s.apkUrl });
    }
    next();
  } catch (e) {
    res.status(500).json({ error: 'Server error' });
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
