// Express app construction (no listen, no schedulers) so tests can mount it with supertest.
const express = require('express');
const path = require('path');
const pool = require('./db');
const settings = require('./settings');

function createApp() {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 'loopback'); // behind the local reverse proxy: req.ip = real client (rate limits)
  app.use((req, res, next) => {
    res.set({ 'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'DENY', 'Referrer-Policy': 'no-referrer' });
    next();
  });
  app.use(express.json({ limit: '256kb' })); // media JSON (waveform) + payload.quote
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

  // Self-hosted OTA updates (expo-updates sends no X-App-Version, so mount before the 426 check below)
  app.use('/updates', require('./routes/updates'));

  // Round 4: media (login required inside; mounted before the 426 check: RN Image/Audio cannot send X-App-Version, they use ?t=)
  app.use('/media', require('./routes/media'));

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
  // B-21: last resort, always JSON (never the default HTML stack page)
  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    if (res.headersSent) return next(err);
    if (err && err.type === 'entity.parse.failed') return res.status(400).json({ error: 'Invalid JSON', code: 'BAD_JSON' });
    if (err && err.type === 'entity.too.large') return res.status(413).json({ error: 'Request too large', code: 'TOO_LARGE' });
    console.error('unhandled route error:', err && err.message);
    res.status(500).json({ error: 'Server error' });
  });
  return app;
}

module.exports = { createApp };
