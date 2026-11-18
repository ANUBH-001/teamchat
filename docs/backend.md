# Backend (server/)

Node 22 + Express + `ws` + MySQL (mysql2, plain SQL). Phases 0-10 done; **round 2 (migrate_008: person picker + mentionIds, /ask /desc, card replies, edit/delete 10 min, retention jobs, check-in rework, admin reset) BUILT + TESTED 2026-11-18 (task corpus 209/209 AI off + on, see projectProgess.md).**

## Setup / run
1. `cd server; npm install`. `.env`: `DB_HOST`, `DB_PORT`, `DB_USER`, `DB_PASSWORD`, `DB_NAME=teamchat`, `PORT=3000`, `JWT_SECRET` (required), `AI_PROVIDER=mock|openai|gemini|anthropic`, `AI_API_KEY`, `AI_MODEL` (defaults `gpt-4.1-mini` / `gemini-2.5-flash` / `claude-haiku-5-5`), `BACKUP_HOUR=2`, `TZ=Asia/Kolkata`. `src/env.js` loads `server/.env`, then `server/src/.env` (fills only unset keys).
2. Schema: new DB -> `sql/schema.sql` (= all migrations). Existing DB -> run missing `sql/migrate_00X.sql` in order before the server starts. **007 and 008 have no `USE` line**: `mysql -h 127.0.0.1 -P 3307 -u root teamchat < sql/migrate_008.sql` (prod `... team_chat_db < ...`). 005 reply_to_id, 006 check-ins, 007 feedback round, 008 round 2 (applied locally).
3. `npm run seed` once (11 users, Rishit 9000000004 boss, bot, All Team, check-in chats, invite codes). `npm start`. Local DB: `server/scripts/localdb-start.ps1` (127.0.0.1:3307, root, no password).

## Layout
`src/index.js` (app, /health, /app/version, /download, version gate, routes, ws, starts backup + check-in + jobs schedulers) | `db.js` | `realtime.js` | `settings.js` | `tasks.js` | `checkins.js` | `jobs.js` (purge, reminders, task cleanup, admin reset) | `backup.js` | `ai/commands.js` (slash commands, person resolution, card replies) | `ai/engine.js` (natural-language AI) | `ai/provider.js` | `ai/names.js` (fuzzy names + mention tagging) | `ai/bot.js` | `routes/{auth,admin,chats,tasks,misc,checkins}.js`.

## DB tables
- users(phone UNIQUE, name, role boss|member, pin_hash, active, failed_attempts, locked_until, is_bot) | invites
- chats(type all|group|dm|checkin, name, created_by, owner_id (checkin, UNIQUE), pinned_message_id, deleted_at) | chat_members(chat_id, user_id, left_at, last_read/delivered_message_id, muted, pinned)
- messages(chat_id, sender_id, body, edited_at, deleted_at, client_id UNIQUE w/ sender, type text|bot|system|checkin_prompt, payload JSON, reply_to_id, visible_to (ephemeral), mentions JSON) | message_revisions(message_id, old_body, edited_at) | message_reactions(message_id, user_id PK, emoji, deleted_at)
- tasks(title, description, project, assignee_id, created_by, source_message_id, chat_id, status todo|in_progress|review|done, due_at, completed_at, deleted_at, **reminded_at**) | task_events(task_id, actor_id, event, old/new_value, source manual|command|ai|checkin, message_id)
- app_settings(name, value JSON): globals, `checkin.*`, `job.<name>.lastRun` | chat_settings(chat_id, name, value JSON)
- checkins / checkin_revisions (typed check-in text, round-1 history) | checkin_prompts(user_id, date, kind day|signoff|signoff_nudge (old morning|evening), message_id) | **signoffs**(user_id, date UNIQUE pair, note, summary JSON {counts:{given,done,left}, tasks:[{id,title,status}]}, message_id)

## Auth, errors, version gate
Bearer JWT (HS256, 30 days). Errors `{error, code?}`: 401, 403 `Not allowed` (NOT_ALLOWED), 404 (NOT_FOUND), 500. Header `X-App-Version` below `minVersionCode` -> 426 `UPDATE_REQUIRED` (ws: close 4426). GET /app/version, GET /health, `/download/*` are public.

## /auth, /admin (boss only)
- POST /auth/activate `{phone, inviteCode, pin}` | POST /auth/login `{phone, pin}` (5 wrong -> 15 min lock) | GET /auth/me.
- Users: GET/POST /admin/users, POST /admin/users/:id/invite, PATCH /admin/users/:id `{active?, name?}`. GET /admin/chats/:id/messages?includeDeleted=1 (not check-in chats).
- GET /admin/settings -> `{settings, ai:{provider, model, hasKey, lastError}}`; PUT /admin/settings `{subset}` (400 `Unknown setting` / `Invalid value for x`); ws `settings`. POST /admin/settings/test-ai. GET/PUT /admin/chats/:id/settings `{botEnabled, aiDetect, notifyAdmin}`.
- **POST /admin/reset** `{confirm:'RESET'}` -> `{ok, backup:'reset-....json', chatsDeleted}` (400 without RESET). Full backup to `server/backup/` first, then deletes all messages, reactions, revisions, tasks, task_events, checkins, prompts, signoffs, every group + DM chat; keeps users, PINs, app_settings, All Team and each member's check-in chat (emptied, read pointers cleared). ws `{type:'reset'}` to all.
- **POST /admin/jobs/run** `{job:'purge'|'reminders'|'taskcleanup'|'morning'|'evening'}` -> `{ok, job, result}` (400 `Unknown job`). Runs now, ignoring clock/day/once-a-day mark and retentionEnabled.
- Global settings (defaults): `aiEnabled, aiDetect, commandsEnabled, membersCanAssign, notifyAdminOnMemberChanges, quietTaskNotifs, praiseEnabled` (all true), `minVersionCode:0, latestVersionCode:3, latestVersionName:'0.3.0', apkUrl, updateMessage`, **`retentionEnabled:true, taskReminderDays:6 (0-90, 0 off), taskDeleteDays:14 (1-3650), messageRetentionDays:7 (1-3650)`**. GET /settings/public -> `{commandsEnabled, membersCanAssign, praiseEnabled, quietTaskNotifs, notifyAdminOnMemberChanges, taskReminderDays}`.

## /chats (member of the chat)
- GET /chats, POST /chats `{name, memberIds}`, POST /chats/dm `{userId}`, GET /chats/:id -> `{chat, members:[{id,name,role,phone,isCreator}]}`, POST/DELETE members, PATCH /chats/:id `{name}`, PATCH /chats/:id/me `{muted?, pinned?}`, POST /chats/:id/pin `{messageId|null}` (any member, any non-ephemeral message incl. bot cards; ws `pin`), GET /chats/:id/messages?limit&before|after, POST /chats/:id/read (unchanged from round 1).
- POST /chats/:id/messages `{text (max 4000), clientId, replyToId?, mentionIds?: number[]}` -> 201 `{message}` (dup clientId -> 200 `duplicate:true`).
  - **mentionIds** (structured mentions from app pickers, in text order): each `@token` in the text takes the first unused id whose name matches it (`names.tagMentions`); those ids are trusted as-is (same-name people). Other `@tokens`: chat members by first name (one hit), else fuzzy; only a SINGLE hit counts (ambiguous = no mention). `message.mentions` = all ids.
  - After the reply: slash command (with the tagged mentions) -> else reply to a task card -> else AI engine. Check-in chat text (not a command) is also stored as today's check-in text.
- Message object: `{id, chatId, senderId, senderName, text, deleted, clientId, createdAt, editedAt, type, payload, replyTo, visibleTo, mentions, reactions}`.

## Messages / users (routes/misc.js)
- **PATCH /messages/:id** `{text, mentionIds?}` -> `{message}`: own `text` message only, not ephemeral/deleted, within 10 min of sending (everyone, boss too). Old body -> message_revisions, `edited_at` set, mentions re-read; ws `{type:'edited', chatId, message}`. Commands are not re-run. 403 `{code:'EDIT_WINDOW'}` after 10 min, 403 NOT_ALLOWED for others' / bot / system messages.
- **DELETE /messages/:id** (soft): own text message within 10 min (boss too; old "boss deletes anything" removed), or your own ephemeral bot card any time. Same 403 codes. ws `deleted`.
- POST/DELETE /messages/:id/reactions (toggle mine; ws `reaction`). GET /users -> `{users:[{id,name,phone,role}]}` (active, not bot, not self).

## /tasks
Task: `{id,title,description,project,assigneeId,assigneeName,createdBy,createdByName,status,dueDate,chatId,sourceMessageId,createdAt,updatedAt,completedAt,overdue, ageDays, stale, remindedAt}` (stale = open and ageDays >= taskReminderDays).
Permissions: boss all. Status: assignee (or creator with membersCanAssign). **Note / description: boss, assignee or creator (always).** Title/project/assignee/due: boss, or with membersCanAssign the creator/assignee. Delete: boss/creator. Endpoints unchanged: GET /tasks, /tasks/summary, /tasks/mine/summary, /tasks/activity, /tasks/:id; POST /tasks; PATCH /tasks/:id; POST /tasks/:id/undo | /praise; DELETE /tasks/:id (soft). ws `task` / `task_deleted` (+ the member's check-in cards are refreshed).

## Slash commands (ai/commands.js)
`/task <name?> <text> [due X]`, `/update [#id] <note>`, `/done`, `/testing`, **`/ask #id`**, **`/desc #id <text>`**, `/reassign #id <name>`, `/due #id <date|none>`, `/delete #id`, `/tasks [name]`, `/mytasks`, `/help` (+ aliases; `status`=ask, `description`=desc). Disabled -> COMMANDS_DISABLED; unknown -> BAD_COMMAND.
- **Person resolution** (/task, /reassign, /tasks): leading fillers skipped (ko, tumko, tujhe, ne, ka, ki, bhai, sir, ji...), then an `@word` with a tagged mentionId wins; else the first 1-2 words via `names.bestMatches` (case-insensitive; exact 3 > prefix (3+ letters) 2 > same consonant skeleton 1.5 ("anubav"->Anubhav, "rishith"->Rishit) > Damerau-Levenshtein <=1 (names <=5 letters) / <=2 1, same first letter; every word must match; +0.5 when the query covers the whole name, so "anubhav" = Anubhav, not Anubhav Kumar). `/task` only: if the start names nobody, the name may come later: an `@word` anywhere, or a name followed by `ko` / `ke liye` or ending the text ("crm filter banana hai anubhav ko"). Chat members preferred over all active users (bot excluded). Several equal matches -> AI `pickPerson` (context: candidates, roles, in-chat, last 8 messages; used only at confidence >= 0.8) -> else ephemeral **userpicker**. An `@word` matching nobody (or /reassign, /tasks with an unknown name) -> userpicker of chat members/everyone.
- **userpicker** payload `{kind:'userpicker', command, text, users:[{id,name,phoneTail}], arg, pre}`. Round trip: app sends `'/' + command + (pre ? ' ' + pre : '') + ' @' + firstName + (arg ? ' ' + arg : '')` with `mentionIds:[id]` (e.g. `/task @Rishit login fix due 2026-11-19`, mentionIds [6]; `/reassign #12 @Rishit`).
- `/task`: title + project (+ AI description; else the raw text) from `provider.taskTitle`; AI failure -> mock title + private error card AI_KEY_INVALID/AI_QUOTA/.... No name = self.
- `/ask #id`: bot card `{kind:'ask', task, actorId, actorName, assigneeId}` with `mentions:[assigneeId]` in this chat (assignee not a member -> in the asker-assignee DM + private info). Info if own task / done.
- `/desc #id <text>`: replaces the description; card note "Description: ...".
- **Reply to a task card** (swipe-reply to a bot card of kind task|ask, plain text, by boss/assignee/creator): adds a note (status words like "ho gaya" also set the status for assignee/boss); `desc: <text>` replaces the description; bot posts the updated task card. Others' replies stay normal chat.
- No #id: one open task of mine is used, else a task picker `{kind:'picker', command, text, tasks, arg?}`. Other payloads: task card `{kind:'task', event, task, ...}`, list, help, error `{code, message}`, info, `{kind:'reminder', task, days}`.

## AI (ai/provider.js, ai/engine.js)
Provider used only with known name + key + `aiEnabled`; errors typed (AI_KEY_INVALID, AI_QUOTA, AI_TIMEOUT, AI_ERROR), logged as code only, mock answers instead, `lastError` in Admin Settings. Calls: `decide` (engine), `taskTitle` {title, project, description}, `pickPerson`, `summarize`. Engine: quiet unless sure; creates tasks only for the boss.

## Daily check-ins (checkins.js, round 2)
Private `checkin` chat per member (member + bot; privacy guard `realtime.MEMBER_OK`). Bosses get none. Scheduler (1-min tick, TZ) on check-in days:
- From `morningTime` (10:00): `checkin_prompt` card `{kind:'day', date, tasks:[{id,title,status,dueDate,project,overdue,stale,ageDays}], counts}` = all open tasks; **pinned** in that chat. Every task change of the member rewrites the card (and today's sign-off card) payload: ws `{type:'edited', chatId, message}` (no `editedAt`).
- From `eveningTime` (18:00): `{kind:'signoff', date, tasks (open + done today), counts:{given,done,left}}`; one nudge card (`nudge:true`) after `nudgeMinutes` if not signed off.
- GET /checkins/today -> `{date, chatId, settings, workday, eveningOpen, day:{prompted, messageId}, signoff:{prompted, submitted, signoff}, tasks, doneToday, counts}`.
- **POST /checkins/signoff** `{taskStatuses?: {"<id>": todo|in_progress|review|done}, note?}` (members, own tasks; 400 `Invalid taskStatuses` / `Invalid task (use your own tasks only)`) -> 201 new / 200 update `{signoff:{id,userId,date,note,counts,tasks,messageId,...}, created, tasks (changed)}`. Applies statuses (source checkin), posts a member message summary, refreshes the cards, ws `{type:'signoff', userId, userName, date, counts, updated}` to bosses (quiet notification). The old POST /checkins (morning/evening forms) is removed.
- GET /checkins/mine?from&to -> `{from, to, checkins, signoffs}`. Boss: GET /admin/checkins?date -> `{date, workday, members:[{id,name,active, signoff:{status submitted|missing, prompted, signoff}, morning, evening}]}`; /admin/checkins/user/:id (same + signoffs); GET/PUT /admin/checkins/settings `{enabled, morningTime, eveningTime, days, nudgeMinutes}` (migrate_008 sets 10:00 / 18:00).

## Jobs (jobs.js, 1-min tick, once per local day via `job.<name>.lastRun`)
- `purge` Sunday >= 23:00, needs retentionEnabled: **hard-deletes** messages older than messageRetentionDays in every chat except each chat's pinned message and today's check-in cards; reactions + revisions deleted, replies / task source / prompt links set NULL; dump `server/backup/purge-YYYY-MM-DD.json` first; ws `purged`. (Owner asked for real deletion here: overrides the soft-delete rule for retention only.)
- `reminders` daily >= morningTime, taskReminderDays > 0: open tasks created >= N days ago, once (`reminded_at`): bot card `{kind:'reminder', task, days}` mentioning the assignee in their check-in chat + ws `{type:'task_stale', task, days}` to bosses and assignee.
- `taskcleanup` daily >= 01:00, needs retentionEnabled: hard-deletes tasks (+task_events) created >= taskDeleteDays ago, done or not; dump `server/backup/tasks-YYYY-MM-DD.json`; ws `{type:'tasks_purged', taskIds}`.
- `morning` / `evening`: post (or refresh) the check-in cards now (debug route only; normally checkins.js).

## WebSocket
`ws://host:port/?token=<JWT>&v=<versionCode>`; 4401 bad token, 4426 old version. Server -> client: `hello`, `message`, `edited`, `deleted`, `read`, `typing`, `chat`, `task`, `task_deleted`, `task_stale`, `tasks_purged`, `signoff` (bosses), `users`, `reaction`, `pin`, `settings`, `purged`, `reset`. Client -> server: `typing`.

## Backup / security
Nightly `server/backup/YYYY-MM-DD.json` after BACKUP_HOUR (all tables incl. signoffs; no pin_hash/invites; last 30 kept; `npm run backup`). Purge / cleanup / reset dumps are extra files (not rotated). PIN bcrypt, invite SHA-256, lockout, secrets only in `.env`, soft delete everywhere except the retention jobs and admin reset, SQL parameterized, AI output strictly parsed + permission-checked.
