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
