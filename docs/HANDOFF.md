# HANDOFF: read this first in any new Claude session / account

Project: WhatsApp-style team chat + AI task tracker for an 11-person team (Android only). Owner: Manish (writes Hindi/Hinglish; answer him in Hindi/Hinglish). Repo: https://github.com/ANUBH-001/teamchat (branch `main`; push ONLY there). Working dir: `d:\r&D\team-app` (the `&` in the path breaks Gradle/Metro: use the `subst` drive, see Run).
Docs: `ProjectContent.md` (idea + decisions), `projectProgess.md` (status), `backend.md` (all APIs, tables, privacy), `Frontend.md` (run, screens, how to collaborate), `PLAN.md` (original approved plan, partly historical). Project rules are in `CLAUDE.md`.

## Rules from the owner (must keep)
- **ZERO TESTING** unless he says so: do not write/run tests, start servers to test, run tsc/node --check. Build only. Earlier test passes are finished. The 2026-11-17 feedback round had a testing allowance (E2E 59/59 + emulator UI) for THAT ROUND ONLY; it is over, back to zero testing. Voice speech accuracy is still untested.
- Local + Git only. **Deploy (Phase 7) only when he says.** Never commit `.env`, `.localdb/`, `server/backup/`, `app/android/`, APKs, Firebase files. Push only to `ANUBH-001/teamchat`.
- Keep it simple: Express + MySQL (`mysql2`, plain SQL) + Expo React Native. No Docker/ORM/monorepo tools. No Firebase (removed): realtime = WebSocket; notifications are local and need the app process alive, which the Phase 9 foreground service keeps (check-in reminders are scheduled local notifications).
- CEO mode (global `C:\Users\Manish\.claude\CLAUDE.md`): main session plans/delegates, light-worker (haiku) / standard-worker (sonnet) / heavy-thinker (opus) / Critical -> Fable. Tell every sub-agent "no tests". Update the docs after every phase/change and keep them concise (condense old details; target < ~150 lines per doc).
- Token rules: Grep/Glob before Read, read line ranges, Edit not rewrite, short replies, few agents.
- Commit trailer he asked for: `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>` (earlier agents used an Opus line; not rewritten, would need force push, needs his OK).

## State (2026-11-18)
- **Round 3 DEPLOYED 2026-11-19** (approved; pushed 599a2f6; migrate_009 on prod; APK 0.4.0 uploaded; latest = min = 4, forced update; tested locally: backend 237/237, regressions 100%, emulator UI; 9 bugs fixed): multi-assignee tasks (task_assignees, per-person status, aggregate), statuses todo/planning/coding/testing/change_merged/done + closed (delete -> close), member visibility (Mine / Everyone brief), message <-> task links (cards attached under the source, reply-chain / #N notes, edit propagation, timeline sources), emoji avatars + rename (unique names, 409), one login per user (session_id / sv; 4409), rate limits, chat info for all chats, DM task sheet, /ask banner + Reply action, bug 1 ("Me (khud)" in pickers). App 0.4.0 / versionCode 4. migrate_009 applied LOCALLY only (dump before it: scratchpad of the build session). Deploy: DEPLOY.md "Round 3" (min version 4 = forced update). Details: projectProgess.md, backend.md, Frontend.md.
- **Round 2 DEPLOYED 2026-11-18** (approved, pushed 0db6464, migrate_008 on prod, retention ON, prod data reset to fresh on owner's request (users kept), APK 0.3.0 uploaded, latest=3, min=0; raise min to 3 once everyone updated; see DEPLOY.md). Test round now over: person picker + mentionIds (fixes the two-"Rishit" prod bug), composer `/` `@` helpers, /ask /desc, card replies, edit/delete 10 min, retention jobs (hard delete, ON by default), check-in rework (10:00 pinned tasks card, 18:00 sign-off), admin reset, app 0.3.0 / versionCode 3. migrate_008 applied locally only. Details: projectProgess.md, backend.md.
- Phases 0-9 DONE and tested (list + details: projectProgess.md). Phase 8a/8b = swipe-reply, live lists, daily check-ins; Phase 9 = foreground service keeps the socket alive (OnePlus needs "Allow background activity").
- **Phase 7a** backend live at https://apps.landauditors.com/team_chat (PM2 `team-chat-backend`, port 3150). Server creds are in local `server/src/.env` (git-ignored, never print). Update steps: `docs/DEPLOY.md`. Do not touch other apps on that server.
- **Phase 7b** release APK v1 at `d:\r&D\TeamChat-release.apk` (owner installs it himself; uninstall the debug build first, different signature).
- **Feedback round (2026-11-17) DONE: approved, pushed, deployed (migrate_007, AI anthropic live), release APK 0.2.0 at `d:\r&D\TeamChat-0.2.0.apk` + server download URL. Min version still 0 (raise to 2 in Settings once everyone updated).** Slash commands are the primary way to use the bot (AI is secondary); Testing status; group members + Group Info; Tasks Overview/Board/List + Task Detail; praise; per-user bubble colors; Admin Settings screen (AI + command switches, per-group bot, app update fields, Test AI); long-press menu, @mentions, pinned bar, mute/pin chats; force update (app 0.2.0 / versionCode 2, `X-App-Version`, GET /app/version, server 426 `UPDATE_REQUIRED`).
- Round checks: multi-user E2E 59/59 pass; emulator UI as boss and member (light + dark). Owner approved the UI.
- **Next, in order:** owner approves UI -> git push (main only) -> rebuild release APK (new native dep `expo-clipboard`, so the dev build also needs a rebuild; until then "Copy" falls back to the share sheet) -> deploy per DEPLOY.md.
- **Owner TODO:** real AI key on the server (only when he agrees); replace the 11 placeholder users with real names/phones via Admin.
- **Migrations:** local DB (3307) has 005-009. Existing DBs run missing files in order (005 -> 006 -> 007) before the server starts; fresh DB = `schema.sql`. `migrate_007.sql` has no `USE` line, so pass the DB name: `mysql -h 127.0.0.1 -P 3307 -u root teamchat < server/sql/migrate_007.sql`. Prod (`team_chat_db`): 007 still to run.
- **env.js fix:** a key already set in `server/.env` (even empty) is no longer overwritten by the old `server/src/.env` copy.

## Environment on this PC (Windows 11)
- Node v22. MySQL 8.4 is installed; the project uses its own instance: `powershell -ExecutionPolicy Bypass -File server/scripts/localdb-start.ps1` (127.0.0.1:3307, root, no password, data in `.localdb/`, git-ignored); stop with `localdb-stop.ps1`.
- Android toolchain installed by us on D:: JDK17 `D:\Android\jdk17`, SDK `D:\Android\Sdk` (adb in `platform-tools`), Gradle cache `D:\Android\gradle` (env vars ANDROID_HOME/JAVA_HOME set for new shells). AVD `teamchat_test` (Pixel 6, API 34): start with `server/scripts/emulator-start.ps1`.
- Real device: OnePlus Pad (model OPD2403, adb serial `de4eaf03`, "the tab") over USB with debugging on. ALWAYS target a device with `adb -s <serial>`; never touch the other one.
- AI: `server/.env` (git-ignored) has `AI_PROVIDER=anthropic`, `AI_MODEL=claude-haiku-5-5`, `AI_API_KEY` = the owner's Anthropic key (`sk-ant-...`). NEVER print/log/commit it. `server/src/.env` is an old copy (it has a wrong `AI_MODEL=Gemini-2.5-flash`; `src/env.js` fills only keys that `server/.env` does not define). Without a key the `mock` keyword rules answer.

## Run (local)
1. DB: `localdb-start.ps1`, apply migrations if needed.  2. Server: `cd server; npm start` (PORT 3000; `npm run seed` once prints invite codes).
3. App JS server (Metro): `subst T: "D:\r&D\team-app"` (if T: is missing), then `cd T:\app` and `EXPO_PUBLIC_SERVER_URL=http://localhost:3000 npx expo start --dev-client --localhost --port 8081`.
4. Per device: `adb -s <serial> reverse tcp:3000 tcp:3000` and `reverse tcp:8081 tcp:8081`, then open the "TeamChat" dev-build app (package `com.teamchat.app`). Emulator default server URL is `http://10.0.2.2:3000`. The dev build is already installed on the emulator and the tab; it loads JS from Metro. Rebuild the native APK only if a native dependency changes (`app/android` is generated and git-ignored; build from `T:\app`, ~15 min first time; APK at `app/android/app/build/outputs/apk/debug/app-debug.apk`).
5. Expo Go is also on the tab (no voice there; mic is hidden).
Logs of the last session: `d:\r&D\tc-server.log`, `d:\r&D\tc-expo.log` (outside the repo).

## Dummy local accounts (local DB only, all PIN 1234 once activated)
Rishit (boss) 9000000004; Anubhav 9000000001; Arushit 9000000002; Tushar 9000000003; Member 5 9000000005. Others need an invite code from `npm run seed` or Admin -> reset PIN. Login = phone + PIN; the name comes from the DB (set by the boss); PIN is chosen by each user at activation with the invite code.

## Gotchas learned
- A stale Metro cannot see new files: restart it. Expo SDK 52 / RN 0.76; react-navigation versions pinned to SDK 52.
- `adb devices` shows both the emulator and the tab: wrong `-s` hits the wrong device.
- Release APK blocks plain `http://`: deploy needs HTTPS.
- Check-in reminder times use the phone's clock: phones should be on IST.
- The tab has a screen-lock PIN: pressing power (`input keyevent 26`) locks it and adb cannot unlock; do UI steps before screen-off tests. adb server can hang: kill adb.exe and `adb start-server`.
- Clipboard: `expo-clipboard` needs a native rebuild: the emulator dev build was rebuilt 2026-11-18 (Copy works); the tab's dev build still falls back to the share sheet.
