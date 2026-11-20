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

## Real device (tablet), 2026-11-20 evening
Setup: Android 16 tablet over USB (debug APK 0.6.0, JS from Metro), `adb reverse` for Metro and the local e2e server (port 3100, local MySQL `team_chat_e2e`, real Gemini key). Tablet = Anubhav (member), emulator = Rishit (boss). Gestures driven with `adb shell input motionevent` (real touch events). Evidence: `test-reports/2026-11-20/device/` (status bars blacked out).

| # | Scenario | Result | Evidence |
|---|---|---|---|
| 1 | Login, chat list, DM; text tablet → emulator and back in real time; ✓✓ ticks | PASS | 01, 02, 04, 05, 06 |
| 2a | Voice, cold start: first hold right after a fresh app start records (timer, live wave) and sends 0:04 | PASS (emulator "too short" issue does not reproduce on real hardware) | 10, 11, 12 |
| 2b | Slide left = cancel (nothing sent); slide up = lock; pause in locked mode; trash; send from locked (5.2 s note) | PASS | 20, 21, 22, 23, 24, 25 |
| 2c | Short tap / 0.6 s hold → "Mic dabake rakho (kam se kam 1 second)", nothing sent; Home during recording → discarded | PASS | 26, 27, 28 |
| 2d | Playback on tablet and emulator through signed URLs; real-speech transcript; failed transcript shows reason + "Dobara try karo", retry produces the transcript | PASS | 13, 14, 15, 29, 30, 31 |
| 3 | R-03 chips hidden normally, shown with input focused + keyboard | PASS | 02, 03 |
| 4a | Member self task from "Take a task…" (Me preselected) → "Anubhav tasks" Keep card | PASS | 40–45 |
| 4b | Member ticks a boss task → Done on the boss's emulator + "Anubhav completed Task 7" card; boss Team tab = one Keep card per person | PASS | 46–50 |
| 4c | Boss ticks a member task → member gets "Rishit ne task Done kiya" notification (app in background) | PASS | 51-notifications-teamchat.txt |
| 4d | AI: typed assignment by the boss → Task 9 created; spoken assignment (PC text-to-speech into the tablet mic) → transcribed, AI recognised a task and asked whom (TTS name came out wrong, "Harshad" for "Rishit") | PASS for text; voice pipeline PASS, name accuracy needs a human voice | 52, 53 |
| 5 | Photo from gallery → sent, loads on the emulator via signed URL; profile photo change shows on the emulator | PASS | 54, 55, 56, 75, 76 |
| 6a | Server unreachable: 3 texts pending (◷) → link back → delivered once, in order (DB ids 63–65) | PASS | 60, 61 |
| 6b | Voice note offline → "Nahi gaya" + Retry → retry sends it | PASS | 62, 63 |
| 6c | Server rejects a queued text (403) → was red ✓✓ (**bug A-25**) → fixed: "⚠ Nahi gaya · tap = retry", tap → Retry → delivered | PASS after fix | 64, 65, 66, 67 |
| 6d | Voice note queued offline was only sent after a manual Retry (**bug A-26**) → fixed: sent by itself ~14 s after the link came back | PASS after fix | 68, 69 |
| 6e | Server restart → emulator socket reconnects, live messages flow | PASS | (session log) |
| 7 | Notifications in background: new message ("Rishit: Background mein mila kya"), task done | PASS | 51-notifications-teamchat.txt |
| 8 | Logout: old token 200 → 401; outbox, voice outbox, stars gone; **leak found (A-06 follow-up)**: HTTP disk cache kept chats/tasks/people JSON and the picked photo copies → fixed (server `no-store`, app clears entries); re-login works | PASS after fix | 70, 71, 72-after-logout-files.txt, 73 |
| 9 | Back gesture chat → list, Tasks → Chats; restarts; crash buffer + FATAL / JS errors | PASS (0 crashes) | 74, logcat-filtered.txt |

Not covered on the device (needs a person or another setup): camera / Geo camera capture (permission not granted, would photograph the room), real Wi-Fi ↔ mobile-data switch (traffic runs over the USB tunnel, so the link was cut with `adb reverse --remove` instead), push while the app is killed, speech accuracy with a real voice, release (production-profile) APK.

Observation: at 19:50 four mic presses arrived within 12 s that this run did not send (Android audio log shows them); one 3 s note got sent. Most likely someone touched the tablet; not reproducible in two attempts. Also: Gemini transcribed nearby room speech in "silent" test notes, so AI task detection can react to background talk picked up by the mic.

Fixes from this pass: A-25, A-26, A-06 follow-up (see AUDIT). Tests after fixes: server 68/68, app 77/77, `tsc` 0 errors.


## Voice playback (R-09) + daily check-in upgrade (C-01..C-05), branch hardening/checkin-playback, 2026-11-20 late evening
Setup: worktree server on the local e2e DB (`team_chat_e2e`, port 3100, `MEDIA_URL_TTL_SEC=60` for the expiry checks), worktree Metro on 8081; tablet = member Anubhav (Android 16), emulator = admin Rishit. Test data only. Evidence: `docs/test-reports/2026-11-20/checkin/`.

Automated: server **88/88** (`server-tests.txt`, new `checkin-daily.test.js` 9 tests: timezone day flip at 18:30 UTC, nothing before 10:00 local, one card per member per slot on repeated ticks, no bot / inactive / admin cards, payload = only own open tasks, no morning catch-up in the evening, picks (own task only, 403 admin, forged id 400, stored for Reports, card refreshed), evening tick through PATCH (forged other's task 400/403, admin gets `notifyAdmin`, card refreshed), reply stored as report, one live summary per admin with correct totals, private admin chat, `jobs/run summary` admin-only, `summaryTime` validation, AI self-task from the check-in chat with exactly one bot card). App **106/106** + typecheck (`app-tests.txt`; new `voicePlayer.test.ts` 13, `DailyCheckinCard.test.tsx` 10, media force re-sign 1).

Playback (R-09), reproduced first:
- Tablet, long-running app session: tapping Play on a 7 s note created the ExoPlayer and decoder but nothing played; a second tap did not even create a player (the bubble kept a loaded-but-silent sound and returned early). After a fresh app start the same note played, so the stuck state is session state, not the file or the URL.
- Emulator, old code: Play during a simulated incoming call (`adb emu gsm call`) loaded the note silently (play icon, 0:07, no progress), the expo-av focus path; the new code (`voicePlayer.ts`) tries an explicit play, retries once with a re-signed URL, and after the call one tap plays (verified; screenshots not kept because that chat shows unrelated task titles).
- Signed-URL expiry is NOT the cause: each load signs a fresh URL, and a 2:10 note was fully buffered on load (`playableDurationMillis` = duration), so an expired URL is never re-requested mid-note. With a 60 s TTL: replay after > 60 s plays (`08-tablet-voice-replay-after-url-expiry.png`), play / pause / finish / play again ok (`07-tablet-voice-playing.png`), starting a second note stops the first (`09-tablet-voice-second-note-stops-first.png`).

Check-in on device:
- Morning card on the tablet (`01-tablet-morning-card.png`), two "Today" picks (`02-tablet-morning-today-picks.png`, pill OPEN -> TODAY, stored server-side).
- Evening card sent by the real scheduler tick (the slot was due), "Update API docs" ticked from the card (`03-tablet-evening-card-ticked.png`); the admin's DM shows "Task done: Task 14 - Update API docs" (normal completed flow).
- Report typed in the card's box "I will also write tests for the check-in card" -> normal message, the AI made self-task 16 "Write tests for check-in card" and the evening card grew a row live (`04-tablet-evening-report-sent-ai-self-task.png`).
- Admin summary: sent by the scheduler right after the server start (past 20:30), again via `jobs/run summary` with the app in the background -> quiet notification "Daily check-in summary" (`05-emulator-admin-summary-notification.png`); card with REPLIED / NO REPLY, Today picks, done today, report (`06-emulator-admin-summary-card.png`; an older test transcript in the report line is masked).

Not verified / known limits: the original prod failure could not be replayed on prod (read-only rule), so R-09 is fixed for the two root causes reproduced locally (silent focus failure, dead sound after an error); the release APK was not rebuilt (JS only, OTA). A long card's reply box can sit under the keyboard while typing (the text is kept, the list scrolls back). Tapping the summary notification opened the chat list, not the chat. The morning card shows open tasks only, so a task ticked done later disappears from it (it stays in the evening card and the summary).

## Acceptance test: member and admin (2026-11-20 late night, branch hardening/integration)
Setup: server and Metro restarted from this repo (local e2e DB `team_chat_e2e`, port 3100, real Gemini key; JS from Metro, no new APK). Tablet (Android 16, OnePlus Pad, real touch via adb) and the emulator. Test users only (Anubhav 9000000001 member, Rishit 9000000004 admin). Speech for voice notes came from PC text-to-speech. Evidence: `test-reports/2026-11-20/acceptance/` (status bars blacked out; one summary-card line that quoted room speech is masked; screenshots of the photo picker were not kept because they showed the owner's personal gallery).

### Pass A: tablet = member (Anubhav), emulator = admin (Rishit)
| # | Scenario | Result | Evidence |
|---|---|---|---|
| A1 | Chat list, open DM, text both ways in real time, ✓✓ read ticks | PASS | A-01, A-02 |
| A2 | Emoji, reply (quote), edit ("edited"), delete for everyone; admin sees all of it | PASS after fix (Back with the emoji panel open left the chat; delete had no confirmation) | A-03, A-10 |
| A3 | Voice: hold-record with live wave, slide-left cancel (nothing sent), slide-up lock, send from locked; transcript (TTS speech) | PASS | A-04, A-05, A-06 |
| A4 | Playback (R-09): new note, two notes in a row (the second stops the first), an OLD note (20:17); the admin plays the member's note | PASS | A-07, A-08 |
| A5 | Photo from the gallery with a caption; loads on the admin's emulator | PASS | A-09, A-10 |
| A6 | Settings, edit profile | PASS after fix ("Photo badlo" was Hinglish) | A-11, A-12 |
| A7 | Tasks: Keep card + Me tab; self-task from "Take a task…" | PASS | A-13 |
| A8 | membersCanAssign OFF: the "Assign to" row disappears live; API assigning others → 403 in English; AI refusal in chat is English | PASS | A-14, A-22 |
| A9 | Tick own task → Undo snackbar; the admin gets the "Anubhav completed a task" notification (background) and the completed card; tapping it opens the DM | PASS | A-15, A-16 |
| A10 | Member cannot tick others' tasks, no delete/close; task screen | PASS after fix (the member still saw Undo on an "assigned" card → "Not allowed", and "Change" people with the setting off) | A-17 |
| A11 | No due date anywhere | PASS | all task screens |
| A12 | Morning card: Today picks (live pill), "Anything new" reply box | PASS after fix (box under the keyboard while typing, known limit 1; a bare answer made no task) | A-18, A-19 |
| A13 | Evening card: tick Done (live), report box → AI self-task "Write release notes" | PASS after fix (same keyboard issue) | A-20, A-21 |
| A14 | AI task detection: English "I will review the payment screen today" → Task 20; Hinglish "Main aaj login page fix kar dunga" → Task 21; "Rishit tumhe server logs check karne hain" → English refusal (setting off) | PASS after fix (both Hinglish lines were silently ignored by the pre-filter) | A-22 |
| A15 | Notification while backgrounded (message from the admin) | PASS after a clean app start (note 2) | A-23 |
| A16 | Logout → login screen; login again | PASS (login form fixed to a phone-like width on the tablet) | B-01 |

### Pass B: tablet = admin (Rishit), emulator = member (Anubhav)
| # | Scenario | Result | Evidence |
|---|---|---|---|
| B1 | Login as admin (the emulator's session is replaced, as designed); chat list | PASS | B-02 |
| B2 | Assign a task to a member from the Tasks composer; Team tab = one Keep card per person; the member sees it live | PASS | B-03 |
| B3 | Admin ticks the member's task → gone from the member's Me card live | PASS | B-04 |
| B4 | Close (delete) a task from the sheet (confirm dialog) → reopen from the task screen → the member sees it again | PASS after fix (the closed task's sheet popped up again over another screen when the task was reopened) | B-05, B-07, B-08, B-09 |
| B5 | Task search with no match | PASS after fix (said "No tasks done yet") | B-06 |
| B6 | Admin panel: members list, settings; toggle "members can assign" from the UI | PASS after fix (misleading label, dead Praise switch) | B-10, B-11 |
| B7 | Reports (Daily reports) | PASS after fix (a member who answered the check-in card showed a red "Sign-off Missing") | B-12 |
| B8 | Admin check-in summary card; summary notification with the app in the background → tap opens the Daily Check-in chat | PASS (known limit 2 did not reproduce, note 3) | B-13 |
| B9 | AI from the admin: "Anubhav tumhe invoice bhejna hai aaj" → Task 23 for Anubhav; the member sees it | PASS | session log |
| B10 | Tick / untick / tick → one "completed" card | PASS after fix (3 identical cards before) | DB check, server test |
| B11 | Own action cards ("Rishit completed Task 22") are not unread for the actor | PASS after fix | server test |
| B12 | Logcat on both devices: crash buffer + FATAL / ReactNativeJS errors | PASS (0) | logcat-filtered.txt |

### Fixes (all JS or server; no native change, no new permission)
| Commit | Fix |
|---|---|
| 43e97c1, c5f0034 | Check-in card reply box stays above the keyboard while typing (known limit 1); Back closes the emoji panel; delete for everyone asks first |
| b402cb1 | Task card Undo only where the server allows it (assigned card = admin; completed card only while still done); Change people / Edit title follow `membersCanAssign`; last Hinglish strings ("Photo badlo", "/done" help) + wider English source scan |
| f5b5078 | A reply in the member's own check-in chat always reaches the AI (a bare "Update the onboarding guide" → task) |
| 709ac0c | AI pre-filter: Hinglish "kar dunga / karunga / karne / lunga …" and "need/have to" |
| b68abe6 | Login form max width on tablets |
| 713fd72 | The card of my own task action is not unread for me (other people's unread messages stay unread) |
| 4ba2a42 | Task search: "nothing matches" text |
| dc2735b | No stale task sheet after close → reopen |
| 904b7e4 | Admin settings labels; Praise switch hidden (the button itself was removed in Round 4) |
| 7b35b34 | Reports: "Report Submitted" counts check-in card replies |
| ffc2706 | One "completed" card per person and task within 10 minutes |

Tests after the fixes: server **92/92** (+4), app **111/111** (+5), `tsc` 0 errors (`server-tests.txt`, `app-tests.txt`).

Notes
1. Unexplained input on the tablet (someone touched it): at 00:03 a voice note was recorded in the member's check-in chat (real room speech; the AI answered with the task list; its transcript is masked in B-13 and no other kept screenshot shows it); at 00:34–00:35 Task 23 was ticked and unticked seven times in the admin session while the script was idle. The second event exposed the duplicate-card bug fixed in ffc2706.
2. Background notifications on the tablet did not appear after many Metro hot reloads in the session (`AppState` said `active` while the app was in the background); after a clean app start they worked at once (A-23). Dev session only (no hot reload in a release build); not changed.
3. Known limit 2: on this OnePlus the silent TeamChat notifications are grouped; the first tap expands the group, the second opens the Daily Check-in chat. That is probably what was seen before; the app's tap handler opens the right chat.
4. Test-data artifacts, not bugs: two morning/evening card pairs dated 20 Nov in Anubhav's check-in chat (an earlier run cleared the `checkin_prompts` markers); the 00:00 "Good morning" cards came from the admin `jobs/run` override; replies before the evening time count as the "morning" reply in Reports.
5. Left as is (cosmetic or by design): a captioned photo shows "📷 Photo" in the chat list; the Keep grid keeps two columns on a phone even with one card (Keep look); the emoji panel uses 7 columns on the tablet; a self-task card reads "Anubhav assigned Task 16 to Anubhav".
6. Not covered: camera / Geo camera (would photograph the room), calls, adding or editing members (viewed only, to keep the test data stable), release APK.

### Deploy notes
Server files changed: `ai/engine.js`, `ai/bot.js`, `tasks.js` (no migration). App changes are JS only (OTA on the same runtimeVersion).
