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
| 6c | Voice input (mic) in chat: on-device Android speech recognition, hi-IN / en-IN, needs the dev build (see Frontend.md) | DONE (emulator UI check, see below) |
| 8a | UI: swipe-to-reply (migrate_005), live updates everywhere + pull-to-refresh + foreground/reconnect refetch + paging, memoized rows, loading/empty states | DONE (tested 2026-11-17) |
| 8b | Daily check-ins (plan 11b): server + app (check-in chat cards, boss Reports + settings, local reminders) | DONE (tested 2026-11-17) |
| 7 | Deploy: release APK + server (only when told, after Git) | TODO |

## In progress now
Nothing. 8a/8b tested 2026-11-17 (below); zero-testing applies again. Remaining: Phase 7 deploy (only when told). Manual steps before use: run `server/sql/migrate_005.sql` then `migrate_006.sql` on an existing DB, set `TZ=Asia/Kolkata` in `server/.env`; the JS-only app changes load through Metro into the existing dev build.

## 8a/8b test pass (2026-11-17, allowed once by Manish; local DB migrated with 005+006, TZ=Asia/Kolkata, real Anthropic AI)
- Server (throwaway scripts, 81 + scheduler checks, all pass): reply payload in API + WS, replyToId other chat/bad/missing -> 400, outbox resend (same clientId) keeps reply, deleted original -> quote "deleted", paging `before`/hasMore, WS `users` to boss only (add/deactivate); check-ins: all validation errors, morning/evening submit 201, edit 200 with revisions (statuses merge, text kept), task changes via tasks.js (task_events source `checkin` + message_id), /mine ranges, boss 403 on /checkins/*, members 403 on /admin/checkins*, report/history/settings incl. all 400s; scheduler: morning prompt, morning + evening nudge (nudge 1 min), evening prompt, restart -> no double post; chat text appended to the day's text; AI summary real (Anthropic) + fallback (bad key / mock -> basic kept).
- PRIVACY (pass): boss and other members never get a check-in chat in GET /chats, 403 on its messages/post/read/delete and /admin/chats/:id/messages, no WS message/chat/read/typing event, no unread/ticks effect; still holds with a stray chat_members row for boss/other member; boss reads only via /admin/checkins (task `task` event exception as documented).
- Emulator (dev build): boss swipe-to-reply + quote, tap quote scrolls/flashes, "not loaded" toast, live messages/chat list/Tasks counts+chips/Admin list, pull-to-refresh, paging older pages in a 100+ message chat, Reports (day nav, pills, member detail with AI summary, 7/30 days), settings (validation + save); member: Daily Check-in pinned 2nd with header note, morning chips + Send plan, evening Done/In progress/Pending + text + Send report, Submitted/Edit, own task status from Tasks tab, no '+' and others' tasks read-only, weekly local reminders scheduled (alarms at the configured times).
- OnePlus tab (dev build): app launches and loads, mic button, recording bar with live waveform, X cancels (nothing sent). Mic permission was already granted, so the prompt was not re-shown (phone settings not touched). Speech accuracy UNTESTED (nobody spoke).
- Bugs fixed: (1) a late AI summary of an older edit overwrote a newer status-only edit (stale "in progress") -> summary written only if text AND payload unchanged; status-only edits now refresh the summary (`checkins.js`). (2) editing a report re-ran the AI on the same text and overrode the picked status (In progress -> Done) -> AI engine runs only on new text (`checkins.js`). (3) with two cards of one slot (prompt + reminder) the other card kept an old open form with stale statuses; sending it would revert tasks -> all cards of the slot refresh/close on a new submission (`CheckinCard.tsx`). (4) GET /checkins/mine answered the boss -> 403 like the rest of /checkins (`routes/checkins.js`).
- Not tested: real speech -> text / Hindi accuracy, reminder notification actually firing, killed-app behaviour, release build. Notes: non-activated placeholder members also get prompts and show "Missing"; AI may answer a check-in chat line with a "Kaunsa task?" clarify.

## Local test pass (2026-11-16, done; no more testing without a new go-ahead)
- Setup: project-local MySQL 8.4 on 127.0.0.1:3307 (`server/scripts/localdb-start.ps1`), fresh `schema.sql` (matches migrate_001..004), seed, AI mock.
- Result: 186 automated API/WebSocket/AI checks (auth, admin, chats, WS events/ticks/reconnect, tasks/undo/events, AI mock Hinglish + Devanagari, AI failure handling with a stubbed provider: bad key, garbage output, out-of-scope task id, 15 s timeout), backup content, secret scan, SQL params: all pass after fixes. App: `tsc --noEmit` clean, `expo config` valid.
- Bugs fixed: deactivated user's open WebSocket kept receiving events; impossible due date (2026-02-31) gave 500; assigneeId as string logged a fake reassign event; app dependency `async-storage@1.23.2` does not exist (npm install failed) -> 1.23.1. Hardening: JWT pinned to HS256; server refuses to start with an empty/`change-me` JWT_SECRET.
- AI check (2026-11-16): the key in `server/src/.env` is an `sk-ant-` key, not an OpenAI key; OpenAI returns 401, so the real model is still untested. Fixes: env loads from either `.env` place; a provider failure now falls back to the mock rules (before: no reply); mock read "shuru kar diya" as done and missed "<naam> ke tasks ka status batao". Via the chat API (on the mock fallback): Devanagari/Hinglish assign, done, my tasks, ambiguous -> clarify, chat -> silent, member assign -> silent, injection -> nothing beyond the sender's own task. Local DB re-seeded with demo data (4 activated users, group "Website Project", messages, tasks in all statuses).
- Not tested then: real AI provider, the app on a device. Mock AI does not assign in a DM when no name is given (the real model path handles it).

## Emulator UI test pass (2026-11-16, allowed by Manish; Expo Go 2.32.20 on AVD teamchat_test, real Anthropic AI)
- Passed: invite activation + PIN, login (boss), auto-login after restart, logout; chat list (All Team pinned, unread badges, search, live reorder), group create (pick members), DM, bubbles/date separator/sender colors, ticks sent/delivered/read (blue), typing indicator, live incoming messages, long-press delete -> "This message was deleted"; boss message "Anubhav ko landing page banana hai aur Tushar ko site delete karni hai" -> two live Team Assistant cards, Undo deletes the task; Tasks (counts per person, filter chips, My Tasks, boss "+" create, status change, live update from AI); Admin (list, add member -> invite code, reset PIN, deactivate/reactivate); offline: message queued (clock tick), delivered on reconnect, missed messages fetched; local notification while backgrounded, tap opens the chat; dark mode.
- Bugs fixed: Metro failed to start (`expo-asset` missing), `expo-font` missing for icons, react-native 0.76.5 -> 0.76.9; react-navigation latest needed newer safe-area-context (ref error) and logged navigate deprecation -> pinned to SDK 52 versions (bottom-tabs 7.2.0, native 7.0.14, overrides elements 2.2.5 / core 7.3.1 / routers 7.1.2); tab bar had no icons; "No chats" flashed before load; buttons/list rows needed two taps while the keyboard was open (Admin add, picker, chat list); missed messages were skipped after reconnect when the outbox sent first (ChatScreen now tracks the last id received from the server); AI titles like "Banana landing page" (prompt asks for the sender's words).
- Not tested: real phone, release/dev build (Expo Go only: notifications are local and only while the app process lives; Expo Go warns remote push is unsupported), killed-app alerts, very long chats/scrolling older pages, member-side UI (assignee status change from the app).

## Voice input (2026-11-16, emulator dev build; no real phone yet)
- Built: mic button / recording bar (X, live waveform, हिं/EN chip, stop, send), `useVoiceInput` hook, `expo-speech-recognition` 1.1.1 + `expo-system-ui` + `expo-file-system`, RECORD_AUDIO. Native debug dev build (see Frontend.md); `app/android/` gitignored.
- Verified on emulator (dev build): mic shows when the box is empty and Send when there is text; permission prompt; deny -> friendly alert with Open settings; allow -> recording bar, waveform moves with volume events; chip switches hi-IN -> en-IN and restarts the recognizer (logcat) and is remembered; X returns to the normal bar; stop/send with silence -> toast 'Kuch sunai nahi diya', nothing sent; dark mode; no crash. Expo Go: no crash, mic hidden, Send as before.
- Bug fixed: dev build had no icons (expo-asset needs expo-file-system natively).
- Untested: real speech -> text (the emulator mic gets no host voice), Hindi/Hinglish accuracy, auto-stop after 60 s, behaviour on the OnePlus. The phone still runs Expo Go (no voice there); voice needs the dev build installed on the phone, to be done only after the user agrees.

## Next step
Phase 7: deploy (only when told). Until then: commit + push each change to origin/main (user approved pushing to ANUBH-001/teamchat only).

## Known gaps / manual steps
- Existing DB must run the missing `server/sql/migrate_001..006.sql` in order (a fresh DB just runs `schema.sql`).
- AI: set `AI_PROVIDER=openai|gemini` + `AI_API_KEY` in `server/.env` for a real model; default `mock` (keyword rules). Server timezone should be IST so "kal/aaj" due dates are right.
- AI limits: members asking to assign are ignored silently; card "Undo" state is local (resets on reload; server still validates); a status Undo reverts the latest status change even if someone changed it after the card.
- Run `npm run seed` in `server/` once; it prints one-time invite codes for each user.
- Create `server/.env` from `.env.example` (set JWT_SECRET).
- Set `serverUrl` in `app/app.json` (`extra.serverUrl`) for a real phone (PC LAN IP); default `http://10.0.2.2:3000` is the Android emulator.
- Run `npm install` in `server/` and in `app/` (new dep `@react-native-async-storage/async-storage`).
- Server verified locally and the app tested on the emulator in Expo Go (above); no real phone or build yet.
- react-native-gifted-chat was replaced by a plain FlatList; swipe-to-reply built in Phase 8a (untested).
- Phase 8a/8b manual step: existing DB must run `server/sql/migrate_005.sql`, then `migrate_006.sql` (check-ins; the server needs it before start). Set `TZ=Asia/Kolkata` in `server/.env` (default anyway).
- No UI yet for viewing deleted messages; the API exists (`GET /admin/chats/:id/messages?includeDeleted=1`).
- Firebase removed (2026-11-16): realtime is WebSocket only; local notifications while the app process is alive. Run `npm install` again in `server/` (firebase-admin gone). Release APK needs an HTTPS server URL (plain http is blocked in release builds).
- Backup: `server/backup/` nightly after `BACKUP_HOUR` (default 2, local time); `npm run backup` for a manual run. Decisions: simple 1-minute check instead of cron; local alerts only for a newly assigned bot task.
