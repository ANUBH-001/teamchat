require('./env');
if (!process.env.JWT_SECRET || process.env.JWT_SECRET === 'change-me') {
  console.error('Set a real JWT_SECRET in server/.env');
  process.exit(1);
}
const http = require('http');
const { createApp } = require('./app');

const server = http.createServer(createApp());
require('./realtime').attach(server);

const port = process.env.PORT || 3000;
server.listen(port, () => console.log('Server on :' + port));
require('./backup').start();
require('./checkins').start(); // daily check-in cards: morning tasks + evening sign-off (1-minute tick, TZ)
require('./jobs').start(); // retention purge, 6-day reminders, 14-day task cleanup
// B-07: voice notes left 'pending' by a restart (older than 2 min, max 20) are transcribed again
require('./routes/chats').requeueVoiceNotes().catch((e) => console.error('voice requeue:', e.message));
