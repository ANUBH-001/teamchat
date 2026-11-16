# Plan: Team Chat + AI Task Tracker (Android, WhatsApp-style, SIMPLE)

> **RULE (absolute): NO testing. Never write, run or set up tests of any kind unless Manish explicitly says so.** Agent only BUILDS. Holds in CEO mode and for every sub-agent (put "no tests" in each agent prompt). Overrides any "write/run tests" routing in CLAUDE.md.

## 1. Goal
WhatsApp-like team chat for 11 people (Indian numbers), Android only. The chat manages tasks automatically:
- Boss: "Anubhav ko X, Tushar ko Y" -> tasks auto-assigned.
- Member: "mera X ho gaya" -> task auto-marked done.
- Anyone: "mere task kya hain?" -> bullet summary (done / doing / pending).
- Tasks tab with filters: per person, per status, counts.
- All history kept forever (deleted = hidden only). Works from anywhere (not just office Wi-Fi).
Build locally first; hosting later on user's own server. New project at `d:\r&D\team-app\`.

## 2. Stack (kept minimal, no extra tools)
| Part | Choice |
|---|---|
| App | React Native + Expo (TypeScript), Android APK |
| Server | Node.js + Express (JavaScript/TypeScript), plain REST + WebSocket (`ws`/Socket.IO) |
| Database | **MySQL** (user has it) via `mysql2`, plain SQL, no ORM |
| Login | Phone number + PIN (no SMS OTP, no cost). Boss adds members; member gets invite code, sets PIN once, stays logged in |
| AI | One small file with a swappable provider (OpenAI/Gemini); key in server `.env` only. Fake provider until key arrives |
| Push (app closed) | FCM, added last, optional |
No Docker, no monorepo tooling, no ORM, no extra frameworks. Two folders: `server/` and `app/`.

## 3. Where chat data lives
**MySQL is the single source of truth** (reliable with 11 people writing at once; JSON files can corrupt/overwrite under simultaneous writes). For safety/portability: nightly **JSON export** of all messages and tasks into `server/backup/YYYY-MM-DD.json`. Nothing is ever hard-deleted (`deleted_at` column), edits keep old text.

Tables: `users`, `invites`, `chats`, `chat_members`, `messages`, `tasks`, `task_events` (audit/undo), `push_tokens`.

## 4. AI task engine
Each new message goes to the AI with: message, sender (name/role), chat members, open tasks. AI answers only with a tool call: `create_task` (boss only), `complete_task` / `update_task` (own tasks; boss any), `list_tasks`, or `none`.
Server checks permissions and that the task really belongs to that person. If unclear -> bot asks instead of guessing. Every action shows as a bot card with **Undo** and is logged in `task_events`. Hindi/English/Hinglish names handled in the prompt. AI called only for task-looking messages (saves cost).

## 5. UI: WhatsApp-like
- Green top bar; tabs **Chats | Tasks | Admin (boss only)**. Light + dark theme.
- Chat list: avatar, last message, time, unread badge, "All Team" pinned, search, new-group button.
- Chat screen: green outgoing / white incoming bubbles, sender name in groups, ticks (sent/delivered/read), date separators, typing indicator, swipe-to-reply, long-press menu, delete shows "This message was deleted" (kept in DB).
- Create group: pick members -> name -> create. "All Team" has all 11; custom groups only visible to their members. DMs too.
- Bot appears as "Team Assistant": task cards + Undo, summary as bullet bubble.
- Tasks tab: filter chips (All / person / Todo / Doing / Done) with counts.
- Admin: add/remove members, give invite code, reset PIN, view deleted messages.
- Use `react-native-gifted-chat` with one `theme.ts` and a few shared components (Avatar, ChatRow, Bubble, Tick). Not in v1: calls, status, media/voice notes.

## 6. Must-haves (simple versions)
- **Works remotely:** server URL in app config; server on a public HTTPS domain (set up at deploy). Until then same Wi-Fi.
- **Bad network:** auto-reconnect, fetch missed messages on reconnect, unsent messages queue and send later.
- **Security basics:** PIN hashed (bcrypt), lockout after wrong tries, session token, only boss-added numbers can log in, API key never in app.

## 7. Build phases (build only, no testing; one phase at a time)
| Phase | What | Est. |
|---|---|---|
| 0 | Folders, MySQL schema, Express server, Expo app skeleton, seed 11 users + All Team | 0.5 day |
| 1 | Login (phone + PIN + invite), Admin add members | 1 day |
| 2 | WhatsApp UI + chat: groups/DMs, realtime, history, soft delete | 2 days |
| 3 | Tasks tab, filters, counts, My Tasks | 1 day |
| 4 | AI engine: assign / complete / summary / undo | 1.5 days |
| 5 | Reconnect + offline queue, nightly JSON backup, FCM push | 1 day |
| 6 | **Git:** after the app is built, `git init`, `.gitignore` (.env, node_modules, backup/, APK), first commit, push to the user's remote (repo URL from user; nothing pushed without his go-ahead) | 0.25 day |
| 7 | **Deploy** (only after Git step, only when user says): Release APK + deploy on user's server | 0.5 day |
Order is fixed: Build -> Git -> Deploy. Total about **5-7 days**. 1-day MVP = phases 0-1 trimmed + All Team chat + AI assign/complete + My Tasks, local only.

## 7a. Who builds: agents (CEO mode)
CEO (main session) plans, delegates, reads each result and reports; building is done by agents, one phase at a time, few agents (no fan-out), each prompt says "no tests":
| Phase | Agent |
|---|---|
| 0 setup, 2 UI/chat, 3 tasks tab, 5 offline/backup/push | `standard-worker` (sonnet) |
| 1 login/PIN security, 4 AI engine (prompt + permission checks) | `heavy-thinker` (opus) designs, `standard-worker` implements |
| 6 Git (no secrets, ask before push) | `light-worker` (haiku) or CEO directly |
| 7 deploy plan, final security review | Fable (critical tier) |
Each agent gets a narrow task + file list from the plan section it needs, not the whole plan.

## 8. Project CLAUDE.md (create at d:\r&D\team-app\CLAUDE.md after approval)
```
# Team Chat + AI Task Tracker (Android, WhatsApp-style)
Plan: C:\Users\Manish\.claude\plans\pasted-content-id-0595-joyful-frost.md (read only the section you need)

## Rules
- ZERO TESTING: never write/run/set up tests unless Manish says so. Agent only BUILDS. Tell every sub-agent "no tests".
- Keep it SIMPLE: Express + MySQL (mysql2, plain SQL) + Expo RN. No Docker, ORM, monorepo tools, extra frameworks.
- Order: build -> Git (only when told; never commit .env/secrets; ask before push) -> deploy (only when told). Local build only until then.
- AI keys only in server .env. Soft delete only (deleted_at).

## Token rules
- Grep/Glob before Read; read line ranges; never re-read a file just edited. Use Edit, not rewrites.
- Short replies; no repeating the plan. Limit long command output (head/tail).
- No web search, no unrelated files, no extra docs unless asked.
- Trivial tasks: do directly. Few agents, narrow task + file list each.
- One phase at a time; report in 3-5 lines.
- Model routing is in global CLAUDE.md (Critical tier -> Fable).
```

## 9. First actions after approval
1. Edit `C:\Users\Manish\.claude\CLAUDE.md`: add Critical tier -> Fable (Agent `model: "fable"`) for prod deploy plan, security review, final AI design, hard debugging. Fable only when truly needed.
2. Create project folder + the CLAUDE.md above, then start Phase 0.

## 11. NEW FEATURE: Daily check-ins (morning plan + evening work report), admin sees silently
**Goal (user):** every day, each member gets a personal message from the assistant: morning = "aaj aapke tasks / kya plan hai", evening = "work report do". Member replies; replies reach the admin WITHOUT any notification to the admin; admin can read them whenever he wants.

**Decisions (taken by me; user can change at the end):**
- Each member has a private **"Daily Check-in" chat** (chat type `checkin`, members = that member + Team Assistant bot). Other members and the boss are NOT members of it, so it never shows in anyone else's chat list, never creates unread badges, WebSocket events or local notifications for the boss.
- **Scheduler** (server, 1-minute tick like backup.js; timezone from env `TZ`, default Asia/Kolkata; idempotent per user/date/kind):
  - Morning (default 10:00, Mon-Sat): bot posts "Good morning <name>! Aaj ke open tasks: <list>. Aaj ka plan kya hai?".
  - Evening (default 18:30, Mon-Sat): bot posts "Aaj ka work report bhejiye: kya kiya, kya pending, koi dikkat?".
  - One gentle nudge to the member only if no reply after 2 hours. Boss himself gets no check-in.
  - Times/days/on-off editable by boss in Admin (table `app_settings`).
- **Member reply** (typed or with the new mic) is saved as a `checkins` row (user, date, kind morning|evening, text, AI short bullet summary done / pending / blockers, message_id). Editable until midnight (old text kept in revisions). The existing AI engine also runs on the reply, so "site delete ho gayi" completes that task and the card appears in the private chat. One cheap AI call per report for the summary; if AI fails the raw text is still stored.
- **Admin reads silently:** new Admin sub-screen **Reports**: pick date (default today) -> list of members with status (morning plan: submitted/missing, evening report: submitted/missing) -> tap a member to read plan + report + summary; also member history view (last 7/30 days). Pull-only: no push, no badge, no sound for the boss. Boss-only endpoints (403 for members).
- **Transparency:** the check-in chat header shows a small line "Aapke reports admin dekh sakte hain" so members know (decided on purpose; remove only if the user says so).
- **Reminders on the phone without Firebase:** app schedules **local daily notifications** with expo-notifications (morning/evening times fetched from server settings at login) so the member is reminded even when the app is closed; they open the app, see the bot message in the check-in chat.

**Data/API (new, additive):**
- sql: `chats.type` add `checkin`; tables `checkins`, `app_settings`; migrate_005.sql + schema.sql.
- Server: `src/checkins.js` (scheduler + save/summary logic), `routes/checkins.js`: member `GET /checkins/today`, `GET /checkins/mine?from&to`; boss-only `GET /admin/checkins?date=`, `GET /admin/checkins/user/:id?from&to`, `GET/PUT /admin/settings`. Reuse: bot.js (Team Assistant), engine.js, routes/chats.js message posting, realtime.js (deliver only to chat members), tasks.js listTasks, backup.js (scheduler pattern + include checkins in JSON export).
- Make sure: `GET /chats` excludes other people's check-in chats for everyone (incl. boss); boss's existing `/admin/chats/:id/messages` is not used to read them (dedicated Reports endpoints only); ws/ticks/unread/local-notification code ignores check-in chats for non-members.
- App: check-in chat appears in the member's Chats list as pinned "Daily Check-in"; Admin tab gets **Reports** screen (date picker, status rows, detail view); Settings card (times/days/on-off); local notification scheduling in `app/src/push.ts`; mic works inside the check-in chat as usual.
- Docs: update backend.md, Frontend.md, projectProgess.md (Phase 6b) concisely.

**Who builds:** `heavy-thinker` for the server (privacy/permission rules + scheduler), `standard-worker` for app screens. One phase at a time, report in 3-5 lines.
**Testing:** none unless the user asks (default rule). Acceptance checklist for later: member gets morning/evening bot message at the set time; reply is stored with summary; boss gets NO notification/badge but sees it in Reports; another member/boss cannot see the check-in chat in Chats; missed report shows "missing"; local reminder fires with app closed.
**Estimate:** about 1.5 days.

## 11b. Additions from user (latest) - continue from the finished work, BUILD ONLY, NO TESTING
Everything done so far (phases 0-6, voice, phone/tab run) stays as is. New work, in this order (one phase at a time, short report after each):
- **Phase 8a: UI improvements** (standard-worker, app only)
  - **Swipe-to-reply like WhatsApp:** swipe a bubble right to reply; reply preview bar above the input; quoted block inside the sent bubble; tapping the quote scrolls to the original. Needs `messages.reply_to_id` (migrate_005) + server accepts/returns it (also in the realtime event and backup export).
  - **Everything stays live/updated:** chat list, chat screen, Tasks tab, task counts, Admin user list and (new) Reports update by themselves from WebSocket events (no manual reopening), plus **pull-to-refresh** on every list, refetch on app foreground and on reconnect, and paging for long lists (older messages load on scroll-up; long task/user lists use FlatList paging). Fix any screen that currently only loads once.
  - Small polish where cheap: smoother list rendering (memoized rows), consistent empty/loading states, keyboard-safe inputs.
- **Phase 8b: Daily check-in chat** (section 11 above) with these refinements from the user: every member has the private "Daily Check-in" chat; **start of day** the assistant asks "aaj kya karoge?" and shows today's open tasks (tap-to-select chips for what they will work on today); **end of day** it asks for the work report, showing today's tasks as chips (Done / In progress / Pending) so the report also **updates the team task list** (task status changes are applied through tasks.js with source 'checkin' and logged in task_events; typed/voice free text still goes through the AI engine). So check-in and tasks are linked. Admin reads everything silently in the Reports screen (no notification), as in section 11.
- Docs updated after each phase (concise rule), commits pushed to origin/main (ANUBH-001/teamchat only).
- Agents: standard-worker for 8a and app parts of 8b; heavy-thinker for server/privacy/scheduler of 8b. Every agent prompt says: "build only, do NOT write or run any tests or start servers to test". The user will say when to test.

## 10. Open items (not blocking)
- AI key (OpenAI/Gemini): fake provider until then.
- Hosting/domain details; Firebase project (free) for push in Phase 5.
