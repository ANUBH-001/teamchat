-- Run once on DBs created before the feedback round (slash commands, Testing status, reactions, pins, settings).
-- Run migrate_005 + 006 first. No USE line on purpose: pass the DB name, e.g.
--   local: mysql -h 127.0.0.1 -P 3307 -u root teamchat < sql/migrate_007.sql
--   prod:  mysql -u team_chat_user -p team_chat_db < sql/migrate_007.sql
ALTER TABLE tasks MODIFY status ENUM('todo','in_progress','review','done') NOT NULL DEFAULT 'todo',
  ADD COLUMN project VARCHAR(60) NULL,
  ADD COLUMN chat_id INT NULL,
  ADD FOREIGN KEY (chat_id) REFERENCES chats(id);

ALTER TABLE messages ADD COLUMN visible_to INT NULL,
  ADD COLUMN mentions TEXT NULL,
  ADD INDEX idx_visible_to (visible_to),
  ADD FOREIGN KEY (visible_to) REFERENCES users(id);

ALTER TABLE chats ADD COLUMN pinned_message_id BIGINT NULL;

ALTER TABLE chat_members ADD COLUMN muted TINYINT(1) NOT NULL DEFAULT 0,
  ADD COLUMN pinned TINYINT(1) NOT NULL DEFAULT 0;

-- One reaction per user per message; removing sets deleted_at (soft delete), reacting again revives the row.
CREATE TABLE IF NOT EXISTS message_reactions (
  message_id BIGINT NOT NULL,
  user_id INT NOT NULL,
  emoji VARCHAR(16) NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  deleted_at TIMESTAMP NULL,
  PRIMARY KEY (message_id, user_id),
  FOREIGN KEY (message_id) REFERENCES messages(id),
  FOREIGN KEY (user_id) REFERENCES users(id)
);

-- Per-chat switches (botEnabled, aiDetect, notifyAdmin), JSON values. Global switches live in app_settings (name, value).
CREATE TABLE IF NOT EXISTS chat_settings (
  chat_id INT NOT NULL,
  name VARCHAR(64) NOT NULL,
  value TEXT NOT NULL,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (chat_id, name),
  FOREIGN KEY (chat_id) REFERENCES chats(id)
);
