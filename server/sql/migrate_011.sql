-- Hardening (2026-11-20) B-03: media access control. Run after migrate_010. Additive only (no data is changed or deleted).
-- BACK UP THE DB FIRST anyway.
-- No USE line on purpose: pass the DB name, e.g.
--   local: mysql -h 127.0.0.1 -P 3307 -u root teamchat < sql/migrate_011.sql
--   prod:  mysql -u team_chat_user -p team_chat_db < sql/migrate_011.sql

-- 1. who uploaded each /media/f/ file (POST /media). Lets the uploader see a file between upload and send / profile save.
--    Files uploaded before this migration have no row: they stay visible through their message (chat members) or profile photo.
CREATE TABLE IF NOT EXISTS media_files (
  path VARCHAR(255) NOT NULL PRIMARY KEY, -- /media/f/yyyy/mm/<uuid>.<ext>
  uploader_id INT NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_media_uploader (uploader_id),
  FOREIGN KEY (uploader_id) REFERENCES users(id)
);

-- 2. access checks look messages / profile photos up by file path
ALTER TABLE messages ADD INDEX idx_msg_media_url (media_url);
ALTER TABLE users ADD INDEX idx_users_avatar_url (avatar_url);
