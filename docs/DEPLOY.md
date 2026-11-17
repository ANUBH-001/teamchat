# DEPLOY: Team Chat backend on the company server (done 2026-11-17)

Sirf **backend** live hai. Frontend = Android app (release APK, Phase 7 baaki). Koi secret is file me nahi hai.

| Cheez | Value |
|---|---|
| Public URL | `https://apps.landauditors.com/team_chat` (health: `/team_chat/health`) |
| App ka `EXPO_PUBLIC_SERVER_URL` | `https://apps.landauditors.com/team_chat` (WebSocket: `wss://.../team_chat/?token=...`) |
| Server folder | `/opt/node/team-chat` (git clone, code `server/`) |
| PM2 name / port | `team-chat-backend` / `3150` (127.0.0.1) |
| DB | MySQL 8.0 on same server, DB `team_chat_db`, user `team_chat_user` (access sirf us DB par). Creds `server/.env` me (git-ignored, chmod 600) |
| Apache | snippet `/etc/apache2/snippets/team-chat.conf` + 1 `Include` line in `/etc/apache2/sites-enabled/apps.landauditors.com-le-ssl.conf` (after jarvis include). Backup: `*.bak-teamchat-<time>` |
| Admins (role `boss`) | Anubhav 9119071165, TestingMan 1111111169. Pehli login: phone + invite code, phir PIN khud chuno |
| AI | `AI_PROVIDER=mock` (key server par nahi rakhi). Asli AI: `server/.env` me `AI_PROVIDER=anthropic`, `AI_API_KEY=...` daalo, phir `pm2 restart team-chat-backend --update-env` |

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
