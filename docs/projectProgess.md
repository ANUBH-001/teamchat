# Project Progress

| Phase | What | Status |
|---|---|---|
| 0 | Folders, MySQL schema, Express server, Expo skeleton, seed users + All Team | DONE (built, not tested by design) |
| 1 | Login (phone + PIN + invite), Admin add members | DONE (built, not tested by design) |
| 2 | WhatsApp UI + chat: groups/DMs, realtime, history, soft delete, reconnect + outbox | DONE (built, not tested by design) |
| 3 | Tasks tab, filters, counts, My Tasks, task APIs + realtime | DONE (built, not tested by design) |
| 4 | AI engine: assign / complete / summary / undo (mock, OpenAI, Gemini providers; Team Assistant bot cards) | DONE (built, not tested by design) |
| 5 | Offline / backup / push: reconnect + outbox (Phase 2), nightly JSON backup, local notifications from WebSocket events (no FCM; tap opens chat) | DONE (built, not tested by design) |
| 6 | Git: repo https://github.com/ANUBH-001/teamchat (branch main), first commit pushed, no secrets. User said keep pushing future phases there | DONE |
| 7 | Deploy: release APK + server (only when told, after Git) | TODO |

## In progress now
Nothing. Waiting for the go-ahead.

## Next step
Phase 7: deploy (only when told). Until then: commit + push each change to origin/main (user approved pushing to ANUBH-001/teamchat only).

## Known gaps / manual steps
- Existing DB must run the missing `server/sql/migrate_001..004.sql` in order (a fresh DB just runs `schema.sql`).
- AI: set `AI_PROVIDER=openai|gemini` + `AI_API_KEY` in `server/.env` for a real model; default `mock` (keyword rules). Server timezone should be IST so "kal/aaj" due dates are right.
- AI limits: members asking to assign are ignored silently; card "Undo" state is local (resets on reload; server still validates); a status Undo reverts the latest status change even if someone changed it after the card.
- Run `npm run seed` in `server/` once; it prints one-time invite codes for each user.
- Create `server/.env` from `.env.example` (set JWT_SECRET).
- Set `serverUrl` in `app/app.json` (`extra.serverUrl`) for a real phone (PC LAN IP); default `http://10.0.2.2:3000` is the Android emulator.
- Run `npm install` in `server/` and in `app/` (new dep `@react-native-async-storage/async-storage`).
- Code is unverified: nothing has been run or tested (by design).
- react-native-gifted-chat was replaced by a plain FlatList; swipe-to-reply was skipped.
- No UI yet for viewing deleted messages; the API exists (`GET /admin/chats/:id/messages?includeDeleted=1`).
- Firebase removed (2026-11-16): realtime is WebSocket only; local notifications while the app process is alive. Run `npm install` again in `server/` (firebase-admin gone). Not in Expo Go. One local test pass is pending.
- Backup: `server/backup/` nightly after `BACKUP_HOUR` (default 2, local time); `npm run backup` for a manual run. Decisions: simple 1-minute check instead of cron; local alerts only for a newly assigned bot task.
