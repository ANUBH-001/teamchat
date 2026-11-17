# HANDOFF: read this first in any new Claude session / account

Project: WhatsApp-style team chat + AI task tracker for an 11-person team (Android only). Owner: Manish (writes Hindi/Hinglish; answer him in Hindi/Hinglish). Repo: https://github.com/ANUBH-001/teamchat (branch `main`; push ONLY there). Working dir: `d:\r&D\team-app` (the `&` in the path breaks Gradle/Metro: use the `subst` drive, see Run).
Docs: `ProjectContent.md` (idea + decisions), `projectProgess.md` (status), `backend.md` (all APIs, tables, privacy), `Frontend.md` (run, screens, how to collaborate), `PLAN.md` (original approved plan, partly historical). Project rules are in `CLAUDE.md`.

## Rules from the owner (must keep)
- **ZERO TESTING** unless he says so: do not write/run tests, start servers to test, run tsc/node --check. Build only. He allowed test passes earlier (last: 8a/8b and Phase 9 foreground service on 2026-11-17); they are finished. Voice speech accuracy is still untested.
- Local + Git only. **Deploy (Phase 7) only when he says.** Never commit `.env`, `.localdb/`, `server/backup/`, `app/android/`, APKs, Firebase files. Push only to `ANUBH-001/teamchat`.
- Keep it simple: Express + MySQL (`mysql2`, plain SQL) + Expo React Native. No Docker/ORM/monorepo tools. No Firebase (removed): realtime = WebSocket; notifications are local and need the app process alive, which the Phase 9 foreground service keeps (check-in reminders are scheduled local notifications).
- CEO mode (global `C:\Users\Manish\.claude\CLAUDE.md`): main session plans/delegates, light-worker (haiku) / standard-worker (sonnet) / heavy-thinker (opus) / Critical -> Fable. Tell every sub-agent "no tests". Update the docs after every phase/change and keep them concise (condense old details; target < ~150 lines per doc).
- Token rules: Grep/Glob before Read, read line ranges, Edit not rewrite, short replies, few agents.
- Commit trailer he asked for: `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>` (earlier agents used an Opus line; not rewritten, would need force push, needs his OK).

## State (2026-11-17)
Phases 0-6 DONE (setup, login phone+PIN+invite, chat, tasks, AI engine, backup, Git) and tested once. Extras DONE: voice mic (on-device speech recognition `expo-speech-recognition`, needs the dev build, not Expo Go), Phase 8a (swipe-to-reply, live updates, pull-to-refresh, paging), Phase 8b (private "Daily Check-in" chat per member: morning plan / evening work report, linked to tasks; boss reads silently in Admin -> Reports; settings; local reminders). 8a/8b tested 2026-11-17 (server, privacy, emulator UI, tab mic bar; 4 bugs fixed, see projectProgess.md). Local DB is migrated (005+006) and `server/.env` has `TZ=Asia/Kolkata`.
Phase 9 (2026-11-17) DONE + tested on the tab: foreground service "TeamChat connected" (local Expo module `app/modules/teamchat-service`, `src/background.ts`) keeps the socket alive in background/after swipe-away, boot restart, Account-tab "Background alerts" card. The new debug APK is installed on the tab (not the emulator). OnePlus MUST have App info -> Battery usage -> "Allow background activity", else the OS freezes the app at screen off (details in projectProgess.md).
**Phase 7a DONE 2026-11-17: backend deployed** at https://apps.landauditors.com/team_chat (PM2 `team-chat-backend`, port 3150, own MySQL DB, 2 boss users, mock AI). Full steps + update commands: `docs/DEPLOY.md`. Server login creds are in local `server/src/.env` (git-ignored, never print). Do not touch other apps on that server.
**Phase 7b DONE 2026-11-17: signed release APK** `d:&D\TeamChat-release.apk` (talks to the URL above, no PC/Metro; rebuild steps in `docs/DEPLOY.md` "Release APK"). Owner installs/tests it himself; old debug build must be uninstalled first (different signature).
**TODO:** put real AI key on server when owner agrees; replace the 11 placeholder users with real names/phones via Admin; optional: stop task events reaching the boss for check-in-driven task changes; testing when he asks.
**Migrations:** the local DB (port 3307) already has 005+006. Any other existing DB must run `server/sql/migrate_005.sql` then `migrate_006.sql` before the server starts; a fresh DB just uses `schema.sql`.

## Environment on this PC (Windows 11)
- Node v22. MySQL 8.4 is installed; the project uses its own instance: `powershell -ExecutionPolicy Bypass -File server/scripts/localdb-start.ps1` (127.0.0.1:3307, root, no password, data in `.localdb/`, git-ignored); stop with `localdb-stop.ps1`.
- Android toolchain installed by us on D:: JDK17 `D:\Android\jdk17`, SDK `D:\Android\Sdk` (adb in `platform-tools`), Gradle cache `D:\Android\gradle` (env vars ANDROID_HOME/JAVA_HOME set for new shells). AVD `teamchat_test` (Pixel 6, API 34): start with `server/scripts/emulator-start.ps1`.
- Real device: OnePlus Pad (model OPD2403, adb serial `de4eaf03`, "the tab") over USB with debugging on. ALWAYS target a device with `adb -s <serial>`; never touch the other one.
- AI: `server/.env` (git-ignored) has `AI_PROVIDER=anthropic`, `AI_MODEL=claude-haiku-5-5`, `AI_API_KEY` = the owner's Anthropic key (`sk-ant-...`). NEVER print/log/commit it. `server/src/.env` is an old copy (it has a wrong `AI_MODEL=Gemini-2.5-flash`; `src/env.js` fills only EMPTY keys from it). Without a key the `mock` keyword rules answer.

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
