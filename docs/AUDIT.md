# AUDIT: Team Chat (chat + tasks), Phase 0 and the bug register

> This file is the single source of truth for findings and their status. Last update: 2026-11-20.
> The repo is public. Server addresses, ports, IPs and incident logs go in `docs/private/` (git-ignored), never here.

## 1. Architecture

```mermaid
flowchart LR
  subgraph Phone["Android app (Expo SDK 52, RN 0.76, new arch)"]
    UI[Screens: Chats / Chat / Tasks / Admin] --> API[api.ts fetch + Bearer]
    UI --> RT[realtime.ts WebSocket]
    UI --> OB[outbox.ts offline text queue]
    UI --> VR[VoiceRecorder expo-av]
    FS[Foreground service + headless JS] --> RT
  end
  subgraph Server["Server (PM2 fork, 1 instance)"]
    AP[Apache /team_chat/ reverse proxy] --> EX[Express routes]
    AP --> WS[ws server realtime.js]
    EX --> DB[(MySQL, mysql2 plain SQL)]
    WS --> DB
    EX --> UP[uploads/ media]
    EX --> OTA[updates/ OTA bundles]
    JOBS[In-process schedulers: backup, check-ins, retention] --> DB
    EX --> AI[Gemini: AI replies + voice transcription]
  end
  API --> AP
  RT --> AP
```

- **Single process by design:** the rate limits, WebSocket client map, caches and schedulers all live in memory. Cluster mode would break them (B-26).
- **Auth:** phone + 4-digit PIN (bcrypt) issues an HS256 JWT valid 30 days. A session id gives single-device login. There is no refresh token.
- **Realtime:** ws with the token in the `Authorization` header (`?token=` fallback). The server pings every 30 s. The server dedupes messages on `(sender_id, client_id)`.

## 2. Git history
- 56 commits, one author. Four large "Round" commits (2k to 5k lines each) carry most of the risk; `1ce7517` (Round 4, 97 files) touches auth middleware, tasks, media and voice.
- Churn hotspots: `server/src/index.js`, `ai/provider.js`, `App.tsx`, `ChatScreen.tsx` (1177 lines), `AdminScreen.tsx`, `push.ts`, `routes/chats.js`.
- Secrets: no real `.env` and no key was ever committed (only `.env.example` placeholders). The local Windows user path was in docs; it was removed in `3d446b6` but is still in the old history.
- Dead code: `TasksScreenLegacy.tsx`, `TaskOverview`, `TaskBoard`, `StatusChips`, `useVoiceInput` / `VoiceBar`. `push.ts` is **not** dead: it holds the local notifications.

## 3. Requirements status (code reading plus owner reports)
✅ Working: login/activation, single session, onboarding, chats list and filters, DMs and groups, history paging, reply/quote, edit/delete (10 min), mentions, links, photos, @AI, bot task cards, admin panel, force update, OTA, theme.
⚠️ Partial: realtime (no client heartbeat, A-03); offline text queue (A-01, A-02, A-04); logout (A-05, A-06: fixed on hardening/media-auth); background alerts (A-03, A-08); in-chat search (loaded messages only).
❌ Broken (owner): task self-assign (R-01); voice recording (R-02, R-05).
🚫 Not implemented: change PIN, calls, offline media queue, admin view of deleted messages.

## 4. Bug and risk register

Priority: P0 → **R-xx (owner)** → P1 → P2 → P3. "OTA" means a JS-only change; "APK" means a new native build is needed.

| ID | Area | Description | Sev | Evidence | Status |
|---|---|---|---|---|---|
| B-01 | OTA route | Unauthenticated path traversal: `/updates/assets?runtimeVersion=..&asset=../.env` serves any file under `server/` | **P0** | `routes/updates.js:10,103-105` | **Fixed** on `hardening/p0-updates-traversal` (`ead90ba`, 19 tests). **Not deployed** (server work on hold). No exploitation found in logs. |
| R-01 | Tasks | Members cannot create a task, not even for themselves; the `membersCanAssign` toggle is ignored | P1 | `tasks.js:100-102` hard-codes `isBoss` (Round 4) | Fixed (server+app, tests) (branch hardening/integration, not deployed) |
| R-05 | Voice | Recorder freezes at 0:00; cancel, lock and delete do nothing | P1 | `VoiceRecorder.tsx:63-65,83-103`: while start is pending every exit only sets a flag; no watchdog | Fixed (recorderEngine, tests); verified on a real Android 16 tablet 2026-11-20 (cold-start first hold records) (branch hardening/integration, not deployed) |
| R-02 | Voice | Slow start; slide-cancel and slide-up lock unreliable; no live waveform | P1 | 4 native awaits per press; mic at the gesture-nav edge, scaled 1.35×; timer and wave depend on the status callback | Fixed (layout, clock timer, metering); verified on the real tablet 2026-11-20 (hold, slide-cancel, lock, pause, trash, send, short-tap toast, background discard) (branch hardening/integration, not deployed) |
| V-01 | Voice + AI | A task spoken (or typed) naturally by a member is silently ignored by the AI engine | P1 | `ai/engine.js` `if (!boss) return` | Fixed (same rules as R-01, ephemeral refusal) (branch hardening/integration, not deployed) |
| V-02 | Voice + AI | A failed transcription is silent and permanent ("Transcript nahi bana"), so the AI never sees the voice note | P1 | `routes/chats.js:473-497`, `ai/transcribe.js` | Fixed (reason codes, retry endpoint, startup requeue) (branch hardening/integration, not deployed) |
| V-04 | Voice UI | No retry for a failed transcript | P2 | `VoiceBubble.tsx` | Fixed (Dobara try karo) (branch hardening/integration, not deployed) |
| R-04 | Tasks UI | No self-task composer for members; rename "Mine" to "Me"; Keep-style grid | P2 | `TasksScreen.tsx:230,238,169` | Fixed (Keep checklist cards, Me tab, composer for all, done card both ways) (branch hardening/integration, not deployed) |
| R-03 | Chat UI | Command chips are always shown; the owner wants them only while typing | P3 | `ChatScreen.tsx:876` | Fixed (focused + keyboard) (branch hardening/integration, not deployed) |
| R-06 | Tasks | Task permission rule (owner, 2026-11-20): marking a task done/undone (any status change) = ONLY its assignee or an admin; deleting (close/reopen) = ONLY an admin. Today the creator could close and reopen; the creator who is not the assignee still cannot tick | P1 | `tasks.js` `canClose` (boss or creator); status already assignee-or-boss | Fixed (server `canClose` = boss only, so REST, slash commands and the AI engine all follow; app hides the Close/Reopen buttons and the all-people status row for non-admins; tests `task-status-perms.test.js`, `taskPermissions.test.ts`) (branch hardening/english-nodue, not deployed) |
| R-07 | Tasks | Task due date removed from the whole product (create/edit UI, Keep cards, Me tab buckets, sorting, overdue counts, notifications, bot cards, AI `create_task` schema and prompt, `/due`, API fields `dueDate`/`dueAt`/`hasTime`/`overdue`) | P2 | `tasks.js`, `ai/*`, `app/src/*` | Fixed (a `dueDate` sent by an old APK is ignored, never an error; PATCH with only `dueDate` = 200 no-op; `ai/dueTime.js` deleted; dead legacy Tasks screen/board/overview deleted). **The `tasks.due_at` column is kept** (no destructive schema change): it is simply no longer read or written. Old `due` rows in `task_events` still render as a generic line. Test `no-due-english.test.js` (branch hardening/english-nodue, not deployed) |
| R-08 | UI text | Every user-facing string in English (owner, 2026-11-20): app screens, toasts, alerts, push/notification text, bot/system cards, server errors, check-in texts, command help, and the AI replies. The AI prompts still tell Gemini to UNDERSTAND Hindi/Hinglish (voice notes, "Anubhav, tumhe team app banani hai, ye task assign kar raha hun") but to write titles and answers in English. Input vocabulary (name aliases, `khud`/`ko` filler words, keyword prefilters, mock-rule regexes) stays Hindi/Hinglish on purpose | P2 | `app/src/*`, `server/src/*` | Fixed (tests: guard scans in `no-due-english.test.js` and `taskPermissions.test.ts`; the mock rules (AI off) cannot translate, so a task title made by them keeps the user's own words) (branch hardening/english-nodue, not deployed) |
| R-09 | Voice | "Recording play nahi ho rahi" (owner): a voice note sometimes does nothing on Play until the chat is reopened | P1 | `VoiceBubble.tsx` (device: tablet 2026-11-20, a long-running session; emulator: Play during an incoming call). expo-av (Android) resolves `Sound.createAsync` with a loaded but SILENT sound when audio focus is refused (call ringing, another app, its own "app paused" flag) and reports stream errors only as a status `{isLoaded:false, error}`; the bubble ignored both and kept the dead sound, so every later tap returned early. The signed-URL TTL was checked and is NOT the cause: each load signs a fresh URL and ExoPlayer buffers a whole note (2:10 note fully buffered) | Fixed: `voicePlayer.ts` state machine (explicit `playAsync`, unload on any failure, one retry from the same position with a FORCE re-signed URL, error toast "Couldn't play this voice note. Tap play to try again.", one note at a time with a race-safe swap, pause on app background, `staysActiveInBackground` so expo-av's paused flag cannot block focus); `signedMediaUrl(path, force)`; 13 + 1 jest tests; verified on the tablet incl. replay after a 60 s URL TTL (OTA). Commit 245c64c (its message says R-06; the register ID is R-09 because R-06 was taken on hardening/english-nodue) (branch hardening/checkin-playback, not deployed) |
| C-01 | Check-in | Morning card (owner): show my tasks as cards and ask "which will you work on today, or something new?" | P2 | `checkins.js` 'day' card was a plain list | Done: briefing card (status pill, title, "Today" toggle, reply box "Anything new you'll work on?"); picks via `POST /checkins/picks` stored in today's morning `checkins` row (`payload.selectedTaskIds`, no new table); card live-refreshed (OTA + server) (branch hardening/checkin-playback, not deployed) |
| C-02 | Check-in | Evening card (owner): tasks with a tick "if any got done, tick it" + today's report | P2 | 'signoff' card used the MyDay form + quiet `source:'checkin'` updates (admin not alerted) | Done: Done checkbox = normal `PATCH /tasks/:id` (assignee-or-admin rule, admin gets the usual completed alert); reply box "Today's report…" posts a normal message (stored as the evening check-in text, AI task detection runs) (branch hardening/checkin-playback, not deployed) |
| C-03 | Check-in | Admins never got a check-in overview (pull-only Reports) | P2 | `checkins.js` | Done: one live 'summary' card per admin per day at `summaryTime` (setting, default 20:30) in the admin's own private check-in chat (admin + bot): replied / Today picks / done today / morning note / report; quiet notification; `POST /admin/jobs/run {job:'summary'}` (branch hardening/checkin-playback, not deployed) |
| C-04 | Check-in | A missed morning card was posted late at night after a restart ("good morning" at 19:00) | P3 | `checkins.js` `tick()` | Fixed: catch-up only inside the slot window (morning card only before eveningTime); `tick(at)` testable; idempotency via `checkin_prompts` claim tested (branch hardening/checkin-playback, not deployed) |
| C-05 | AI | English "I'll also do X" in the check-in chat was ignored (Hinglish-only pre-filter) and a nameless task there asked "who should get this?" | P2 | `ai/engine.js` `TASK_RE`, assignee fallback only for DMs | Fixed: English intent words in the pre-filter; a nameless task in your own check-in chat is a self-task (same self-task rule); test (branch hardening/checkin-playback, not deployed) |
| A-01 | Outbox | Concurrent read-modify-write in AsyncStorage can lose a queued message (stuck "pending") | P1 | `outbox.ts:30-53` | Fixed (mutex queue, tests) (branch hardening/integration, not deployed) |
| A-03 | Realtime | No client heartbeat: dead socket after a network change, no reconnect | P1 | `realtime.ts:45-79` | Fixed (ping/pong both sides, tests) (branch hardening/integration, not deployed) |
| A-07 / B-02 | Auth | 30-day JWT sent in media URLs (`?t=`) and the WS fallback (`?token=`), so it lands in proxy logs and the image cache | P1 | `media.ts:43-47`, `routes/media.js:26-29` | Fixed for media: `POST /media/sign` HMAC URLs (30 min, user + path bound), app never puts the JWT in a URL; `?t=` kept behind `MEDIA_ALLOW_TOKEN_QUERY` (default on) until old APKs are gone. WS `?token=` fallback still open (branch hardening/media-auth, not deployed; needs migrate_011) |
| A-02 | Outbox | A message queued during a flush waits up to 15 s | P2 | `outbox.ts:42-46` | Fixed (branch hardening/integration, not deployed) |
| A-04 | Outbox | Drops items on any 4xx (including 426) with no feedback | P2 | `outbox.ts:55-57` | Fixed (failed bubble + Retry/Delete) (branch hardening/integration, not deployed) |
| A-05 | Auth | Logout does not revoke the token on the server | P2 | `auth.tsx:29-34` | Fixed: `POST /auth/logout` rotates session_id (old JWT 401 / ws refused, live sockets 4401); app calls it after stopping the socket (branch hardening/media-auth, not deployed; needs migrate_011) |
| A-06 | Privacy | Logout leaves the outbox, stars and task cache for the next user | P2 | `background.ts`, `outbox.ts`, `taskCache.ts` | Fixed: `userData.clearUserData()` on logout / kick (outboxes + voice files, stars, caches, people, bgUserId/bgRole, signed URLs, expo-image cache). Device test found two more leaks, fixed: the OkHttp disk cache kept API JSON (chats, tasks, people) because the server sent only an ETag → server now sends `Cache-Control: no-store` on every API route, and logout deletes the cache entries plus the ImagePicker / ImageManipulator photo copies (`deviceCaches.ts`) (branch hardening/integration, not deployed) |
| A-25 | Outbox UI | A message the server rejected showed red `✓✓` (reads as delivered); Retry/Delete only via long-press | P2 | `Tick.tsx`, `Bubble.tsx` (device test 2026-11-20) | Fixed: "⚠ Nahi gaya · tap = retry", a tap opens Retry / Delete (OTA) (branch hardening/integration, not deployed) |
| A-26 | Voice | A voice note recorded offline stayed "Nahi gaya" after the network returned until Retry was tapped (text flushes by itself) | P2 | `voiceOutbox.ts`, `ChatScreen.tsx` (device test 2026-11-20) | Fixed: `retryVoiceOutbox()` on reconnect / app active, and from the 15 s timer at most once a minute (OTA) (branch hardening/integration, not deployed) |
| A-08 / B-06 | Sync | Edits, deletes, reactions and pins missed while offline are never caught up | P2 | `chats.js:381` | Open |
| A-09 | Realtime | A stop/start race can open two sockets (duplicate notifications) | P2 | `realtime.ts:45-93` | Fixed (generation counter) (branch hardening/integration, not deployed) |
| A-10 | Composer | A double tap on Send sends the same text twice | P2 | `ChatScreen.tsx:127,348` | Fixed (send guard) (branch hardening/integration, not deployed) |
| A-12 | Voice | A failed upload loses the recording | P2 | `ChatScreen.tsx:503-521` | Fixed (voice outbox, persisted) (branch hardening/integration, not deployed) |
| A-21 | Config | `app.json` defaults to the production URL in every build | P2 | `app.json:9,77`, `config.ts` | Open |
| B-03 | Media | Any logged-in user can fetch any media file (no membership check) | P2 | `routes/media.js:77-87` | Fixed: uploader (`media_files`), any profile photo, or a reader of a message carrying it (member, not deleted unless boss; boss non-check-in chats); checked at sign time and on header / `?t=` GETs; messages / avatars can only reference files the sender may see (branch hardening/media-auth, not deployed; needs migrate_011) |
| B-04 | Privacy | Purged data survives in `backup/purge-*.json` etc. forever | P2 | `jobs.js:29-36` | Open (server; on hold) |
| B-05 | Sync | Catch-up `?after=` capped at 500 with no `hasMore` | P2 | `chats.js:380-382` | Fixed (hasMore) (branch hardening/integration, not deployed) |
| B-07 | Ops | No graceful shutdown; voice transcripts stay "pending" forever after a restart | P2 | `index.js` | Open |
| B-08 | Time | The DB session time zone is implicit (assumes MySQL TZ = Node TZ) | P2 | `db.js:3-10` | Open (verify on server later) |
| B-09 | Abuse | No rate limit on messages, uploads, AI calls or typing | P2 | `chats.js:498`, `media.js:48` | Open |
| B-10 | Secrets | Local `server/src/.env` holds server SSH credentials | P2 | `.gitignore`, local file | Open (owner: move to a password manager or keys) |
| A-11, A-13 to A-24 | App | Media retry duplicates, expo-av deprecated (APK), 500-row gap, token fallback, clock skew, regexes, APK URL check, perf, image cache, silent catches, dead code | P3 | see `docs/private/phase0-reports.md` | Open |
| B-11 to B-27 (except B-12, B-15, B-21) | Server | Upload type check, forged quotes, avatar from any file, task edit race, task paging, PIN lockout, phone-number privacy, boss reads DMs (disclose), new members see old history, delivered ticks, backup blocking, single-process assumptions, migration ledger | P3 | see `docs/private/phase0-reports.md` | Open |
| B-12, B-15, B-21 | Server | WS maxPayload 100 MiB; invite activation race; no JSON error handler | P3 | `realtime.js:106`, `auth.js:77-82`, `index.js` | Fixed (maxPayload 64 KiB + ws error handler, atomic invite claim, JSON errors) (branch hardening/integration, not deployed) |

Checked and fine: parameterized SQL everywhere, bcrypt PINs with a timing-safe dummy compare, HS256 pinned, membership checks on every chat route and WS event, `/media/f` path containment, message dedupe constraint, `npm audit` (server) clean.

## 5. Security (summary)
- B-01 was the only P0. It is fixed in code, with no sign of exploitation; deploy and rotation are on hold until the owner says so.
- Server hardening items found during the investigation (firewall, SSH configuration) are recorded in `docs/private/` and are on hold with the rest of the server work.
- The app has 31 npm audit findings (1 critical) in transitive Expo/RN dev tooling; triage is pending.

## 6. Tests and testability
- Before the audit: 0 tests. Now: server `npm test` (node:test + supertest; traversal suite 19/19), app `npm test` (jest-expo + RNTL) and `npm run typecheck` (0 errors), CI in `.github/workflows/ci.yml`.
- Blockers being removed: `index.js` listens and starts schedulers on import (refactor to `createApp()` in progress); module-level singletons; prod URL as the default; no testIDs.

## 7. Recording (from the read-only study of the separate recording reference)
Our app already has voice notes. The gap analysis says to borrow: a race-safe recorder state machine (sequence token, one idempotent cleanup, stop never hangs), a clock-based timer, tap mode with Cancel/Pause/Send, max-length with countdown, retry that keeps the file, magic-byte type checks and clear mic-error messages. All of these are JS-only (OTA). Background recording and moving to `expo-audio` need a **new APK**: ask the owner first. Not to copy: a permissive CORS setup, whole uploads in RAM, trusting the duration from the client, and having no retention policy.

## 8. Roadmap (local first; server work on hold by owner, 2026-11-20)
1. ✅ P0 fix in code. 2. ✅ Test harness and CI. 3. ⏳ R-01 to R-05 + A-01, A-02, A-03, A-04, A-09, A-10, A-12, B-05, B-12, B-15, B-21 (three parallel branches). 4. Emulator and real-device verification with evidence. 5. A-07/B-02/B-03 signed media URLs, A-05/A-06 logout, A-21 env profiles. 6. Remaining P2/P3. 7. On the owner's "approved": deploy, secret rotation and server hardening.

## 9. Open questions for the owner
1. R-04: send a Google Keep reference screenshot for the "identical" look.
2. Should the repo be made private? (Old history has a personal path.)
3. Server-side items are on hold: hotfix deploy, rotation, firewall and SSH.
