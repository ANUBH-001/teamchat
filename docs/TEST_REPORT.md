# E2E test report - hardening/integration (2026-11-20)

Branch `hardening/integration` (no code changes made in this pass). Evidence: `docs/test-reports/2026-11-20/`.

## Setup
- Android emulator (emulator-5554), debug build com.teamchat.app, JS from Metro (port 8081) with `EXPO_PUBLIC_SERVER_URL=http://10.0.2.2:3100`.
- Local server on :3100 against local MySQL DB `team_chat_e2e` (seeded users only: Anubhav/Arushit/Tushar members, Rishit boss). Real Gemini for transcription + task detection. No production access.
- App driven with `adb input` + screencap; second/third users simulated through the REST API (curl). Note: one login per user, so an API login as Anubhav logs the app out (SESSION_REPLACED dialog "Logout ho gaye" - correct behaviour, seen once); after that Anubhav was only touched through the app.

## Results
| # | Scenario | Result | Evidence |
|---|---|---|---|
| 1 | Login as Anubhav, chat list loads | PASS | 01-login-filled.png, 01-chatlist.png |
| 2 | R-03: no chips with keyboard closed; tap composer -> keyboard + chips; Back -> chips hide; "/" -> palette | PASS (see note 1) | 02a-chat-kb-closed.png, 02b-kb-open-chips.png, 02c-after-back.png, 02d-slash-palette.png |
| 3 | R-01/R-04: tab "Me", "Take a task..." pill, self task in "Anubhav tasks" Keep card, `/task khud test e2e` (no NOT_ALLOWED), tick -> Undo -> Done tab strikethrough; API shows done + bot "completed" card | PASS | 03a-task-command.png, 03b-tasks-tab.png, 03c-take-task-input.png, 03d-self-task-created.png, 03e-ticked-undo.png, 03g-undo-restored.png, 03f-done-tab.png, 05a-double-tap-send.png (completed card) |
| 4 | Boss creates task via API -> appears live in card; boss marks done via API -> moves to Done live | PASS | 04a-boss-task-live.png, 04b-boss-marked-done-live.png, 04c-done-tab-all.png |
| 5 | Messaging: text; double-tap Send = 1 message (API count 1); airplane mode -> pending clock; reconnect -> delivered once (API count 1, within ~5 s of connectivity) | PASS | 05a-double-tap-send.png, 05b-airplane-pending.png, 05c-airplane-delivered.png |
| 6 | Voice: 3 s hold sends a bubble; recording UI (timer counts, waveform, trash, slide-to-cancel, lock hint); slide left cancels (nothing sent, idle); slide up locks, trash -> idle; short tap -> "Mic dabake rakho (kam se kam 1 second)" toast; 5x quick start/cancel -> idle, still responsive; failed transcript (silent emulator mic) shows reason + "Dobara try karo" (V-04) | PASS (see note 2) | 06a..06i, 06c-voice-sent-failed-retry.png |
| 7 | V-01 AI task detection from plain text | PASS | 07-ai-tab-bot-cards-v01.png (+ API) |
| 8 | Logcat: no FATAL / red JS errors | PASS | logcat.txt |

Scenario 7 detail (real Gemini): Rishit (boss) in DM with Anubhav "Anubhav tumhe ek team app banani hai, ye task assign kar raha hun" -> Task 7 "Ek team app banani" assigned to Anubhav (bot card). Arushit (member) in All Team "Tushar ko report bhejni hai, assign kar raha hun" -> Task 6 "Report bhejni" assigned to Tushar (membersCanAssign default true), bot card quotes the message. A voice note from Anubhav (emulator mic apparently carried some audio) was transcribed by Gemini and produced Task 5 "Test karna" (due Kal) - voice -> AI task works end to end. Two longer (9 s) notes got "Transcript nahi bana: Kuch sunai nahi diya" with the "Dobara try karo" button.

Notes
1. 03a-task-command.png was captured 1 s after pressing Back and still shows the chips with the keyboard gone (keyboard-hide event lag). Re-tested with a 3 s wait (02c) - chips hidden. Not reproducible as a steady state; treat as a <=1 s transient.
2. Cold start of the native recorder on the emulator can take >3 s after an app launch: the first holds after launch (3 s, 6 s, and again after a fresh relaunch, 06j) ended while the engine was still "starting", so nothing was sent and the "too short" toast was shown (or no toast). Never frozen; afterwards (warm) a 3 s hold sends fine. Probably emulator audio latency; confirm on the real phone. The toast wording in that case ("dabake rakho, kam se kam 1 second") is slightly misleading when the user did hold long enough.
3. AI rewrites the `/task khud test e2e` title to "Perform E2E testing" (Gemini title clean-up) - expected behaviour of the task parser, noted only.

## Bugs found / fixed
None found that needed a code fix; no commits to app/server code in this pass.

## Needs the real phone
- Real microphone quality and Gemini transcription of actual speech (emulator mic is silence/synthetic).
- Cold-start latency of the recorder (note 2), haptics, keyboard behaviour with the real IME.
- Push notifications, background/lock-screen behaviour, camera/photo flows, APK update flow.

## Known limitations of this run
- Emulator network via 10.0.2.2 (HTTP, no TLS); airplane mode on the emulator comes back on cell data, not wifi.
- Task "Undo" snackbar lasts 4 s; screenshots had to be timed to catch it.
- Only the Android emulator was tested; boss UI in the app (logged in as Rishit) was not exercised, boss actions were done through the API.

## Re-check after merging `hardening/media-auth` (2026-11-20, 17:00)
| Check | Result | Evidence |
|---|---|---|
| App loads with the new server (migrate_011 applied on the local e2e DB only) | PASS | 09a-after-media-auth.png |
| API: media without auth → 401; signed URL → 200 (26 KB m4a); tampered signature → 403; chat member can sign | PASS | command output in the session log |
| Voice note plays through a signed URL in the app (0:01 / 0:09) | PASS | 09b-voice-plays-signed-url.png |
