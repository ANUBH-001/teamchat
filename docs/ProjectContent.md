# Project Content: Team Chat + AI Task Tracker

## Goal
A WhatsApp-style team chat for an 11-person team (Indian phone numbers), Android only. The chat also manages tasks, so nobody needs a separate task tool. All history is kept forever (delete = hidden only). Works from anywhere: public HTTPS server.

## The team
11 people: 1 boss + 10 members (Anubhav, Arushit, Tushar, Member 5..11 in the seed). Only numbers the boss adds can log in. One pinned "All Team" chat with everyone, plus DMs and custom groups.

## Features
- **Chat:** groups (add/remove/rename/leave, Group Info), DMs, All Team, realtime, history, ticks, typing, soft delete, offline queue, swipe-to-reply, reactions, @mentions, pinned message, mute/pin chats, voice input (mic, on-device speech).
- **Slash commands (primary task control):** `/task`, `/update`, `/done`, `/testing`, `/reassign`, `/due`, `/delete`, `/tasks`, `/mytasks`, `/help`. Title and project come from the AI (mock fallback). Without `#id` the command uses your single open task, else asks with a private picker card.
- **AI engine (secondary):** plain messages that look like tasks go to the AI, which answers only with a strict JSON action. Boss "Anubhav ko X" assigns; member "mera X ho gaya" completes; "mere task kya hain" lists. Unclear = silent. Server checks every permission. Each change is a bot event card with Undo, logged in task history.
- **Tasks tab:** Overview (tiles, team bars, activity feed, praise), Board (Todo / Doing / Testing / Done), List (filters). Task Detail with timeline and notes. Members see others' tasks read-only.
- **Daily check-ins:** private chat per member: morning plan, evening report, linked to tasks. Boss reads in Admin -> Reports.
- **Admin (boss):** add members, invite codes, reset PIN, activate/deactivate, check-in reports, view deleted messages (API).
- **Settings (boss, server-side switches):** AI on/off, detection, commands on/off, members can assign, notifications, praise, per-group bot settings, app update fields, Test AI button.
- **Force update:** the boss sets a minimum app version; older builds see a blocking update screen with an APK link.

## UI (WhatsApp-style)
Green top bar, bottom tabs Chats | Tasks | Admin (members see "Account"). Light + dark theme. Group bubbles use a color per sender. Bot output is compact event cards, not chat messages. Not in v1: calls, status, media, voice notes (voice input is speech-to-text only).

## Decisions
- Android only; React Native + Expo (TypeScript).
- Server: Node.js + Express + `ws`; MySQL via mysql2 with plain SQL (no ORM). MySQL is the single source of truth; nightly JSON backup.
- Login: phone + PIN, no SMS OTP (no cost). Boss adds member -> invite code -> member sets PIN once -> stays logged in (JWT 30 days). PIN bcrypt-hashed, lockout after 5 wrong tries (15 min).
- Soft delete only (`deleted_at`); nothing is hard-deleted.
- AI provider is swappable (`server/src/ai/provider.js`: mock | openai | gemini | anthropic, plain fetch); key only in server `.env`; mock keyword rules when no key or on AI failure. AI runs after the message is saved and never blocks sending.
- AI is never trusted: server re-checks boss-only create, assignee is a chat member, task belongs to sender (boss any); unclear -> silent or clarify.
- The bot is a system user "Team Assistant" (inactive, cannot log in). Its messages are cards, some visible only to the sender.
- No Docker, ORM, monorepo tools or extra frameworks. Two folders: `server/` and `app/`.
- Realtime = WebSocket only. No Firebase/FCM: notifications are local; a foreground service keeps the socket alive on Android (OnePlus needs "Allow background activity").
- Order is fixed: build -> Git (only when told, never commit secrets, ask before push) -> deploy (only when told).
- No testing unless Manish says so. Agents only build.

## Phases
0 Setup. 1 Login + Admin. 2 Chat UI. 3 Tasks tab. 4 AI engine. 5 Offline / backup / local alerts. 6 Git. 7 Deploy (7a server, 7b release APK). 8 Swipe-reply, live lists, daily check-ins. 9 Foreground service alerts. 10 Feedback round: slash commands, groups, Tasks overview, Settings, force update (built, owner approval pending). Status: projectProgess.md.

## Open items
Owner approves the feedback round UI; push + release APK rebuild + deploy (DEPLOY.md); real AI key on the server (owner's OK); replace placeholder users with real names/phones.
