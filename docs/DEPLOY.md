# DEPLOY: Team Chat backend on the company server (done 2026-11-17)

Backend live hai (7a). Frontend = Android release APK 0.2.0 (versionCode 2, `d:\r&D\TeamChat-0.2.0.apk`, also at `/team_chat/download/TeamChat.apk`). Koi secret is file me nahi hai.

| Cheez | Value |
|---|---|
| Public URL | `https://apps.landauditors.com/team_chat` (health: `/team_chat/health`) |
| App ka `EXPO_PUBLIC_SERVER_URL` | `https://apps.landauditors.com/team_chat` (WebSocket: `wss://.../team_chat/?token=...`) |
| Server folder | `/opt/node/team-chat` (git clone, code `server/`) |
| PM2 name / port | `team-chat-backend` / `3150` (127.0.0.1) |
| DB | MySQL 8.0 on same server, DB `team_chat_db`, user `team_chat_user` (access sirf us DB par). Creds `server/.env` me (git-ignored, chmod 600) |
| Apache | snippet `/etc/apache2/snippets/team-chat.conf` + 1 `Include` line in `/etc/apache2/sites-enabled/apps.landauditors.com-le-ssl.conf` (after jarvis include). Backup: `*.bak-teamchat-<time>` |
| Admins (role `boss`) | Anubhav 9119071165, TestingMan 1111111169. Pehli login: phone + invite code, phir PIN khud chuno |
| AI | `AI_PROVIDER=mock` abhi (key server par nahi). Asli AI (owner ke OK ke baad): `server/.env` me `AI_PROVIDER=anthropic`, `AI_MODEL=claude-haiku-5-5`, `AI_API_KEY=...`, phir `pm2 restart team-chat-backend --update-env` |

## Pehli baar kya kiya (commands, `ssh root@<server>` ke andar)
1. Dekha (read-only): `pm2 list`, `ss -ltn` (free port), `ls /etc/apache2/snippets`, `apachectl -M | grep proxy` (proxy_wstunnel chahiye), `node -v` (18 chala).
2. Code: `git clone https://github.com/ANUBH-001/teamchat.git /opt/node/team-chat` (repo public).
3. `cd /opt/node/team-chat/server && npm install --omit=dev`
4. `.env` banayi (DB creds, `PORT=3150`, naya random `JWT_SECRET`, `TZ=Asia/Kolkata`), `chmod 600 .env`.
5. Schema (naya khali DB): `tail -n +3 sql/schema.sql | mysql -u team_chat_user -p team_chat_db` (pehli 2 lines `CREATE DATABASE/USE teamchat` hatani hain, user ko sirf apni DB ka haq hai). Migrations 001-006 schema.sql me shamil.
6. Admins: `users` me role `boss`, "All Team" chat + members, bot user, invite codes (SHA-256 hash) banaye (seed.js jaisa logic). Boss ko check-in chat nahi milti.
7. PM2: `cd server && pm2 start src/index.js --name team-chat-backend && pm2 save` (kabhi `pm2 restart all` nahi).
8. Apache: snippet file likhi, `cp -p vhost vhost.bak-teamchat-<time>`, `Include` line jodi, `apachectl configtest` (Syntax OK ho tabhi) -> `systemctl reload apache2` (restart nahi).
   Snippet: `ProxyPass /team_chat/ http://127.0.0.1:3150/ upgrade=websocket timeout=3600` + `ProxyPassReverse`. Prefix hat kar app tak jata hai; `upgrade=websocket` se same path par WebSocket.
9. Verify: `curl https://apps.landauditors.com/team_chat/health` -> `{"ok":true,"db":true}`; WebSocket handshake 101; baaki apps (`/plms/`, `/crml/`, ...) 200.

## Agli baar update (code badla ho)
```
ssh root@<server>
cd /opt/node/team-chat && git log -1 --oneline        # rollback ke liye hash likho
git pull origin main
cd server && npm install --omit=dev
# agar naya sql/migrate_00X.sql aaya: mysql -u team_chat_user -p team_chat_db < sql/migrate_00X.sql  (server start se PEHLE)
pm2 restart team-chat-backend --update-env && pm2 save
curl -s https://apps.landauditors.com/team_chat/health
pm2 logs team-chat-backend --lines 40 --nostream
```
Rollback: `git reset --hard <purana hash>` (server par koi local edit nahi hona chahiye) phir `pm2 restart team-chat-backend`.
Apache rollback: `cp -p <vhost>.bak-teamchat-<time> <vhost>; apachectl configtest && systemctl reload apache2`.

## Dhyan
- Doosre apps/PM2/Apache/DB ko mat chhedo; sirf `team-chat-*` naam aur `/team_chat` path.
- Member add: app ke Admin tab se (invite code wahi se). Backup roz 02:00 `server/backup/*.json` (server par), DB ka alag backup apne hisaab se.
- Local `server/src/.env` me server password hai (git-ignored); chat/log me kabhi mat bhejo. Purane secrets rotate karne ki salah DEPLOYMENT_GUIDE.md me hai.

## Release APK (Phase 7b, 2026-11-17)
Output: `d:\r&D\TeamChat-release.apk` (~70 MB, Hermes bundle inside, talks to `https://apps.landauditors.com/team_chat`, no PC/Metro needed). `app.json` `extra.serverUrl` is the same URL.
Keystore: `D:\Android\keystore\teamchat-release.jks` (alias `teamchat`); passwords only in `D:\Android\keystore\README-keystore.txt` and `D:\Android\gradle\gradle.properties` (`TEAMCHAT_*` keys). Back the keystore up: a lost key means no in-place updates.
Rebuild (PowerShell; `subst T: "D:\r&D\team-app"` if missing; `android/` is generated, `app/build.gradle` release `signingConfig` reads the `TEAMCHAT_*` properties):
```
$env:EXPO_PUBLIC_SERVER_URL='https://apps.landauditors.com/team_chat'; $env:JAVA_HOME='D:\Android\jdk17'; $env:ANDROID_HOME='D:\Android\Sdk'; $env:GRADLE_USER_HOME='D:\Android\gradle'
cd T:\app\android; .\gradlew.bat assembleRelease     # ~18 min first time
```
APK: `app/android/app/build/outputs/apk/release/app-release.apk`. If `expo prebuild` regenerates `android/`, re-apply the release signingConfig in `app/android/app/build.gradle`. Minify is off (default).
Install: the old debug build has a different signature, so UNINSTALL it first. On OnePlus: App info -> Battery usage -> "Allow background activity".
Feedback-round build: versionCode 2 (`app.json` + `src/version.ts`), new native dep `expo-clipboard`; same command, same keystore (so in-place update works for installed release builds).
Version bump checklist: `app.json` (version + android.versionCode), `src/version.ts`, AND the generated `app/android/app/build.gradle` (`versionCode` / `versionName`, not regenerated without prebuild). Check with `aapt dump badging <apk>`.

## Feedback round update (DONE 2026-11-17: pushed 2a76c17, migrate_007 applied, AI=anthropic live, APK uploaded, latest=2, min=0; DB backup /root/team-chat-dbbackup/pre-007-*.sql)
Order zaroor yahi. Server code, migration, AI key, APK aur force-update settings ek saath jaate hain.
1. Migration (naya server start se PEHLE; file me `USE` nahi hai, DB naam dena zaroori). Prod par sirf 007 baaki (001-006 schema me hain):
   `mysql -u team_chat_user -p team_chat_db < /opt/node/team-chat/server/sql/migrate_007.sql`
2. AI (sirf owner ke OK ke baad): `server/.env` me `AI_PROVIDER=anthropic`, `AI_MODEL=claude-haiku-5-5`, `AI_API_KEY=...`. Key kabhi chat/log/git me nahi.
3. Code: "Agli baar update" steps (git pull, npm install --omit=dev, pm2 restart --update-env, health check).
4. APK upload (`*.apk` git-ignored, git pull se nahi aata): release APK rebuild karke PC se server par copy karein:
   `scp <path>\app-release.apk root@<server>:/opt/node/team-chat/server/public/download/TeamChat.apk`
   Check: `curl -sI https://apps.landauditors.com/team_chat/download/TeamChat.apk` -> 200.
5. Force update (Admin app -> Settings -> App update), is order me:
   a. Latest version code `2`, version name `0.2.0`, APK URL `https://apps.landauditors.com/team_chat/download/TeamChat.apk`, short message. Purane app users ko dismissible banner dikhega.
   b. Jab sab ne update kar liya ya ready ho: min version code `2`. Tab v1 build par blocking Update screen aati hai (server 426 `UPDATE_REQUIRED`).
   Rollback: min version code `0` (sab unblock).

## Round 2 update (DEPLOYED 2026-11-18: pushed 0db6464, rollback hash 2a76c17, DB backup /root/team-chat-dbbackup/pre-008-20261118-0827.sql, migrate_008 applied, retention ON by owner's choice)
Then owner asked for a fresh start: admin reset run on prod 08:30 (backups `/root/team-chat-dbbackup/pre-reset-20261118-0830.sql` + `server/backup/reset-*.json`); users kept. APK 0.3.0 uploaded as `TeamChat.apk` (old one at `/root/TeamChat-0.2.0.bak.apk`, local copy `d:\r&D\TeamChat-0.3.0.apk`), latest = 3, min = 0.
Note: code default `latestVersionCode` is 3, so set it in `app_settings` (or Settings) to the version whose APK is actually uploaded; otherwise old clients get a banner for an APK that is not there yet.
1. DB backup first (`mysqldump ... team_chat_db > /root/team-chat-dbbackup/pre-008-<date>.sql`), then BEFORE the new server starts:
   `mysql -u team_chat_user -p team_chat_db < /opt/node/team-chat/server/sql/migrate_008.sql`
   (adds `tasks.reminded_at`, `signoffs`, two indexes; sets check-in times 10:00 / 18:00).
2. Code: git pull, `npm install --omit=dev`, `pm2 restart team-chat-backend --update-env`, health check. No new env keys. TZ must stay `Asia/Kolkata`.
3. WARNING retention is ON by default (`retentionEnabled:true`): the first Sunday 23:00 after deploy HARD-deletes messages older than 7 days, and the
   daily job deletes tasks older than 14 days (both dump JSON to `server/backup/` first). Turn it off in Admin > Settings > Data retention if not wanted yet.
4. APK 0.3.0 / versionCode 3 (no new native dep): rebuild release, upload as `TeamChat.apk`, then Settings: latest code `3`, name `0.3.0`; min `3` only when everyone updated.

## Round 3 update (DEPLOYED 2026-11-19: pushed 599a2f6, rollback hash 0db6464 + /root/team-chat-dbbackup/pre-009-20261119-1141.sql, APK 0.4.0 uploaded (old at /root/TeamChat-0.3.0.bak.apk, local `d:\r&D\TeamChat-0.4.0.apk`), migrate_009 applied, latest = min = 4, ws Authorization header verified through Apache)
Forced update: 0.3.0 clients will be blocked (426) once min = 4; announce to the team first. Order:
1. Release APK 0.4.0 (no new native dep) -> upload FIRST as `server/public/download/TeamChat.apk` (keep the old one as a .bak). Check `curl -sI .../download/TeamChat.apk` -> 200.
2. DB backup: `mysqldump ... team_chat_db > /root/team-chat-dbbackup/pre-009-<date>.sql`.
3. BEFORE the new server starts: `mysql -u team_chat_user -p team_chat_db < /opt/node/team-chat/server/sql/migrate_009.sql`
   (task_assignees + backfill, statuses in_progress->coding / review->testing, deleted tasks -> closed, message link columns + backfill, avatar_emoji, session_id, indexes).
4. Code: git pull, `npm install --omit=dev`, `pm2 restart team-chat-backend --update-env`, health check. No new env keys. Reverse proxy must pass the `Authorization` header on the WebSocket upgrade (it does for REST).
5. Admin > Settings > App update: latest code `4`, name `0.4.0`, then min `4`.
Notes: nobody is logged out at deploy (session_id NULL until each user's next login). taskcleanup now deletes only done/closed tasks 14 days after finishing.
Rollback: min `0`, restore the pre-009 dump, `git checkout <previous hash>`, restart (the old code cannot read multi-assignee data written after 009).
