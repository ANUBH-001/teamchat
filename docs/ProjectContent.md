# Project Content: Team Chat + AI Task Tracker

## Goal
A WhatsApp-style team chat for an 11-person team (Indian phone numbers), Android only. The chat also manages tasks by itself, so nobody needs a separate task tool. All history is kept forever (delete = hidden only). Must work from anywhere, not just office Wi-Fi (public HTTPS server at deploy time).

## The team
11 people: 1 boss (Rishit) + 10 members (Anubhav, Arushit, Tushar, Member 5..11 in the seed). Only numbers the boss adds can log in. There is one pinned "All Team" chat with everyone, plus DMs and custom groups.

## Features
- Chat: groups, DMs, All Team, realtime, history, ticks (sent/delivered/read), typing, soft delete ("This message was deleted"), offline queue.
- AI task engine (Phase 4, built): each task-looking message (keyword prefilter) goes to the AI, which answers only with a strict JSON action.
  - Boss says "Anubhav ko X, Tushar ko Y" -> tasks auto-assigned (create_task, boss only).
  - Member says "mera X ho gaya" -> own task auto-marked done (complete_task / update_task).
  - Anyone asks "mere task kya hain?" -> bullet summary done / doing / pending (list_tasks).
  - Server checks permissions and task ownership; if unclear the bot asks. Each action is a bot card from "Team Assistant" with Undo, logged in task_events. Hindi/English/Hinglish handled in the prompt.
- Tasks tab / dashboard (Phase 3): filter chips All / person / Todo / Doing / Done with counts, My Tasks.
- Admin (boss): add member, invite code, reset PIN, activate/deactivate, view deleted messages.

## UI (WhatsApp-style)
Green top bar, bottom tabs Chats | Tasks | Admin (members see "Account"). Light + dark theme. Chat list with avatar, last message, time, unread badge, All Team pinned, search, new chat/group. Chat screen: green outgoing / white incoming bubbles, sender name in groups, ticks, date separators, typing, long-press delete. Not in v1: calls, status, media, voice notes.

## Decisions
- Android only; React Native + Expo (TypeScript).
- Server: Node.js + Express + `ws`; MySQL via mysql2 with plain SQL (no ORM). MySQL is the single source of truth; nightly JSON backup planned.
- Login: phone + PIN, no SMS OTP (no cost). Boss adds member -> invite code -> member sets PIN once -> stays logged in (JWT 30 days). PIN bcrypt-hashed, lockout after 5 wrong tries (15 min).
- Soft delete only (`deleted_at`); nothing is hard-deleted.
- AI provider is swappable (`server/src/ai/provider.js`: mock | openai | gemini via plain fetch); key only in server `.env`; mock keyword rules when no key. AI runs after the message is saved and never blocks sending.
- AI is never trusted: server re-checks boss-only create, assignee is a chat member, task belongs to sender (boss any); unclear -> bot asks. Members trying to assign get no reply.
- Bot = system user "Team Assistant" (inactive, cannot log in) posting `type 'bot'` messages with a JSON card. Undo of an AI-created task = soft delete (boss); undo of a status change = existing /tasks/:id/undo.
- No Docker, ORM, monorepo tools or extra frameworks. Two folders: `server/` and `app/`.
- Plain FlatList chat (react-native-gifted-chat dropped).
- Order is fixed: build -> Git (only when told, never commit secrets, ask before push) -> deploy (only when told). Local build only until then.
- No testing: tests are never written or run unless Manish says so. Agents only build.

## Phases
0 Setup (folders, schema, server, app skeleton, seed). 1 Login + Admin. 2 WhatsApp UI + chat. 3 Tasks tab. 4 AI engine. 5 Offline/backup/push. 6 Git. 7 Deploy. Status is in projectProgess.md.

## Open items
AI key (OpenAI/Gemini); hosting/domain details; Firebase project (free) for push.
