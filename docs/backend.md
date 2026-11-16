# Backend (server/)

Node + Express + `ws` + MySQL (mysql2, plain SQL). Built through Phase 5. Not tested (by design).

## Setup / run
1. `cd server; npm install`.
2. Copy `.env.example` to `.env`: `DB_HOST=localhost`, `DB_USER=root`, `DB_PASSWORD=`, `DB_NAME=teamchat`, `PORT=3000`, `JWT_SECRET=change-me` (set a real one), `AI_PROVIDER=mock|openai|gemini`, `AI_API_KEY=`, `AI_MODEL=` (optional; defaults `gpt-4.1-mini` / `gemini-2.5-flash`). No key -> mock. `BACKUP_HOUR=2` (local hour of the nightly backup), `FIREBASE_SERVICE_ACCOUNT=` (path to Firebase service account json; empty = push off).
3. Schema: new DB -> run `sql/schema.sql` (creates DB `teamchat`). Existing older DB -> run the missing ones in order: `sql/migrate_001.sql` (auth lockout, invite hash size), `migrate_002.sql` (read/delivered pointers, messages.client_id), `migrate_003.sql` (tasks.completed_at, task_events.source), `migrate_004.sql` (users.is_bot, messages.type + payload, task_events.message_id).
4. `npm run seed` (once): creates 11 users (phones 9000000001..9000000011; Rishit 9000000004 is boss), the "Team Assistant" bot user and the "All Team" chat, and prints one-time invite codes (plaintext only shown there; DB keeps SHA-256). Re-run skips activated users and issues fresh codes for the others.
5. `npm start` -> server on `PORT` (default 3000). Secrets live only in `.env` (git-ignored).

## Layout
`src/index.js` (app, route mounting, /health, http+ws server) | `src/db.js` (mysql pool) | `src/middleware/auth.js` (requireAuth, requireBoss) | `src/realtime.js` (WebSocket) | `src/tasks.js` (task logic, shared by routes and AI) | `src/ai/{provider,engine,names,bot}.js` (AI task engine) | `src/routes/{auth,admin,chats,tasks,misc}.js` | `src/push.js` (FCM push + POST /push/token) | `src/backup.js` (nightly backup) | `src/seed.js` | `sql/schema.sql`, `sql/migrate_001..004.sql`.

## DB tables
- users(id, phone UNIQUE, name, role boss|member, pin_hash, active, failed_attempts, locked_until, is_bot, created_at)
- invites(user_id, code = SHA-256 hash, used_at)
- chats(type all|group|dm, name, created_by, deleted_at)
- chat_members(chat_id, user_id, left_at, last_read_message_id, last_delivered_message_id)
- messages(chat_id, sender_id, body, edited_at, deleted_at, client_id, type text|bot, payload JSON text; UNIQUE sender_id+client_id)
- tasks(title, description, assignee_id, created_by, source_message_id, status todo|in_progress|done, due_at, completed_at, deleted_at); task_events(task_id, actor_id, event created|status|title|description|assignee|due|deleted, old_value, new_value, source manual|ai, message_id)
- push_tokens(user_id, token UNIQUE). message_revisions exists but is not written yet (backed up anyway).

## Auth
Header `Authorization: Bearer <JWT>` (30 days, payload {id}). requireAuth re-reads the user each call. All errors are `{ "error": "message" }`. Missing/bad token or unknown/inactive user: 401 `Not authenticated`. Boss-only routes: 403 `Not allowed`. Unexpected failure: 500 `Server error`.

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
- PATCH /admin/users/:id body `{active?, name?}` -> 200 `{ok:true}`. 400 `Cannot deactivate yourself` | `Invalid name` | `Nothing to update`. 404 `User not found`.
- GET /admin/chats/:id/messages?before=&limit=(1-200, default 50)&includeDeleted=1 -> 200 `{messages}` (any chat, deleted text included).

### /chats (any logged-in user; must be a member)
- GET /chats -> 200 `{chats:[{id,type,name,otherUserId,membersCount,unread,lastMessage:{id,senderId,senderName,text,deleted,createdAt}|null}]}`. All Team first, then newest message. DM name = other person. Deleted text is null for non-boss.
- POST /chats body `{name, memberIds:[id]}` (group). 201 `{chat}`. 400 `Group name is required` | `Pick at least one member` | `Invalid member`. Members get WS `chat`.
- POST /chats/dm body `{userId}`. 201 `{chat}` new, 200 existing. 400 `Invalid user`. 404 `User not found`.
- GET /chats/:id/messages?limit=(1-200, default 30)&before=<id> or &after=<id> (ascending, max 500; used for missed messages) -> 200 `{messages, hasMore, status:{delivered,read}}`. 403 `Not allowed`.
- POST /chats/:id/messages body `{text (max 4000), clientId}` -> 201 `{message}`; same sender+clientId again -> 200 `{message, duplicate:true}` (idempotent). 400 `Message is empty or too long` | `clientId is required`. 403 `Not allowed`. Broadcasts WS `message` to all members (including sender). Then (async, after the reply) the AI engine may post a bot message.
- POST /chats/:id/read body `{messageId?}` (default latest) -> 200 `{ok:true}`. 403 `Not allowed`.

### Messages and users (any logged-in user)
- DELETE /messages/:id -> 200 `{ok:true}`. Soft delete (sets deleted_at); allowed for the sender or the boss, who must be a chat member. 404 `Message not found`. 403 `Not allowed`. Broadcasts WS `deleted`.
- GET /users -> 200 `{users:[{id,name,phone}]}` (active, excluding self; for the DM/group picker).

Message object: `{id, chatId, senderId, senderName, text (null if deleted and viewer is not boss), deleted, clientId, createdAt, type 'text'|'bot', payload}`. `payload` (bot only, else null):
- `{kind:'task', replyTo, action:'created'|'completed'|'updated', task:{id,title,assigneeId,assigneeName,status,dueDate}, undo:'delete'|'status'|null}`
- `{kind:'summary', replyTo, userId, userName, counts:{done,in_progress,todo}, done:[{id,title,dueDate}] (max 10 each), in_progress, todo}`
- `{kind:'clarify', replyTo, text, options:[{id,title,assigneeName}]}` | `{kind:'info', replyTo, text}`. `text` always holds a plain fallback.

### /push (any logged-in user)
- POST /push/token body `{token}` (FCM device token, max 255) -> 200 `{ok:true}`. Upsert: an existing token is moved to the caller. 400 `Invalid token`.

### /health
GET /health -> 200 `{ok:true, db:true}`; 500 `{ok:false, db:false}`. Note: currently behind auth because of route order (see projectProgess.md).

### /tasks (token required; `/health` is public)
Task object: `{id,title,description,assigneeId,assigneeName,createdBy,status,dueDate 'YYYY-MM-DD'|null,completedAt,createdAt,updatedAt}`. Errors: 400 `Title is required` | `Invalid assignee` | `Invalid due date` | `Invalid status` | `Nothing to update` | `Nothing to undo`; 403 `Not allowed`; 404 `Task not found`.
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
- `provider.js`: `decide(ctx)` -> `{action: create_task|complete_task|update_task|list_tasks|none|clarify, task_id, status, title, assignee_name, assignee_id, due_date, tasks[], confidence}`. `openai` (chat completions, strict `json_schema`) and `gemini` (generateContent, `responseSchema`) via global fetch, 15 s timeout, temperature 0. `mock` = deterministic Hinglish keyword rules ("X ko ... karna hai", "ho gaya/done", "shuru", "mere task"). Output always goes through `parseDecision` (unknown fields dropped, bad types -> null, invalid -> `none`). Provider errors -> logged, no reply.
- Validation (engine): create_task only if sender is boss (members: silently ignored) and assignee resolves to exactly one chat member (`names.js`: Devanagari transliteration, exact / consonant-skeleton / prefix match; DM without a name -> the other person). complete/update: `task_id` must be in the allowed open tasks above; members can only change status; confidence < 0.6 or unknown task -> clarify (bot lists up to 5 open tasks). list_tasks: sender's own `mySummary`; boss may name a person. Up to 5 tasks per create message.
- Writes go through `src/tasks.js` with source 'ai' + message id (permission checks run again there). TaskError -> short bot "info" message.
- Bot user: `users.is_bot = 1`, name "Team Assistant", phone `bot`, `active = 0`, no PIN (cannot log in; excluded from /users, /admin/users, summaries, assignment). Created by seed or lazily (`ai/bot.js`). Bot messages go to the chat via WS `message` like any message.
- Undo on cards: `undo:'delete'` (created) -> DELETE /tasks/:id (boss); `undo:'status'` -> POST /tasks/:id/undo (boss or assignee; reverts the last status change).

## WebSocket
Connect `ws://host:port/?token=<JWT>`. Bad/inactive token -> closed with code 4401. Server pings every 30 s and drops dead sockets.
- Server -> client: `hello` | `message {message}` | `deleted {chatId,messageId}` | `read {chatId,read,delivered}` (pointers for your own messages) | `typing {chatId,userId,name}` | `chat {chatId}` (you were added to a new chat) | `task {task}` and `task_deleted {taskId}` (sent to assignee, creator and all bosses).
- Client -> server: `{type:'typing', chatId}` (relayed to the other members; ignored if not a member).
- Ticks: sent < delivered (every other member connected) < read (every other member read). On connect, all of the user's chats are marked delivered.

## Push (src/push.js)
Off unless `FIREBASE_SERVICE_ACCOUNT` points to a service account json (logged once: "push: disabled"); then uses `firebase-admin` (FCM HTTP v1, `sendEach`). `notifyMessage(message)` is called after a chat message is broadcast and after a bot message is posted, never awaited by the sender and never throws. Text message: pushed to chat members who have no live WebSocket (title = group name or sender name, body = "Sender: text" in groups, text trimmed to 100 chars). Bot messages: only a created task card pushes, to the assignee only ("New task: title"); other bot messages and deleted messages never push. Data `{chatId}`, Android channel `messages`. Invalid/unregistered tokens are deleted; all other push errors are swallowed.

## Backup (src/backup.js)
Started from `index.js`; checks every minute and writes `server/backup/YYYY-MM-DD.json` once per day after `BACKUP_HOUR` (local time, default 2; also catches up if the server was down). Contains users (no pin_hash; there is no invite data), chats, chat_members, messages (including soft-deleted with deleted_at), message_revisions, tasks, task_events. Keeps the last 30 files. Manual run: `npm run backup`. The folder is git-ignored.

## Security notes
PIN bcrypt (cost 10), 4-6 digits; invite codes 8 chars, stored as SHA-256, single use, a new one voids the old; lockout 5 tries / 15 min; only boss-added numbers can log in; JWT secret and AI key only in `.env` (never sent to the app; AI error bodies not logged); deactivated users are rejected immediately; nothing hard-deleted; all SQL parameterized. AI output is untrusted: strict parse + server-side permission/ownership checks; chat text is sent to the AI provider only for task-looking messages, marked as untrusted in the prompt.
