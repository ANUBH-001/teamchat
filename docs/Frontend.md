# Frontend (app/)

Expo (SDK 52) React Native + TypeScript, Android only. Built through Phase 5. Type-checked and run on the Android emulator in Expo Go 2.32.20 (2026-11-16, see projectProgess.md); run on a real OnePlus phone over USB in Expo Go (2026-11-16: login + chat send OK).

## Run
1. `cd app; npm install` (includes `@react-native-async-storage/async-storage` 1.23.1 for the outbox). In a folder path with `&`, `npx` fails under cmd; use `node node_modules/typescript/lib/tsc.js --noEmit` / `node node_modules/expo/bin/cli ...`.
2. Server must be running (see backend.md).
3. `npx expo start` (or `npm run android`) and open on an emulator or phone.
4. Emulator: SDK in `D:\Android\Sdk`, JDK 17 in `D:\Android\jdk17` (user env `ANDROID_HOME`, `JAVA_HOME`, PATH set). AVD `teamchat_test` (Pixel 6, Android 34, google_apis x86_64, WHPX). Start it with `server/scripts/emulator-start.ps1` (waits until booted), then `npx expo start --android`. With a real phone also plugged in, run `expo start` and open the app on the emulator only: `adb -s emulator-5554 shell am start -a android.intent.action.VIEW -d exp://10.0.2.2:8081` (Expo Go for SDK 52 must be installed on it). Expo Go dismisses its dev menu sheet with Back.
6. Dependencies: keep react-navigation on the SDK 52 versions pinned in `package.json` (`overrides` for elements/core/routers); newer ones need a newer `react-native-safe-area-context`. Add native packages with `expo install`. Tab icons use `@expo/vector-icons` (Ionicons).
5. Server address: `app/app.json` -> `expo.extra.serverUrl`. Default `http://10.0.2.2:3000` = host PC as seen from the Android emulator. For a real phone use the PC's LAN IP (e.g. `http://192.168.1.20:3000`, same Wi-Fi). Later: the public HTTPS domain (a release APK blocks plain `http://` unless cleartext is enabled, so use HTTPS for release). Read in `src/config.ts`; the WebSocket URL is derived (http -> ws).

## Structure
- `App.tsx`: AuthProvider; shows spinner (loading), LoginScreen (no user), or bottom tabs Chats | Tasks | Admin ("Account" for members). Starts realtime when logged in, stops on logout.
- `src/config.ts` server URL | `src/api.ts` fetch wrapper `api(method, path, body)` with Bearer token (expo-secure-store), throws `ApiError(message, status)`, status 0 = "Cannot reach server" | `src/auth.tsx` AuthContext (login, activate, logout, session restore via GET /auth/me) | `src/chatTypes.ts` Chat, Msg (incl. `type`, `payload`), BotPayload, Person | `src/taskTypes.ts` Task, Summary, status labels/colors | `src/realtime.ts` | `src/outbox.ts` | `src/push.ts` (local notifications, taps, check-in reminders) | `src/checkinStore.ts` (shared GET /checkins/today) | `src/theme.ts`, `src/useTheme.ts` | `src/useVoiceInput.ts` (voice typing hook).
- `src/screens/`: LoginScreen, ChatsScreen, ChatScreen, NewChatScreen, AdminScreen, TasksScreen, ReportsScreen (boss: day reports, member detail, check-in settings), Placeholder.
- `src/components/`: CheckinCard, Avatar, ChatRow, Bubble, BotCard, Tick, Chip, StatusPill, TaskRow, TaskModal, VoiceBar (+ MicButton).

## Screens
- LoginScreen: login (phone + PIN) or "I have an invite code" (phone + code + new 4-6 digit PIN). Errors shown inline.
- ChatsScreen (Chats tab): own mini-navigation (list | chat | new), Android back button handled. Search box, All Team pinned, unread badge, "+" menu -> new chat (DM) / new group. Reloads on WS `message`, `deleted`, `chat` and on reconnect.
- NewChatScreen: pick a person (DM) or pick members -> group name -> create.
- ChatScreen: green/white bubbles, sender name in groups, date separators, ticks, typing subtitle, older messages load on scroll, long-press -> Delete (own message, or any if boss; unsent ones are just removed from the outbox). Deleted shows "This message was deleted". Bot messages (`type 'bot'`) render via `BotCard` as "Team Assistant" (left, green edge): task card = action, title, assignee, due, status pill, **Undo** (create card: boss only -> DELETE task; status card: boss or assignee -> POST /tasks/:id/undo; shows "Undone" after, local only); summary = bullet lists Done / In progress / Pending with counts; clarify/info = plain text.
- AdminScreen (boss): add member (name + phone) -> one-time invite code with Share; member list with Reset PIN and an active switch. Members only see Log out.
- TasksScreen: two views, All Tasks and My Tasks. All Tasks: my counts line, per-person count cards, filter chips (All / person / Todo / Doing / Done with counts), task list with status pill. Tap a task: boss edits (title, assignee, due date, status, delete, undo); an assignee changes status/undo on own tasks; others' tasks are read-only. Boss '+' creates a task. My Tasks: bullet lists Done / Doing / Todo. Reloads on WS `task`, `task_deleted` and reconnect.

## Voice input (mic)
- Chat input: empty text box -> mic button, text -> Send. Mic -> recording bar: X (discard) | live waveform (volume events; dots when quiet) | language chip हिं / EN | stop (square: transcript goes into the text box to edit) | send (up arrow: sent at once through the normal outbox with a clientId). Live partial text shows above the bar. Nothing heard -> toast "Kuch sunai nahi diya".
- Engine: `expo-speech-recognition` 1.1.1 (SDK 52 line) = Android's SpeechRecognizer (Google app's recognizer; free, no API key; may use the network). Decision: the only AI key is Anthropic (no speech-to-text), so no cloud STT. Default language `hi-IN` (Hinglish; may return Devanagari, which the AI engine handles), `en-IN` via the chip; saved in AsyncStorage `voiceLang`. Changing it while recording restarts the recognizer and keeps the text so far.
- Continuous mode; stops itself after 60 s, or when the recognizer ends (silence/error): then the text goes into the box like stop. Mic permission asked on first use; if denied, an alert offers Open settings.
- Expo Go has no such native module: `requireOptionalNativeModule` returns null, the mic is hidden and Send shows as before. Voice needs the dev build below.

## Dev build (native debug APK, needed for voice)
`android/` is generated (gitignored). The repo path has `&`, which breaks native builds, so map a drive first. From PowerShell:
1. `subst T: 'd:\r&D\team-app'` ; `cd T:\app` ; `node node_modules/expo/bin/cli prebuild --platform android --clean` (after app.json/plugin/native dep changes; then restore `package.json` scripts if prebuild rewrote them).
2. `$env:JAVA_HOME='D:\Android\jdk17'; $env:ANDROID_HOME='D:\Android\Sdk'; $env:GRADLE_USER_HOME='D:\Android\gradle'` ; `cd android` ; `.\gradlew.bat assembleDebug '-PreactNativeArchitectures=x86_64,arm64-v8a'` (SDK parts: build-tools 35.0.0, platform 35, NDK 26.1.10909125, CMake 3.22.1 via `cmdline-tools\latest\bin\android.exe sdk install ...`).
First build about 15 min (incremental about 1.5 min); debug APK about 92 MB (two ABIs, JS not embedded). The dev build needs `expo-file-system` (expo-asset uses it to load the icon font; Expo Go has it built in).
3. APK: `app/android/app/build/outputs/apk/debug/app-debug.apk` -> `adb -s <serial> install -r <apk>`. It loads JS from Metro on the device's `localhost:8081`: `adb -s <serial> reverse tcp:8081 tcp:<metro port>` and `reverse tcp:3000 tcp:3000`, Metro started with `EXPO_PUBLIC_SERVER_URL=http://localhost:3000` (`expo start --localhost --port <port>`). On the emulator a debug build looks for Metro at `10.0.2.2:8081`; to use another port, set the app's `debug_http_host` pref to `localhost:8081` (dev menu > Change bundle location).

## Notifications (local only, no Firebase)
After login `setupNotifications()` creates the `messages` channel and asks permission. `listenMessageAlerts` watches WebSocket `message` events (not mine, not deleted): app in background/inactive -> local notification (sender + text; bot only for a task newly assigned to me); app in foreground but in another chat -> short vibration. Tapping a notification opens that chat (`_open_chat` event or pending id on cold start). `ChatsScreen` reports the open chat via `setActiveChat`. Works in Expo Go SDK 52 (local only; Expo Go warns that remote push is unsupported, which is not used).
Honest limit: works only while the app process is alive (foreground or recently backgrounded). A fully killed app gets no alerts until reopened; messages are fetched on open. Later option (not built): Android foreground service to keep the socket alive.

## Theme
`theme.ts` exports `light` and `dark` (primary, accent, bubbleOut, bubbleIn, background, card, text, subtext, border), `tickRead`, and `colorFor(userId)` for sender name colors. Follows the phone's color scheme via `useTheme()`. WhatsApp greens (#075E54 / #25D366 in light).

## Auth flow
Token kept in SecureStore. On start, if a token exists the app calls `/auth/me`: a 401 clears the token, a network failure keeps it (offline start). Activate and login both return `{token, user}`; logout clears the token and user.

## Realtime and outbox
- `realtime.ts`: one WebSocket with auto-reconnect (backoff 2 s up to 15 s). Screens subscribe with `onEvent`. Synthetic events `_open` / `_close`. `sendTyping(chatId)` (throttled to 2 s in ChatScreen).
- `outbox.ts`: a sent message goes into an AsyncStorage queue with a `clientId`, then is POSTed. Unsent messages show a clock tick and survive restarts. Flushed on send, on reconnect (`_open`) and every 15 s while a chat is open. The server dedupes by (sender, clientId). 4xx rejections (except 401/429) drop the item; network/server errors keep it and stop, to preserve order.
- On reconnect ChatScreen fetches `?after=<last id received from the server>` (history or WebSocket; not raised by its own HTTP send) to get missed messages.

## How to collaborate
- New screen: add `src/screens/X.tsx`; register it in `App.tsx` as a `Tab.Screen` (tab) or add a view state in `ChatsScreen` (sub-screen). Use `useTheme()` for colors.
- New API call: `api('GET', '/path')` from `src/api.ts` (token added automatically); add the type to `chatTypes.ts` and document the endpoint in backend.md.
- New realtime event: handle it inside `onEvent` in the screen and add it to the WebSocket section of backend.md.
- Known: plain FlatList chat (no gifted-chat).

## Swipe-to-reply and live updates (Phase 8a, built, untested)
- Swipe a bubble right (`components/SwipeReply.tsx`, PanResponder + Animated, no native module) -> reply bar above the input (name + snippet, X cancels) -> message sent with `replyToId` (kept in the outbox too). Bubble shows a quote block (accent bar, sender, 2-line snippet; deleted original -> "This message was deleted"); tapping it scrolls to and flashes the original if loaded, else a toast. Not on bot cards, deleted or unsent messages. Works for voice-sent text too.
- `src/useLive.ts`: `useLiveRefresh(load, eventTypes)` refetches (debounced) on those WS events, on reconnect (`_open`), on the local `refresh` event (`emitEvent({type:'refresh'})`) and when the app returns to the foreground; `usePullRefresh(load)` gives the RefreshControl props. Used by Chats list (`message|deleted|chat`), Tasks (`task|task_deleted`, counts and chips derive from it), Admin (`users`, boss), New chat people list. All lists have pull-to-refresh and windowed FlatLists; the chat screen also refetches missed messages on foreground and loads older pages when scrolling up (spinner at the top). Rows are `React.memo` (Avatar, ChatRow, TaskRow, Bubble, BotCard).

## Real phone (USB, Expo Go SDK 52)
Works only while the PC runs the server and the phone is on USB (or the same Wi-Fi). Restart, from `d:\r&D\team-app` (adb = `D:\Android\Sdk\platform-tools\adb.exe`, phone serial `de4eaf03`; always pass `-s` because the emulator is also attached):
1. DB (if 127.0.0.1:3307 is down): `powershell -ExecutionPolicy Bypass -File server/scripts/localdb-start.ps1`
2. Server: `cd server; node src/index.js` (port 3000).
3. USB tunnel (repeat after every re-plug): `adb -s de4eaf03 reverse tcp:3000 tcp:3000` and `adb -s de4eaf03 reverse tcp:8081 tcp:8081`.
4. Expo: `cd app; $env:EXPO_PUBLIC_SERVER_URL='http://localhost:3000'; $env:ANDROID_SERIAL='de4eaf03'; node node_modules/expo/bin/cli start --android --localhost` (installs/opens Expo Go; or in Expo Go use "Enter URL manually": `exp://127.0.0.1:8081`).
`EXPO_PUBLIC_SERVER_URL` overrides `app.json` serverUrl (config.ts), so the emulator default `10.0.2.2` stays in the repo. Wi-Fi route instead: skip step 3, set `EXPO_PUBLIC_SERVER_URL=http://<PC LAN IP>:3000`, start Expo without `--localhost`, open `exp://<PC LAN IP>:8081`; allow ports 3000/8081 in Windows Firewall.

## Daily check-ins (Phase 8b, built, untested)
- Member: the private "Daily Check-in" chat (`chat.type 'checkin'`, server lists it right after All Team; row shows a note icon) has the header line "Aapke reports admin dekh sakte hain". Bot messages of type `checkin_prompt` render as `CheckinCard` (not a bubble): morning = greeting + today's open tasks as tap-to-select chips + optional text + "Send plan"; evening = each task with Done / In progress / Pending chips (preselected from current status) + text ("kya kiya, kya pending, koi dikkat?") + mic (uses the chat's voice hook; transcript goes into the card box) + "Send report". Submit = POST /checkins (`kind`, `text`, `selectedTaskIds` or `taskStatuses`), then the card shows "Submitted ✓" with Edit (same day; re-sends). Cards of earlier days show "Purana check-in". State comes from GET /checkins/today via `checkinStore` (5 s cache, shared by all cards). Typing/voice in the chat works as normal (server adds it to the day's text).
- Boss (Admin tab, no check-in chat, no notifications/badges/websocket): buttons "Reports" and "Check-in settings". Reports: prev / next day and Today (no date-picker package), member list with Morning / Evening Submitted or Missing pills (GET /admin/checkins?date=), tap a member -> that day's plan, report, AI summary (done / pending / blockers) and a 7 / 30 day history, tap a day to expand (GET /admin/checkins/user/:id?from&to). Refetches on pull-to-refresh, tab focus and app foreground only. Settings: enabled, morning / evening HH:MM (validated, morning before evening), Mon-Sun toggles, nudge minutes (GET/PUT /admin/checkins/settings).
- Reminders (members only, no Firebase): `push.ts applyCheckinSchedule` schedules LOCAL weekly notifications (expo-notifications WEEKLY trigger, channel `messages`, ids `checkin-<morning|evening>-<day 0-6>`) at the configured times on the configured days, from `settings` in GET /checkins/today (no extra endpoint). Synced after login, on app foreground and whenever the card store refetches; unchanged settings are not rescheduled; cancelled on logout and for the boss. Tap opens the Daily Check-in chat (`data.chatId`). Times are the phone's local time, so the phone should be in the server's zone (IST). Only fires if the OS keeps the schedule (Android may drop it on force-stop/reboot until the app is opened again).
