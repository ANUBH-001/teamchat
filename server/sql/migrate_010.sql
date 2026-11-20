-- Round 4 (2026-11-20): profile photo + onboarding flag, favourite chats, media messages (image/audio), private admin tasks.
-- Run after migrate_009. BACK UP THE DB FIRST.
-- No USE line on purpose: pass the DB name, e.g.
--   local: mysql -h 127.0.0.1 -P 3307 -u root teamchat < sql/migrate_010.sql
--   prod:  mysql -u team_chat_user -p team_chat_db < sql/migrate_010.sql

-- 1. users: profile photo url (/media/f/...) + onboarding flag (every human sees onboarding once; bots never)
ALTER TABLE users ADD COLUMN avatar_url VARCHAR(255) NULL, ADD COLUMN profile_done TINYINT NOT NULL DEFAULT 0;
UPDATE users SET profile_done = 0 WHERE is_bot = 0;
UPDATE users SET profile_done = 1 WHERE is_bot = 1;

-- 2. chat_members: favourite chats (per user)
ALTER TABLE chat_members ADD COLUMN favourite TINYINT NOT NULL DEFAULT 0;

-- 3. messages: media (type 'image' | 'audio'; messages.type is a free VARCHAR). media = JSON text:
--    {kind: image|audio|geo_image, w, h, durationMs, waveform[], lat, lng, address, takenAt, transcript, transcriptStatus: pending|done|failed}
ALTER TABLE messages ADD COLUMN media_url VARCHAR(255) NULL, ADD COLUMN media TEXT NULL;

-- 4. tasks: private = admin's own task (only the creator boss sees it)
ALTER TABLE tasks ADD COLUMN private TINYINT NOT NULL DEFAULT 0;

-- 5. old in-between statuses (planning / coding / testing / change_merged) become plain todo (only todo / done / closed exist now).
--    Safe to run again. Local DB: run just these UPDATEs if 1-4 were applied earlier.
UPDATE task_assignees SET status = 'todo' WHERE status NOT IN ('todo', 'done');
UPDATE tasks SET status = 'todo' WHERE status NOT IN ('todo', 'done', 'closed');
UPDATE task_events SET old_value = 'todo' WHERE event = 'status' AND old_value IN ('planning', 'coding', 'testing', 'change_merged');
UPDATE task_events SET new_value = 'todo' WHERE event = 'status' AND new_value IN ('planning', 'coding', 'testing', 'change_merged');
