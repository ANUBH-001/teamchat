# Backend (server/)

Node + Express + `ws` + MySQL (mysql2, plain SQL). Built through Phase 5; one full local test pass done 2026-11-16 (see projectProgess.md).

## Setup / run
1. `cd server; npm install`.
2. Copy `.env.example` to `.env`: `DB_HOST=localhost`, `DB_PORT=3306`, `DB_USER=root`, `DB_PASSWORD=`, `DB_NAME=teamchat`, `PORT=3000`, `JWT_SECRET` (required: the server exits if it is empty or `change-me`), `AI_PROVIDER=mock|openai|gemini|anthropic`, `AI_API_KEY=`, `AI_MODEL=` (optional; defaults `gpt-4.1-mini` / `gemini-2.5-flash` / `claude-haiku-5-5`; key prefixes: OpenAI `sk-`, Gemini `AIza`, Anthropic `sk-ant-`). No key -> mock. `BACKUP_HOUR=2` (local hour of the nightly backup). `TZ=Asia/Kolkata` (IANA name; check-in times and dates use it via Intl, default Asia/Kolkata). `src/env.js` loads `server/.env`, then `server/src/.env` (fills only unset/empty keys; real env vars win), whatever the working directory.
3. Schema: new DB -> run `sql/schema.sql` (creates DB `teamchat`). Existing older DB -> run the missing ones in order: `sql/migrate_001.sql` (auth lockout, invite hash size), `migrate_002.sql` (read/delivered pointers, messages.client_id), `migrate_003.sql` (tasks.completed_at, task_events.source), `migrate_004.sql` (users.is_bot, messages.type + payload, task_events.message_id), `migrate_005.sql` (messages.reply_to_id, swipe-to-reply), `migrate_006.sql` (daily check-ins: chats.type 'checkin' + owner_id, messages.type VARCHAR(20), tables checkins, checkin_revisions, checkin_prompts, app_settings). The server needs migrate_006 before it starts (chat queries use chats.owner_id).
4. `npm run seed` (once): creates 11 users (phones 9000000001..9000000011; Rishit 9000000004 is boss), the "Team Assistant" bot user, the "All Team" chat and a private "Daily Check-in" chat per member, and prints one-time invite codes (plaintext only shown there; DB keeps SHA-256). Re-run skips activated users and issues fresh codes for the others.
5. `npm start` -> server on `PORT` (default 3000). Secrets live only in `.env` (git-ignored).
6. Local dev DB (optional, Windows, MySQL 8.4 installed): `powershell -ExecutionPolicy Bypass -File server/scripts/localdb-start.ps1` runs a project-local mysqld on 127.0.0.1:3307 (root, no password, data in `.localdb/`, git-ignored; first run creates it and loads `schema.sql`); set `DB_HOST=127.0.0.1`, `DB_PORT=3307` in `.env`. Stop: `server/scripts/localdb-stop.ps1` (data kept). It uses `--no-defaults`, so another MySQL install is not touched.

## Layout
`src/index.js` (app, route mounting, /health, http+ws server) | `src/db.js` (mysql pool) | `src/middleware/auth.js` (requireAuth, requireBoss) | `src/realtime.js` (WebSocket) | `src/tasks.js` (task logic, shared by routes and AI) | `src/ai/{provider,engine,names,bot}.js` (AI task engine) | `src/routes/{auth,admin,chats,tasks,misc}.js` | `src/backup.js` (nightly backup) | `src/checkins.js` (check-in scheduler + logic) and `src/routes/checkins.js` | `src/seed.js` | `sql/schema.sql`, `sql/migrate_001..006.sql`.

## DB tables
- users(id, phone UNIQUE, name, role boss|member, pin_hash, active, failed_attempts, locked_until, is_bot, created_at)
- invites(user_id, code = SHA-256 hash, used_at)
- chats(type all|group|dm|checkin, name, created_by, owner_id (checkin only, UNIQUE), deleted_at)
- chat_members(chat_id, user_id, left_at, last_read_message_id, last_delivered_message_id)
- messages(chat_id, sender_id, body, edited_at, deleted_at, client_id, type text|bot|checkin_prompt, payload JSON text, reply_to_id; UNIQUE sender_id+client_id)
- tasks(title, description, assignee_id, created_by, source_message_id, status todo|in_progress|done, due_at, completed_at, deleted_at); task_events(task_id, actor_id, event created|status|title|description|assignee|due|deleted, old_value, new_value, source manual|ai|checkin, message_id)
- checkins(user_id, date (local, TZ), kind morning|evening, text, summary JSON, payload JSON, message_id; UNIQUE user+date+kind); checkin_revisions(checkin_id, old_text, old_payload); checkin_prompts(user_id, date, kind morning|evening|morning_nudge|evening_nudge, message_id; PK = scheduler marker); app_settings(name, value JSON)
- push_tokens(user_id, token UNIQUE) is unused now (no Firebase; table left in place, harmless). message_revisions exists but is not written yet (backed up anyway).

## Auth
Header `Authorization: Bearer <JWT>` (HS256 only, 30 days, payload {id}). requireAuth re-reads the user each call. All errors are `{ "error": "message" }`. Missing/bad token or unknown/inactive user: 401 `Not authenticated`. Boss-only routes: 403 `Not allowed`. Unexpected failure: 500 `Server error`.

## API
Public user object: `{id, phone, name, role}`.

### /auth
- POST /auth/activate (public) body `{phone, inviteCode, pin}`. 200 `{token, user}`. 400 `Invalid phone or invite code` | `PIN must be 4 to 6 digits`. Sets PIN, marks invite used.
- POST /auth/login (public) body `{phone, pin}`. 200 `{token, user}`. 401 `Invalid phone or PIN` (also not activated/inactive). 429 `Too many attempts. Try again later.` (5 wrong PINs -> 15 min lock).
- GET /auth/me (any user). 200 `{user}`.

### /admin (boss only)
- GET /admin/users -> 200 `{users:[{id,phone,name,role,active,activated,created_at}]}`.
- POST /admin/users body `{name, phone, role?}` (role 'boss' else member). 201 `{user:{id,phone,name,role,active}, inviteCode}`. 400 `Name is required` | `Invalid phone number` (7-15 digits, optional +). 409 `Phone already exists`. Auto-added to All Team.
- POST /admin/users/:id/invite -> 200 `{inviteCode}`; clears PIN and lock (reset PIN), voids older codes. 404 `User not found`.
- PATCH /admin/users/:id body `{active?, name?}` -> 200 `{ok:true}`; deactivating also closes that user's live WebSockets (code 4401). 400 `Cannot deactivate yourself` | `Invalid name` | `Nothing to update`. 404 `User not found`.
- GET /admin/chats/:id/messages?before=&limit=(1-200, default 50)&includeDeleted=1 -> 200 `{messages}` (any chat, deleted text included). 403 `Not allowed` for a check-in chat.
- New member (role member), activation and reactivation also create the member's Daily Check-in chat.

### /chats (any logged-in user; must be a member)
- GET /chats -> 200 `{chats:[{id,type,name,otherUserId,membersCount,unread,lastMessage:{id,senderId,senderName,text,deleted,createdAt}|null}]}`. All Team first, then newest message. DM name = other person. Deleted text is null for non-boss.
- POST /chats body `{name, memberIds:[id]}` (group). 201 `{chat}`. 400 `Group name is required` | `Pick at least one member` | `Invalid member`. Members get WS `chat`.
- POST /chats/dm body `{userId}`. 201 `{chat}` new, 200 existing. 400 `Invalid user`. 404 `User not found`.
- GET /chats/:id/messages?limit=(1-200, default 30)&before=<id> or &after=<id> (ascending, max 500; used for missed messages) -> 200 `{messages, hasMore, status:{delivered,read}}`. 403 `Not allowed`.
- POST /chats/:id/messages body `{text (max 4000), clientId, replyToId?}` -> 201 `{message}`; same sender+clientId again -> 200 `{message, duplicate:true}` (idempotent). 400 `Message is empty or too long` | `clientId is required` | `Invalid replyToId` | `Replied message not found in this chat` (replyToId must be a message of the same chat). 403 `Not allowed`. Broadcasts WS `message` to all members (including sender). Then (async, after the reply) the AI engine may post a bot message.
- POST /chats/:id/read body `{messageId?}` (default latest) -> 200 `{ok:true}`. 403 `Not allowed`.

### Messages and users (any logged-in user)
- DELETE /messages/:id -> 200 `{ok:true}`. Soft delete (sets deleted_at); allowed for the sender or the boss, who must be a chat member. 404 `Message not found`. 403 `Not allowed`. Broadcasts WS `deleted`.
- GET /users -> 200 `{users:[{id,name,phone}]}` (active, excluding self; for the DM/group picker).

Message object: `{id, chatId, senderId, senderName, text (null if deleted and viewer is not boss), deleted, clientId, createdAt, type 'text'|'bot', payload, replyTo}`. `replyTo` = null or `{id, senderName, text (null if the original was deleted), deleted}` (text cut to 200 chars); also inside WS `message` events. Backup export includes `messages.reply_to_id`. `payload` (bot only, else null):
- `{kind:'task', replyTo, action:'created'|'completed'|'updated', task:{id,title,assigneeId,assigneeName,status,dueDate}, undo:'delete'|'status'|null}`
- `{kind:'summary', replyTo, userId, userName, counts:{done,in_progress,todo}, done:[{id,title,dueDate}] (max 10 each), in_progress, todo}`
- `{kind:'clarify', replyTo, text, options:[{id,title,assigneeName}]}` | `{kind:'info', replyTo, text}`. `text` always holds a plain fallback.
- type `checkin_prompt` (Team Assistant, check-in chat only): `{kind:'morning'|'evening', date, tasks:[{id,title,status,dueDate}] (max 30), nudge?:true}`; message text is the plain prompt.

### Daily check-ins (Phase 8b)
Check-in object: `{id, userId, date, kind, text, summary:{done:[],pending:[],blockers:[]}, selectedTaskIds, taskStatuses:{taskId:status}, tasks:[{id,title,status,dueDate}] (snapshot), messageId, createdAt, updatedAt, edited}`. Errors 400 `Invalid kind` | `Invalid text` | `Text is too long` (4000) | `Invalid selectedTaskIds` | `Invalid taskStatuses` | `Invalid task (use your own tasks only)` | `Nothing to submit` | `Invalid date` | `Invalid date range` | `Range too long (max 31 days)`; 403 `Not allowed`; 404 `User not found`.
- Chat: each active member has one private chat type `checkin` named "Daily Check-in" (members: the member + Team Assistant; listed after All Team in GET /chats). Created by seed, on add/activate/reactivate, by GET /checkins/today and by the scheduler if missing. The bot marks member messages read at once.
- POST /checkins (member) `{kind, text?, selectedTaskIds?:[id], taskStatuses?:{id:'todo'|'in_progress'|'done'}}` -> 201 new / 200 edited `{checkin, created, message, tasks}` (`tasks` = tasks whose status changed). Tasks must be the caller's own. Always today's local date (edit = same day only; old text/payload kept in checkin_revisions; selectedTaskIds replaces, taskStatuses merges, text replaces if sent). Posts a normal member message summarizing it in the check-in chat, applies status changes through tasks.js (source `checkin`, message_id), stores a basic summary at once; after the reply the AI engine runs on NEW free text only (an edit that resends the same text does not re-run it, so picked statuses win; it can complete named tasks; cards appear in the check-in chat) and one AI call refines the summary of the whole row, written only if text and payload are unchanged meanwhile (mock/no key/failure -> basic summary kept; raw text always stored). Boss -> 403.
- Typed/voice messages by the member in their check-in chat (POST /chats/:id/messages) are appended to today's check-in text (evening after the evening prompt/time, else morning).
- GET /checkins/today (member; boss 403) -> `{date, chatId, settings, workday, morning:{prompted,nudged,submitted,checkin}, evening:{...}, tasks (open, for morning chips), eveningTasks (morning picks + open)}`.
- GET /checkins/mine?from&to (YYYY-MM-DD; default last 7 days, max 31) -> `{from, to, checkins}` (own only); boss 403).
- Boss only (`/admin/checkins`, members 403): GET `?date=` (default today) -> `{date, workday, members:[{id,name,active,morning:{status:'submitted'|'missing',prompted,checkin},evening}]}`; GET `/user/:id?from&to` -> `{user, from, to, checkins}`; GET `/settings` -> `{settings:{enabled,morningTime,eveningTime,days,nudgeMinutes,timezone}}`; PUT `/settings` (any subset) -> `{settings}`; 400 `Invalid morningTime (HH:MM)` | `Invalid eveningTime (HH:MM)` | `Morning time must be before evening time` | `Invalid days (list of 0-6, 0 = Sunday)` | `Invalid nudgeMinutes (0-720, 0 = no nudge)` | `enabled must be true or false` | `Nothing to update`.
- Scheduler (`src/checkins.js`, started by index.js, 1-minute tick, local time in TZ): on enabled days (default Mon-Sat = [1..6]) posts the morning prompt between morningTime (10:00) and eveningTime, the evening prompt from eveningTime (18:30) until local midnight (so a restart catches up the same day), and one nudge (same chat, `nudge:true`) nudgeMinutes (120) after a prompt with no submission. Skips members who already submitted. A checkin_prompts row is claimed (INSERT IGNORE) before posting, so restarts or two processes never double-post.
- Privacy: the boss and other members are never members of a check-in chat. Guard `realtime.MEMBER_OK` (only owner + bot count, even if a stray chat_members row existed) is used by GET /chats, messages/read/delete, unread, ticks, typing, delivered-on-connect and every WS `message`/`chat`/`read` event. `/admin/chats/:id/messages` refuses check-in chats. The boss gets NO event, badge or notification for check-ins and reads them only via `/admin/checkins` (pull-only). Exception by design: a task status changed through a check-in sends the normal `task` event (task data only), like any task change, so task lists stay live.


### /health
GET /health (public) -> 200 `{ok:true, db:true}`; 500 `{ok:false, db:false}`.

### /tasks (token required; `/health` is public)
Task object: `{id,title,description,assigneeId,assigneeName,createdBy,status,dueDate 'YYYY-MM-DD'|null,completedAt,createdAt,updatedAt}`. Errors: 400 `Title is required` | `Invalid assignee` | `Invalid due date` (format or impossible date like 2026-02-31) | `Invalid status` | `Nothing to update` | `Nothing to undo`; 403 `Not allowed`; 404 `Task not found`.
- GET /tasks?assignee=<id|all>&status=&q= -> `{tasks}`. Decision: everyone may read all tasks (read-only); default is all for boss, own for member. Sorted open first, by due date.
- GET /tasks/summary -> `{users:[{id,name,total,todo,in_progress,done}], overall:{...}}` (active users).
- GET /tasks/mine/summary -> `{done:[{id,title,dueDate}], in_progress:[...], todo:[...]}` for the caller.
- POST /tasks (boss) `{title, description?, assigneeId, dueDate?}` -> 201 `{task}`.
- PATCH /tasks/:id `{status?,title?,description?,assigneeId?,dueDate?}` -> `{task}`. Boss: any field. Assignee: `status` only, on own task. `completed_at` set when done, cleared otherwise.
- DELETE /tasks/:id (boss) soft delete -> `{ok:true}`.
- POST /tasks/:id/undo (boss or assignee) reverts the last status change (undo again = redo) -> `{task}`.
- Every change writes a task_events row (actor, source 'manual'|'ai', message_id for AI). Logic lives in `src/tasks.js` (createTask, updateTask, updateTaskStatus, deleteTask, undoTask, listTasks, summary, mySummary; take `(args, actor, source, messageId?)`).

## AI task engine (src/ai/)
- Hook: after POST /chats/:id/messages replies, `engine.onMessage` runs in `setImmediate`; errors are only logged, so sending never waits or fails. Bot messages never trigger it.
- Prefilter: a keyword regex (task/kaam/karna/ho gaya/done/pending/मेरे काम...) must match, else no AI call (cost).
- Context to provider: message (max 1000 chars), sender name+role, chat members (active, non-bot), open tasks (boss: all, member: own; max 60).
- `provider.js`: `decide(ctx)` -> `{action: create_task|complete_task|update_task|list_tasks|none|clarify, task_id, status, title, assignee_name, assignee_id, due_date, tasks[], confidence}`. `openai` (chat completions, strict `json_schema`), `gemini` (generateContent, `responseSchema`) and `anthropic` (Messages API, forced tool use `task_action`) via global fetch, 15 s timeout, temperature 0. `mock` = deterministic Hinglish keyword rules ("X ko ... karna hai", "ho gaya/done", "shuru", "mere task"). Output always goes through `parseDecision` (unknown fields dropped, bad types -> null, invalid -> `none`). Provider errors (bad key, HTTP error, 15 s timeout) -> logged without the body, then the `mock` rules answer instead.
- Validation (engine): create_task only if sender is boss (members: silently ignored) and assignee resolves to exactly one chat member (`names.js`: Devanagari transliteration, exact / consonant-skeleton / prefix match; DM without a name -> the other person). complete/update: `task_id` must be in the allowed open tasks above; members can only change status; confidence < 0.6 or unknown task -> clarify (bot lists up to 5 open tasks). list_tasks: sender's own `mySummary`; boss may name a person. Up to 5 tasks per create message.
- Writes go through `src/tasks.js` with source 'ai' + message id (permission checks run again there). TaskError -> short bot "info" message.
- Bot user: `users.is_bot = 1`, name "Team Assistant", phone `bot`, `active = 0`, no PIN (cannot log in; excluded from /users, /admin/users, summaries, assignment). Created by seed or lazily (`ai/bot.js`). Bot messages go to the chat via WS `message` like any message.
- Undo on cards: `undo:'delete'` (created) -> DELETE /tasks/:id (boss); `undo:'status'` -> POST /tasks/:id/undo (boss or assignee; reverts the last status change).

## WebSocket
Connect `ws://host:port/?token=<JWT>`. Bad/inactive token -> closed with code 4401. Server pings every 30 s and drops dead sockets.
- Server -> client: `hello` | `message {message}` | `deleted {chatId,messageId}` | `read {chatId,read,delivered}` (pointers for your own messages) | `typing {chatId,userId,name}` | `chat {chatId}` (you were added to a new chat) | `task {task}` and `task_deleted {taskId}` (sent to assignee, creator and all bosses) | `users {}` (bosses only: member list changed - added, PIN reset, activated, (de)activated).
- Client -> server: `{type:'typing', chatId}` (relayed to the other members; ignored if not a member).
- Ticks: sent < delivered (every other member connected) < read (every other member read). On connect, all of the user's chats are marked delivered.

## Realtime alerts
No Firebase/FCM. The server only sends WebSocket events; the app raises local notifications (see Frontend.md). A killed app gets no alerts until reopened (messages are fetched on open).

## Backup (src/backup.js)
Started from `index.js`; checks every minute and writes `server/backup/YYYY-MM-DD.json` once per day after `BACKUP_HOUR` (local time, default 2; also catches up if the server was down). Contains users (no pin_hash; there is no invite data), chats, chat_members, messages (including soft-deleted with deleted_at), message_revisions, tasks, task_events, checkins, checkin_revisions, checkin_prompts, app_settings. Keeps the last 30 files. Manual run: `npm run backup`. The folder is git-ignored.

## Security notes
PIN bcrypt (cost 10), 4-6 digits; invite codes 8 chars, stored as SHA-256, single use, a new one voids the old; lockout 5 tries / 15 min; only boss-added numbers can log in; JWT secret and AI key only in `.env` (never sent to the app; AI error bodies not logged); deactivated users are rejected immediately; nothing hard-deleted; all SQL parameterized. AI output is untrusted: strict parse + server-side permission/ownership checks; chat text is sent to the AI provider only for task-looking messages, marked as untrusted in the prompt.
