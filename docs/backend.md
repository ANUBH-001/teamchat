# Backend (server/)

Node 22 + Express + `ws` + MySQL (mysql2, plain SQL). Phases 0-6, 8a/8b, 9 done and tested; feedback round (migration 007: slash commands, Testing status, reactions, pins, settings, force update) built 2026-11-17.

## Setup / run
1. `cd server; npm install`. `.env`: `DB_HOST`, `DB_PORT`, `DB_USER`, `DB_PASSWORD`, `DB_NAME=teamchat`, `PORT=3000`, `JWT_SECRET` (required; server exits if empty/`change-me`), `AI_PROVIDER=mock|openai|gemini|anthropic`, `AI_API_KEY`, `AI_MODEL` (defaults `gpt-4.1-mini` / `gemini-2.5-flash` / `claude-haiku-5-5`), `BACKUP_HOUR=2`, `TZ=Asia/Kolkata`. `src/env.js` loads `server/.env`, then `server/src/.env` (fills only unset/empty keys).
2. Schema: new DB -> `sql/schema.sql` (= all migrations). Existing DB -> run missing `sql/migrate_001..007.sql` in order, before the server starts. **migrate_007 has no `USE` line**: pass the DB name (`mysql -h 127.0.0.1 -P 3307 -u root teamchat < sql/migrate_007.sql`; prod `... team_chat_db < ...`). 001-004 old basics, 005 reply_to_id, 006 check-ins, 007 this round.
3. `npm run seed` once (11 users 9000000001..11, Rishit 9000000004 boss, bot user, All Team, check-in chats, prints invite codes). `npm start`. Local DB: `server/scripts/localdb-start.ps1` (127.0.0.1:3307, root, no password, `.localdb/`).

## Layout
`src/index.js` (app, /health, /app/version, /download static, version gate, routes, http+ws) | `db.js` | `middleware/auth.js` | `realtime.js` (WebSocket) | `settings.js` (switches, cached) | `tasks.js` (task logic for routes, commands, AI, check-ins) | `ai/commands.js` (slash commands) | `ai/engine.js` (natural-language AI) | `ai/provider.js` (AI calls, typed errors, title helper) | `ai/names.js` (fuzzy names) | `ai/bot.js` (bot user, bot/system/ephemeral messages, ensureDm) | `routes/{auth,admin,chats,tasks,misc,checkins}.js` | `checkins.js` | `backup.js` | `seed.js`.

## DB tables
- users(phone UNIQUE, name, role boss|member, pin_hash, active, failed_attempts, locked_until, is_bot) | invites(user_id, code SHA-256, used_at)
- chats(type all|group|dm|checkin, name, created_by, owner_id (checkin, UNIQUE), pinned_message_id, deleted_at)
- chat_members(chat_id, user_id, joined_at, left_at (leave/remove = soft), last_read_message_id, last_delivered_message_id, muted, pinned)
- messages(chat_id, sender_id, body, edited_at, deleted_at, client_id (UNIQUE with sender), type text|bot|system|checkin_prompt, payload JSON, reply_to_id, visible_to (ephemeral: only that user), mentions JSON [ids])
- message_reactions(message_id, user_id PK, emoji, deleted_at) - one per user per message, removal = soft
- tasks(title, description, project, assignee_id, created_by, source_message_id, chat_id, status todo|in_progress|review|done, due_at, completed_at, deleted_at)
- task_events(task_id, actor_id, event created|status|title|description|project|assignee|due|note|praise|deleted, old_value, new_value, source manual|command|ai|checkin, message_id)
- app_settings(name, value JSON): `checkin.*` keys (check-ins) + global switches below | chat_settings(chat_id, name, value JSON)
- checkins, checkin_revisions, checkin_prompts (Phase 8b) | message_revisions, push_tokens (unused)

## Auth, errors, version gate
Bearer JWT (HS256, 30 days); requireAuth re-reads the user. Errors `{error, code?}`: 401 `Not authenticated`, 403 `Not allowed` (code NOT_ALLOWED), 404 (NOT_FOUND), 500 `Server error`.
Every route except /health, /app/version, /download: header `X-App-Version` (int, missing = 0) below setting `minVersionCode` -> **426** `{error:'TeamChat ka naya version install karein (app update required)', code:'UPDATE_REQUIRED', apkUrl}`. WebSocket: `&v=<versionCode>` below min -> closed with code 4426. Default min 0 (nothing blocked).
- GET /app/version (public) -> `{minVersionCode, latestVersionCode, latestVersionName, apkUrl, message}`. `/download/*` serves `server/public/download/` (put `TeamChat.apk` there; *.apk git-ignored).
- GET /health (public) -> `{ok:true, db:true}` / 500.

## /auth
POST /auth/activate `{phone, inviteCode, pin}` -> `{token, user}` | POST /auth/login `{phone, pin}` (5 wrong -> 15 min lock, 429) | GET /auth/me.

## /admin (boss only)
- Users: GET /admin/users; POST /admin/users `{name, phone, role?}` -> `{user, inviteCode}` (joins All Team; member gets a check-in chat); POST /admin/users/:id/invite (reset PIN) -> `{inviteCode}`; PATCH /admin/users/:id `{active?, name?}`.
- GET /admin/chats/:id/messages?before&limit&includeDeleted=1 (not check-in chats).
- GET /admin/settings -> `{settings, ai:{provider, model, hasKey, lastError:{code,message,at}|null}}` (lastError cleared by the next good AI call). PUT /admin/settings `{any subset}` -> `{settings}`; 400 `Unknown setting: x` | `Invalid value for x` | `Nothing to update`; ws `{type:'settings'}` to everyone.
- POST /admin/settings/test-ai -> `{ok:true}` | `{ok:false, code, message}` (one tiny real call, works even when aiEnabled is off).
- GET/PUT /admin/chats/:id/settings -> `{settings:{botEnabled, aiDetect, notifyAdmin}}` (defaults all true); ws `{type:'settings', chatId}`.
- Check-in reports `/admin/checkins` (see Daily check-ins).

Global settings (defaults): `aiEnabled:true, aiDetect:true, commandsEnabled:true, membersCanAssign:true, notifyAdminOnMemberChanges:true, quietTaskNotifs:true, praiseEnabled:true, minVersionCode:0, latestVersionCode:2, latestVersionName:'0.2.0', apkUrl:'', updateMessage:''`. GET /settings/public (any user) -> `{commandsEnabled, membersCanAssign, praiseEnabled, quietTaskNotifs, notifyAdminOnMemberChanges}`.

## /chats (member of the chat)
- GET /chats -> `{chats:[{id,type,name,otherUserId,createdBy,membersCount,unread,muted,pinned,myLastRead,pinnedMessage:{id,body,senderName}|null,lastMessage:{id,senderId,senderName,text,type,deleted,createdAt}|null}]}`. Order: my pinned chats, then All Team, Daily Check-in, then newest message.
- POST /chats `{name, memberIds}` (group, any user) -> 201 `{chat}` | POST /chats/dm `{userId}` -> 201 new / 200 existing.
- GET /chats/:id -> `{chat (same shape), members:[{id,name,role,isCreator}]}`.
- POST /chats/:id/members `{userIds}` -> `{ok, members}` (group; creator or boss; re-add clears left_at, new joiners start with 0 unread). System msg "X added Y, Z".
- DELETE /chats/:id/members/:userId -> `{ok}` (self = leave; others: creator/boss). System msg "X removed Y" / "X left"; removed user gets ws `{type:'chat', chatId, removed:true}`.
- PATCH /chats/:id `{name}` (group; creator/boss) -> system msg "X renamed the group to N". PATCH /chats/:id/me `{muted?, pinned?}` (booleans) -> `{ok}`.
- POST /chats/:id/pin `{messageId|null}` (any member; not ephemeral/deleted) -> `{ok}`; ws `{type:'pin', chatId, pinnedMessage}`; pinning posts "X pinned a message".
- GET /chats/:id/messages?limit(1-200, 30)&before | &after (asc, max 500) -> `{messages, hasMore, status:{delivered,read}}`.
- POST /chats/:id/messages `{text (max 4000), clientId, replyToId?}` -> 201 `{message}` (same clientId again -> 200 `duplicate:true`). `@Name` tokens -> `mentions` (chat members by first name, case-insensitive; else fuzzy single match). After the reply: a slash command runs (see below), else the AI engine; a check-in chat message (not a command) is also appended to today's check-in.
- POST /chats/:id/read `{messageId?}`. Non-group routes on a group-only action -> 400 `Only for groups`. Creator/boss-only -> 403 `Only the group creator or an admin can do this`.
Group-management errors: 400 `Pick at least one member` | `Invalid member` | `Group name is required`; 404 `Member not found`.

## Messages / users
- DELETE /messages/:id (sender or boss; soft). POST /messages/:id/reactions `{emoji}` (max 16 chars) toggles mine (same emoji = remove, other = replace) -> `{reactions}`; DELETE /messages/:id/reactions removes mine. ws `{type:'reaction', chatId, messageId, reactions}`.
- GET /users -> `{users:[{id,name,phone}]}` (active, not self).
- Message object: `{id, chatId, senderId, senderName, text (null if deleted, non-boss), deleted, clientId, createdAt, type 'text'|'bot'|'system'|'checkin_prompt', payload, replyTo:{id,senderName,text,deleted}|null, visibleTo:number|null, mentions:number[], reactions:[{emoji,userIds}]}`. System messages: `text` is the plain line, sender = acting user.
- **Ephemeral**: `visible_to` set -> excluded for everyone else in every read (messages, chat-list preview, unread counts, admin read, reply/react/pin/delete) and sent on ws only to that user.
- Bot payloads: `{kind:'task', event:'created'|'updated'|'completed'|'review'|'reassigned'|'due'|'deleted'|'note'|'praise', task, actorId, actorName, note?, byAi?, replyTo?, undo?, action (legacy)}` (public) | `{kind:'picker', command, text, tasks:[{id,title,status}], arg?}` | `{kind:'list', title, tasks}` | `{kind:'help', commands:[{cmd,args,desc}]}` | `{kind:'error', code, message}` | `{kind:'info', text}` | `{kind:'clarify', replyTo, text, options}` | `{kind:'summary', ..., counts:{done,review,in_progress,todo}}` (last six ephemeral). `checkin_prompt`: `{kind:'morning'|'evening', date, tasks, nudge?}`.

## /tasks
Task: `{id,title,description,project,assigneeId,assigneeName,createdBy,createdByName,status,dueDate|null,chatId,sourceMessageId,createdAt,updatedAt,completedAt,overdue}` (overdue = due date before today in TZ, not done). App labels: todo Todo, in_progress Doing, review Testing, done Done.
Permissions: boss = all. Member: status/note on tasks assigned to them; with `membersCanAssign` also create (for anyone), and edit/reassign/due tasks they created or are assigned. Delete: boss or creator. Undo: boss, assignee (or creator when membersCanAssign). Praise: boss or creator, if `praiseEnabled`.
- GET /tasks?assignee=<id|all>&status=&q=&project= -> `{tasks}` (everyone may read all; default boss all, member own).
- GET /tasks/summary -> `{users:[{id,name,total,todo,in_progress,review,done,overdue,doneToday}], overall:{...same}, totals:{open,todo,in_progress,review,done,doneToday,overdue}}`. GET /tasks/mine/summary -> `{done, review, in_progress, todo}`.
- GET /tasks/activity?limit=50(max 200)&since=<ISO> -> `{events:[{id,event,oldValue,newValue,actorId,actorName,source,createdAt,taskId,taskTitle,assigneeId,assigneeName}]}` newest first (no description events).
- GET /tasks/:id -> `{task, events:[...same, oldest first]}` (assignee events carry names, not ids).
- POST /tasks `{title, description?, project?, assigneeId, dueDate?, chatId?}` -> 201 `{task}`. PATCH /tasks/:id `{status?, note?, title?, description?, project?, assigneeId?, dueDate?}` -> `{task}`. POST /tasks/:id/undo, POST /tasks/:id/praise `{text?}` -> `{ok}` (card in the task's chat if the assignee is a member, else the praiser-assignee DM). DELETE /tasks/:id -> `{ok}` (soft).
- Errors: 400 `Title is required` | `Invalid assignee` | `Invalid due date` | `Invalid status` | `Invalid note` | `Nothing to update` | `Nothing to undo` | `Project too long`; 403 `Not allowed` | `Praise is turned off`; 404 `Task not found`.
- ws `{type:'task', task, event, actorId, actorName, notifyAdmin}` / `{type:'task_deleted', taskId, task, event:'deleted', ...}` to assignee, creator, actor, previous assignee, bosses. notifyAdmin = actor not boss, `notifyAdminOnMemberChanges` on, task chat's `notifyAdmin` on, not a check-in change.

## Slash commands (ai/commands.js)
Message starting with `/word` (kept as a normal text message). Disabled via `commandsEnabled` or chat `botEnabled` -> ephemeral error COMMANDS_DISABLED. Unknown -> BAD_COMMAND.
- `/task <name?> <text> [due <date>]`: first 1-2 words (or `@Name`) matched to an active user (fuzzy; `tumko/ko/ji` after the name dropped); no name = self; ambiguous -> error. Date: `due X`, `by/till X` or `X tak`; X = aaj/kal/parso, weekday (next one, never today; Hindi names too), `25 nov`, `nov 25`, `25/11[/2026]`, `2026-11-30` (local TZ). Title + project from `provider.taskTitle` (AI; mock: word before "pe/par" = project, filler removed). Description = the text.
- `/update [#id] <note>` (status from keywords: testing/review -> review, done words -> done, start/kar raha -> in_progress, else note only), `/done [#id] [note]`, `/testing [#id] [note]`, `/reassign #id <name>`, `/due #id <date|none>`, `/delete #id`, `/tasks [name]`, `/mytasks`, `/help`. Aliases: completed-task/complete/completed = done, update-task = update, reassigned-task/reassign-task = reassign, review = testing, mytask = mytasks, list = tasks, new-task = task.
- No #id: one open task of mine (or, if none, created by me) is used; more -> ephemeral picker (`/delete` always picks). Public card for every change; help/list/picker/error/info ephemeral. AI failure on /task -> task made with mock title + ephemeral error "AI key issue (AI_KEY_INVALID): ...".

## AI (ai/provider.js, ai/engine.js)
- Provider used only if known name + key + `aiEnabled`; else mock rules. Errors typed: 401/403 -> AI_KEY_INVALID, 429/402/credit -> AI_QUOTA, 15 s -> AI_TIMEOUT, else AI_ERROR; logged as code only (no body); mock answers instead; stored as `lastError` for Admin Settings.
- Engine (non-command text): needs `aiDetect` (global and chat) and chat `botEnabled`, keyword prefilter, then `decide()`. Creates tasks only for the boss. Silent when confidence < 0.6, no open tasks or nothing changes; clarify/summary/errors are ephemeral; task changes post a public card (`byAi:true`). Writes via tasks.js with source 'ai'.
- Bot user: `is_bot=1`, "Team Assistant", inactive, cannot log in.

## Daily check-ins (Phase 8b)
Private `checkin` chat per member (member + bot only; privacy guard `realtime.MEMBER_OK` everywhere). POST /checkins `{kind, text?, selectedTaskIds?, taskStatuses?}`; GET /checkins/today; GET /checkins/mine?from&to; boss: GET /admin/checkins?date, /admin/checkins/user/:id, GET/PUT /admin/checkins/settings `{enabled, morningTime, eveningTime, days, nudgeMinutes}`. Scheduler (1-min tick, TZ) posts morning/evening prompts and one nudge; claims a checkin_prompts row first (no double posts). Boss gets no check-in events; task changes from check-ins send `task` events with notifyAdmin false. Statuses may include `review`.

## WebSocket
`ws://host:port/?token=<JWT>&v=<versionCode>`; bad token -> 4401, old version -> 4426; ping 30 s. Server -> client: `hello` | `message {message}` | `deleted` | `read {chatId,read,delivered}` | `typing` | `chat {chatId, removed?}` | `task` / `task_deleted` | `users` (bosses) | `reaction` | `pin` | `settings {chatId?}`. Client -> server: `{type:'typing', chatId}`. No FCM: the app raises local notifications.

## Backup / security
Nightly `server/backup/YYYY-MM-DD.json` after BACKUP_HOUR (all tables incl. soft-deleted rows, reactions, settings; no pin_hash/invites; last 30 kept; `npm run backup`). PIN bcrypt, invite SHA-256 single use, lockout, JWT secret + AI key only in `.env`, nothing hard-deleted, SQL parameterized, AI output strictly parsed and permission-checked.
