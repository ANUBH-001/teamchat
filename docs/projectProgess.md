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
| 7a | Backend deployed: https://apps.landauditors.com/team_chat | DONE (feedback-round code live 2026-11-17) |
| 7b | Signed release APK (v1) | DONE (now 0.2.0, versionCode 2) |
| 8a | Swipe-to-reply, live updates, pull-to-refresh, paging | DONE (tested 2026-11-17) |
| 8b | Daily check-ins (private chat per member, boss Reports) | DONE (tested 2026-11-17) |
| 9 | Background alerts: Android foreground service keeps socket alive | DONE (tested on tab 2026-11-17) |
| 10 | Feedback round (2026-11-17): slash commands, groups, Tasks overview/board, Settings, QoL, force update | DONE: approved, pushed, deployed, APK 0.2.0 |
| 11 | Round 2 (2026-11-18): person picker, composer / @ helpers, /ask /desc, edit/delete, retention, check-in rework, reset | DONE: deployed 2026-11-18, APK 0.3.0 |
| 12 | Round 3 (2026-11-18): multi-assignee, 6 statuses + close, member visibility, message<->task links, emoji avatars, one login per user, security, perf | BUILT + TESTED locally 2026-11-18 (migrate_009 local only), awaiting owner approval / push / deploy |

## Round 3 (2026-11-18) - BUILT + TESTED (local), awaiting owner approval
- Plan: owner-approved round-3 plan (15 items + bug 1). Backend: status.js, users.js (cache + name/emoji rules), tasks.js rewrite (task_assignees, aggregate, close/reopen, visibility, brief shape, scope/with lists, timeline sources), commands (multi @, self words, /assign /unassign /planning /coding /merged /status /close /reopen, multi /ask), handleLinked (reply chains + #N notes, ask answers), edit/delete propagation, card <-> source links, kind filter, chat info tasks, single session + rate limits + headers, jobs (cleanup only done/closed, per-assignee reminders).
- App 0.4.0: Mine/Everyone + Closed filters, 6-column board, people section + per-person status, close/reopen, expandable timeline sources, check-in card actions, AI|All|Chat filter with cards attached under the source, #N chip, ask card chips + in-app banner + notification Reply, DM task sheet, chat info for all chats, profile (name + emoji) and admin logout/reset, "Me (khud)" in pickers (bug 1).
- Test pass (owner allowed, 2026-11-18): new backend E2E 237/237 (15 areas, iter 1 232/235), corpus 209/209, e2e 59/59, bc 84/84, reset 19/19 (expectations updated only for intended round-3 changes), emulator UI boss + member (light, dark spot checks). 9 bugs fixed: one-emoji rule + flags (users.js), AI placeholder title "<UNKNOWN>" (provider.js), AI-filter own message vanishing, ask card Description opens the editor, ask banner / notification / "Chat mein dekho" scroll to the message, chained sheets dropped (350 ms gap), squashed Tasks filter chips, Undo alert shows my step, "now ago". Not tested: notification Reply action, 300-msg scroll, voice. Details: build-session scratchpad round3-results.md.
- Owner decisions: never delete open tasks; min version 4 at deploy; unique names in code only (409); Everyone shows names; "#N" message = note for admin/creator/assignee; deleting a /task message keeps the task; Mine = assigned + created.

## Round 2 (2026-11-18) - DEPLOYED
- Prod bug fixed: two users named "Rishit" made every `/task rishit ...` unresolvable. New shared person resolution (names.js: exact > prefix > fuzzy incl. "anubav"/"rishith"; fillers; chat members first), structured `mentionIds` from the app, AI pick from context, and a tappable **userpicker** card (never "Poora naam likhiye" without choices).
- Composer: `/` and `@` buttons, quick chips on focus, command sheet, people sheet (phone tail for same names), person sheet (open tasks + Status poochho / Update / Done / Reassign / Due / Description / Naya task / Mention).
- New commands `/ask #id` (status question card + notification) and `/desc #id`; swipe-reply to a task card adds a note (`desc:` replaces the description).
- Edit + delete own messages within 10 minutes for everyone (admin too; old "admin deletes anything" removed); "edited" label; message_revisions.
- Retention jobs (jobs.js): Sunday 23:00 hard purge of messages > 7 days (pinned kept, JSON dump first), 6-day pending reminder (once) + admin alert + "6+ din pending" section, 14-day hard task cleanup (dump first); settings in Admin > Settings > Data retention. Debug: POST /admin/jobs/run.
- Daily check-in rework: 10:00 pinned live "today's tasks" card, 18:00 sign-off (Done / In progress / Not started + note), `signoffs` table, admin quiet notification + Reports + Tasks tab panels; member "My day" in Tasks.
- Admin "Reset app data" (type RESET; full backup first). AI /task also writes a clean description. Version 0.3.0 / versionCode 3. migrate_008 (applied locally).
- **Tested 2026-11-18 (owner allowed this round):** task-engine corpus 209 cases multi-user HTTP+ws (/task names/typos/Hinglish/Devanagari/dates, two Rishits, pickers, status words, /update /done /testing /reassign /due /desc /ask /delete /tasks, card replies, permissions, switches, casual chat): AI off 94.7% -> 100% -> 100% (final), AI on 100%, bad key 16/16; messages 40/40; jobs + check-ins 44/44 (+ scheduled taskcleanup with retention off/on); reset 16/16; round-1 E2E 59/59; old-client 426 10/10; emulator UI as member + boss, light + dark; native Copy + notifications channels checked.
- Fixes from the test: name later in `/task` ("... anubhav ko", "... @Tushar"); "anubhav" picks Anubhav over Anubhav Kumar; "rishith" no longer offers Rishabh; `@Name` first-name mention regex (`/s+/`); unrelated member got "already Done" info instead of NOT_ALLOWED; Hindi fillers in mock titles; app: swipe/menu reply on task cards, no notification for slash-command text, tab bar hides on keyboard, Reports header under status bar, Android back in Settings, mention contrast on own bubble.

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

## OTA updates (built, not yet tested/deployed)
expo-updates ~0.27.5, `/updates/manifest` + `/updates/assets`, Update app card, banner, `publish-update.ps1`, app 0.5.0 (code 5), runtimeVersion "1". Needs one last APK install, then JS updates go OTA.

## Remaining (in this order)
0. Round 3: owner approval (test pass done), push, release APK 0.4.0, deploy per DEPLOY.md "Round 3" (APK upload, DB backup, migrate_009, restart, latest = min = 4).
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
