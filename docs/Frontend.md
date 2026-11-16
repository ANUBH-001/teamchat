# Frontend (app/)

Expo (SDK 52) React Native + TypeScript, Android only. Built through Phase 5. Type-checked (`tsc --noEmit` clean) and `expo config` valid on 2026-11-16; not yet run on a phone.

## Run
1. `cd app; npm install` (includes `@react-native-async-storage/async-storage` 1.23.1 for the outbox). In a folder path with `&`, `npx` fails under cmd; use `node node_modules/typescript/lib/tsc.js --noEmit` / `node node_modules/expo/bin/cli ...`.
2. Server must be running (see backend.md).
3. `npx expo start` (or `npm run android`) and open on an emulator or phone.
4. Server address: `app/app.json` -> `expo.extra.serverUrl`. Default `http://10.0.2.2:3000` = host PC as seen from the Android emulator. For a real phone use the PC's LAN IP (e.g. `http://192.168.1.20:3000`, same Wi-Fi). Later: the public HTTPS domain (a release APK blocks plain `http://` unless cleartext is enabled, so use HTTPS for release). Read in `src/config.ts`; the WebSocket URL is derived (http -> ws).

## Structure
- `App.tsx`: AuthProvider; shows spinner (loading), LoginScreen (no user), or bottom tabs Chats | Tasks | Admin ("Account" for members). Starts realtime when logged in, stops on logout.
- `src/config.ts` server URL | `src/api.ts` fetch wrapper `api(method, path, body)` with Bearer token (expo-secure-store), throws `ApiError(message, status)`, status 0 = "Cannot reach server" | `src/auth.tsx` AuthContext (login, activate, logout, session restore via GET /auth/me) | `src/chatTypes.ts` Chat, Msg (incl. `type`, `payload`), BotPayload, Person | `src/taskTypes.ts` Task, Summary, status labels/colors | `src/realtime.ts` | `src/outbox.ts` | `src/push.ts` (local notifications, taps) | `src/theme.ts`, `src/useTheme.ts`.
- `src/screens/`: LoginScreen, ChatsScreen, ChatScreen, NewChatScreen, AdminScreen, TasksScreen, Placeholder.
- `src/components/`: Avatar, ChatRow, Bubble, BotCard, Tick, Chip, StatusPill, TaskRow, TaskModal.

## Screens
- LoginScreen: login (phone + PIN) or "I have an invite code" (phone + code + new 4-6 digit PIN). Errors shown inline.
- ChatsScreen (Chats tab): own mini-navigation (list | chat | new), Android back button handled. Search box, All Team pinned, unread badge, "+" menu -> new chat (DM) / new group. Reloads on WS `message`, `deleted`, `chat` and on reconnect.
- NewChatScreen: pick a person (DM) or pick members -> group name -> create.
- ChatScreen: green/white bubbles, sender name in groups, date separators, ticks, typing subtitle, older messages load on scroll, long-press -> Delete (own message, or any if boss; unsent ones are just removed from the outbox). Deleted shows "This message was deleted". Bot messages (`type 'bot'`) render via `BotCard` as "Team Assistant" (left, green edge): task card = action, title, assignee, due, status pill, **Undo** (create card: boss only -> DELETE task; status card: boss or assignee -> POST /tasks/:id/undo; shows "Undone" after, local only); summary = bullet lists Done / In progress / Pending with counts; clarify/info = plain text.
- AdminScreen (boss): add member (name + phone) -> one-time invite code with Share; member list with Reset PIN and an active switch. Members only see Log out.
- TasksScreen: two views, All Tasks and My Tasks. All Tasks: my counts line, per-person count cards, filter chips (All / person / Todo / Doing / Done with counts), task list with status pill. Tap a task: boss edits (title, assignee, due date, status, delete, undo); an assignee changes status/undo on own tasks; others' tasks are read-only. Boss '+' creates a task. My Tasks: bullet lists Done / Doing / Todo. Reloads on WS `task`, `task_deleted` and reconnect.

## Notifications (local only, no Firebase)
After login `setupNotifications()` creates the `messages` channel and asks permission. `listenMessageAlerts` watches WebSocket `message` events (not mine, not deleted): app in background/inactive -> local notification (sender + text; bot only for a task newly assigned to me); app in foreground but in another chat -> short vibration. Tapping a notification opens that chat (`_open_chat` event or pending id on cold start). `ChatsScreen` reports the open chat via `setActiveChat`. Needs a dev/release build, not Expo Go.
Honest limit: works only while the app process is alive (foreground or recently backgrounded). A fully killed app gets no alerts until reopened; messages are fetched on open. Later option (not built): Android foreground service to keep the socket alive.

## Theme
`theme.ts` exports `light` and `dark` (primary, accent, bubbleOut, bubbleIn, background, card, text, subtext, border), `tickRead`, and `colorFor(userId)` for sender name colors. Follows the phone's color scheme via `useTheme()`. WhatsApp greens (#075E54 / #25D366 in light).

## Auth flow
Token kept in SecureStore. On start, if a token exists the app calls `/auth/me`: a 401 clears the token, a network failure keeps it (offline start). Activate and login both return `{token, user}`; logout clears the token and user.

## Realtime and outbox
- `realtime.ts`: one WebSocket with auto-reconnect (backoff 2 s up to 15 s). Screens subscribe with `onEvent`. Synthetic events `_open` / `_close`. `sendTyping(chatId)` (throttled to 2 s in ChatScreen).
- `outbox.ts`: a sent message goes into an AsyncStorage queue with a `clientId`, then is POSTed. Unsent messages show a clock tick and survive restarts. Flushed on send, on reconnect (`_open`) and every 15 s while a chat is open. The server dedupes by (sender, clientId). 4xx rejections (except 401/429) drop the item; network/server errors keep it and stop, to preserve order.
- On reconnect ChatScreen fetches `?after=<last id>` to get missed messages.

## How to collaborate
- New screen: add `src/screens/X.tsx`; register it in `App.tsx` as a `Tab.Screen` (tab) or add a view state in `ChatsScreen` (sub-screen). Use `useTheme()` for colors.
- New API call: `api('GET', '/path')` from `src/api.ts` (token added automatically); add the type to `chatTypes.ts` and document the endpoint in backend.md.
- New realtime event: handle it inside `onEvent` in the screen and add it to the WebSocket section of backend.md.
- Known: plain FlatList chat (no gifted-chat); swipe-to-reply not built.
