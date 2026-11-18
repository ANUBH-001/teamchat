-- Round 2 (2026-11-17): task reminders, evening sign-offs, retention, new check-in times.
-- Run after migrate_007. No USE line on purpose: pass the DB name, e.g.
--   local: mysql -h 127.0.0.1 -P 3307 -u root teamchat < sql/migrate_008.sql
--   prod:  mysql -u team_chat_user -p team_chat_db < sql/migrate_008.sql

-- 6-day pending reminder sent once per task (NULL = not yet)
ALTER TABLE tasks ADD COLUMN reminded_at TIMESTAMP NULL,
  ADD INDEX idx_tasks_created (created_at);

-- weekly purge scans by age
ALTER TABLE messages ADD INDEX idx_messages_created (created_at);

-- Evening sign-off: one row per member per day (re-submitting updates it)
CREATE TABLE IF NOT EXISTS signoffs (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL,
  date DATE NOT NULL,
  note TEXT NULL,
  summary TEXT NULL, -- JSON {counts:{given,done,left}, tasks:[{id,title,status}]}
  message_id BIGINT NULL, -- member message in the check-in chat
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_signoff (user_id, date),
  INDEX idx_signoff_date (date),
  FOREIGN KEY (user_id) REFERENCES users(id)
);

-- New check-in times: morning task card 10:00, evening sign-off 18:00 (editable in Check-in settings)
INSERT INTO app_settings (name, value) VALUES ('checkin.morningTime', '"10:00"'), ('checkin.eveningTime', '"18:00"')
  ON DUPLICATE KEY UPDATE value = VALUES(value);
