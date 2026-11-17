# Project Progress

| Phase | What | Status |
|---|---|---|
| 0 | Folders, MySQL schema, Express server, Expo skeleton, seed | DONE |
| 1 | Login (phone + PIN + invite), Admin add members | DONE |
| 2 | Chat UI: groups/DMs, realtime, history, soft delete, reconnect + outbox | DONE |
| 3 | Tasks tab, filters, counts, My Tasks, task APIs + realtime | DONE |
| 4 | AI engine (natural language, Team Assistant cards, Undo) | DONE |
| 5 | Offline queue, nightly JSON backup, local notifications (no FCM) | DONE |
| 6 | Git: https://github.com/ANUBH-001/teamchat (branch main, no secrets) | DONE |
| 6b | Firebase removed | DONE |
| 6c | Voice input (on-device speech, hi-IN / en-IN) | DONE (emulator UI; speech accuracy untested) |
| 7a | Backend deployed: https://apps.landauditors.com/team_chat | DONE (old build; new code not yet deployed) |
| 7b | Signed release APK (v1) | DONE (rebuild pending, see feedback round) |
| 8a | Swipe-to-reply, live updates, pull-to-refresh, paging | DONE (tested 2026-11-17) |
| 8b | Daily check-ins (private chat per member, boss Reports) | DONE (tested 2026-11-17) |
| 9 | Background alerts: Android foreground service keeps socket alive | DONE (tested on tab 2026-11-17) |
| 10 | Feedback round (2026-11-17): slash commands, groups, Tasks overview/board, Settings, QoL, force update | BUILT, waiting for owner UI approval |

## Feedback round (2026-11-17, "real-phone feedback")
- Bugs: mirrored "No messages yet" text; AI engine silent when unsure (no public "no open task" reply); bot replies can be private (`messages.visible_to`).
- Slash commands (`/task /update /done /testing /reassign /due /delete /tasks /mytasks /help` + aliases). New status Testing (`review`). AI (claude-haiku-5-5) makes the title and project tag; mock fallback. Typed AI errors show as a private card.
- Groups: add / remove / rename / leave, system messages, Group Info screen.
- Tasks tab: Overview (tiles, team bars, activity feed, praise), Board (Kanban), List; Task Detail with timeline + notes; quiet "Task updates" channel.
- Per-user bubble colors in groups; bot output as compact event cards.
- Admin Settings screen: AI, detection, commands, permissions, notifications, praise, per-group bot settings, app update fields, Test AI.
- QoL: long-press menu (reactions, reply, copy, pin, private message, make task, delete), @mentions, pinned bar, jump-to-bottom + unread divider, mute/pin chats, command palette, autolinks.
- Force update: app 0.2.0 / versionCode 2, `X-App-Version` header, GET /app/version, server 426 `UPDATE_REQUIRED`, blocking Update screen.
- Fixes: `server/src/env.js` no longer overwrites a key already set in `server/.env` (local DB password had been replaced by the prod one).
- Migration `server/sql/migrate_007.sql` (applied locally, not on prod).
- Tests (owner allowed for this round only): multi-user API + WebSocket E2E 59/59 pass; emulator UI as boss and member, light + dark. Screenshots sent to owner.

## Remaining (in this order)
1. Owner approves the UI (screenshots).
2. Git push to `ANUBH-001/teamchat` main (only after approval).
3. Rebuild release APK: versionCode 2, new native dep `expo-clipboard` (dev build needs it too).
4. Deploy (steps in DEPLOY.md): migrate_007 on `team_chat_db` BEFORE restarting the new server code; AI env (`AI_PROVIDER=anthropic`, key in server `.env`, never in chat); pm2 restart; upload APK to `server/public/download/TeamChat.apk`; then Admin > Settings: latest version fields, and min version code 2 only when ready (blocks the old v1 build).

## Known gaps
- Untested: real Hindi/Hinglish speech, reminder notifications firing, killed-app behaviour of the new features, release build.
- OnePlus: each phone needs App info -> Battery usage -> "Allow background activity", or the OS freezes the app at screen off.
- Check-ins: placeholder (non-activated) members get prompts and show "Missing"; AI may answer a check-in line with a clarify question.
- AI limits: members asking to assign are ignored silently; card Undo state is local; a status Undo reverts the latest status change even if someone changed it after.
- No UI for deleted messages (API only: `GET /admin/chats/:id/messages?includeDeleted=1`).
- Backup: `server/backup/` nightly after `BACKUP_HOUR` (default 2); `npm run backup` for a manual run.
- Earlier passes (2026-11-16 local API/AI checks, emulator UI, voice, 8a/8b, Phase 9) are finished; their fixes are in the code.
