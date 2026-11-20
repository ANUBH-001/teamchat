# CLAUDE.md: Team Chat (chat + tasks app)

> Project instructions for Claude Code. Keep this file short and current. Detailed findings live in `docs/AUDIT.md`.
> Claude: if anything here doesn't match the code (commands, paths, ports), fix this file in the same PR and tell me.

## Mission
Make this AI-generated chat + task app **production-grade**: correct, secure, tested and observable. It should be shippable without the owner testing by hand. Every change must be proven with tests and evidence.

## Stack & layout (verify and keep accurate)
- **Backend:** Node.js + Express (`server/`), entry `server/src/index.js`, realtime via the `ws` library (not Socket.IO) in `server/src/realtime.js`, MySQL via `mysql2` plain SQL (migrations `server/sql/migrate_*.sql`). Self-hosted Expo OTA update route in `server/src/routes/updates.js`.
- **App:** React Native / Expo (`app/`), Android APK. OTA updates are tied to `runtimeVersion` in `app/app.json`.
- **Prod:** single server, Apache reverse proxy on `/team_chat/` → Node, managed by PM2. **Jarvis** (a separate AI bot) runs on the same server.
- **Docs:** `docs/AUDIT.md` (audit + bug register, the source of truth), `docs/design/`, `docs/RUNBOOK.md`, `docs/TEST_REPORT.md`, `docs/issues/` (real user-reported issues and screenshots)

## Commands (verified 2026-11-20; lines marked TODO do not exist yet, they arrive in Phase 1)
```
# backend
cd server && npm ci
npm start                   # node src/index.js (reads server/.env)
npm test                    # node:test + supertest (today: updates traversal suite, no DB needed)
npm run dev                 # TODO
npm run test:coverage       # TODO
# local test DB (Docker)
# TODO: Docker/MySQL not installed on this machine yet
docker run -d --name team_chat_db -p 3307:3306 -e MYSQL_ROOT_PASSWORD=$TEST_DB_PASS -e MYSQL_DATABASE=team_chat_audit mysql:8
# app
cd app && npm ci
npx expo run:android        # dev build on emulator/device
npm test                    # TODO (jest + RNTL)
maestro test e2e/maestro/   # TODO: E2E flows on the connected emulator/device
# smoke against any env
scripts/smoke.sh <base-url>  # TODO
```

## Hard rules
1. **Production is hands-off without "approved".** No deploys, `pm2` actions, config edits, migrations, deletes or secret rotation on the server until the owner says "approved".
2. **Jarvis is strictly read-only.** Never modify, restart, install into or copy secrets from it.
3. **Never print or commit secrets.** When checking `.env` files, report only "present / missing". The repo is **public**: no personal paths, usernames, internal hostnames or credentials in any committed file.
4. **Tests never touch the prod DB.** Use the local `team_chat_audit` DB only.
5. **No faking.** No skipped tests, no mocking out the thing under test, no "should work". If something wasn't verified, say so.
6. **Ask before** anything that needs a new native build or Android permission, large new dependencies, or data-destructive schema changes.

## Workflow
- Branches: `hardening/<topic>`. Small atomic commits using Conventional Commits; reference IDs: `fix(socket): add heartbeat — closes A-03`.
- Each bug: **failing test → root-cause fix → passing test → commit → update the register in `docs/AUDIT.md`.**
- Priority: P0 → **R-xx (owner-reported real issues)** → P1 → P2 → P3.
- Refactor only with tests guarding behavior. Look hard at the large "Round" commits (especially `1ce7517`) when hunting regressions.
- Stop at 🛑 checkpoints. Report in the owner's language: what changed, evidence, risks, and numbered decisions with a recommendation for each.

## Security invariants (must always hold; each needs a test)
- Every file-serving path is resolved against a **constant root** and checked with `path.relative`. Input is decoded, then validated; `..` and absolute paths are rejected.
- Every REST route **and** socket event checks auth and conversation membership. Media is served only to members.
- No auth tokens in URLs (no `?t=`). Media uses short-lived signed URLs or headers.
- Logout revokes the token server-side and clears the local queue and cache.
- Secrets come from env only. Backups and `.env*` live outside every served directory. Dev and preview builds never default to the prod URL.

## Realtime invariants (each needs a test)
- Messages carry a client-generated ID. The server dedupes (unique constraint), so double taps and retries never duplicate.
- Server-assigned ordering. Catch-up after reconnect is cursor-paginated until complete (no 500 cap).
- The client heartbeat detects dead sockets after network changes and reconnects with backoff.
- The offline queue is race-free: a message is either delivered or visibly failed with a retry option, never stuck on "pending" or silently lost.
- A failed voice/photo upload keeps the local file and can be retried.
- DB and server use UTC; convert only at display time.

## Testing: definition of done
- Backend: unit + integration (supertest + a `ws` client; the server uses `ws`, not Socket.IO) against local MySQL, covering happy path, unauth, forbidden, invalid input and idempotency. Core services ≥ 80% coverage.
- App: Jest/RNTL for logic, **Maestro** flows on the Android emulator (two users when needed) and on the **real phone over USB** (`adb devices`; `adb reverse tcp:<port> tcp:<port>` for the local backend; the emulator uses `10.0.2.2`).
- Hardware flows (camera, mic/voice notes, gallery, permissions, notifications, Wi-Fi↔data) run on the real device, automated with Maestro/adb wherever possible. Collect anything that truly needs a human into one checklist and ask once.
- Evidence goes in `docs/test-reports/<date>/`: test output, screenshots (`adb exec-out screencap -p`), recordings (`adb shell screenrecord`), and filtered logcat with zero crashes.
- "Ready to ship" only after the release gate in `docs/TEST_REPORT.md` passes, including a **production-profile release APK** smoke-tested on the real device, and a clear OTA-vs-native statement.

## Known hotspots (from the Phase 0 audit; see `docs/AUDIT.md`)
- `server/src/routes/updates.js`: path traversal (P0, fixed on `hardening/p0-updates-traversal`, not deployed). Must stay fixed, with a regression suite.
- Token in media URLs (P1), offline queue race A-01 (P1), missing heartbeat A-03 (P1)
- `app/app.json` default server URL is prod (must be env/profile based)
- Dead code candidates: `app/src/push.ts` (Firebase removed), `TasksScreenLegacy.tsx`
- `.gitignore` gaps: fixed in `c9b94b0` (`backup/` was already ignored)