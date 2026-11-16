# Project Progress

| Phase | What | Status |
|---|---|---|
| 0 | Folders, MySQL schema, Express server, Expo skeleton, seed users + All Team | DONE (server tested 2026-11-16) |
| 1 | Login (phone + PIN + invite), Admin add members | DONE (server tested 2026-11-16) |
| 2 | WhatsApp UI + chat: groups/DMs, realtime, history, soft delete, reconnect + outbox | DONE (server tested 2026-11-16) |
| 3 | Tasks tab, filters, counts, My Tasks, task APIs + realtime | DONE (server tested 2026-11-16) |
| 4 | AI engine: assign / complete / summary / undo (mock, OpenAI, Gemini providers; Team Assistant bot cards) | DONE (server tested 2026-11-16) |
| 5 | Offline / backup / push: reconnect + outbox (Phase 2), nightly JSON backup, local notifications from WebSocket events (no FCM; tap opens chat) | DONE (server tested 2026-11-16) |
| 6 | Git: repo https://github.com/ANUBH-001/teamchat (branch main), first commit pushed, no secrets. User said keep pushing future phases there | DONE |
| 6b | Firebase removed + ONE local test pass (allowed once by Manish, 2026-11-16) | DONE |
| 7 | Deploy: release APK + server (only when told, after Git) | TODO |

## In progress now
Nothing. Waiting for the go-ahead.

## Local test pass (2026-11-16, done; no more testing without a new go-ahead)
- Setup: project-local MySQL 8.4 on 127.0.0.1:3307 (`server/scripts/localdb-start.ps1`), fresh `schema.sql` (matches migrate_001..004), seed, AI mock.
- Result: 186 automated API/WebSocket/AI checks (auth, admin, chats, WS events/ticks/reconnect, tasks/undo/events, AI mock Hinglish + Devanagari, AI failure handling with a stubbed provider: bad key, garbage output, out-of-scope task id, 15 s timeout), backup content, secret scan, SQL params: all pass after fixes. App: `tsc --noEmit` clean, `expo config` valid.
- Bugs fixed: deactivated user's open WebSocket kept receiving events; impossible due date (2026-02-31) gave 500; assigneeId as string logged a fake reassign event; app dependency `async-storage@1.23.2` does not exist (npm install failed) -> 1.23.1. Hardening: JWT pinned to HS256; server refuses to start with an empty/`change-me` JWT_SECRET.
- AI check (2026-11-16): the key in `server/src/.env` is an `sk-ant-` key, not an OpenAI key; OpenAI returns 401, so the real model is still untested. Fixes: env loads from either `.env` place; a provider failure now falls back to the mock rules (before: no reply); mock read "shuru kar diya" as done and missed "<naam> ke tasks ka status batao". Via the chat API (on the mock fallback): Devanagari/Hinglish assign, done, my tasks, ambiguous -> clarify, chat -> silent, member assign -> silent, injection -> nothing beyond the sender's own task. Local DB re-seeded with demo data (4 activated users, group "Website Project", messages, tasks in all statuses).
- Not tested: real AI provider (needs a real OpenAI key in `server/.env`; `AI_PROVIDER=openai`, `AI_MODEL=gpt-4.1-mini` already set), the app on a phone/emulator (UI, local notifications, outbox, reconnect), Expo build. Mock AI does not assign in a DM when no name is given (the real model path handles it).

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
- Server verified once locally (above); the app only type-checked.
- react-native-gifted-chat was replaced by a plain FlatList; swipe-to-reply was skipped.
- No UI yet for viewing deleted messages; the API exists (`GET /admin/chats/:id/messages?includeDeleted=1`).
- Firebase removed (2026-11-16): realtime is WebSocket only; local notifications while the app process is alive. Run `npm install` again in `server/` (firebase-admin gone). Release APK needs an HTTPS server URL (plain http is blocked in release builds).
- Backup: `server/backup/` nightly after `BACKUP_HOUR` (default 2, local time); `npm run backup` for a manual run. Decisions: simple 1-minute check instead of cron; local alerts only for a newly assigned bot task.
