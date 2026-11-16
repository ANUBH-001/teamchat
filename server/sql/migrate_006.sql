-- Run once on DBs created before daily check-ins (Phase 8b). Run migrate_005.sql first.
USE teamchat;
ALTER TABLE chats MODIFY type ENUM('all','group','dm','checkin') NOT NULL,
  ADD COLUMN owner_id INT NULL,
  ADD UNIQUE KEY uq_checkin_owner (owner_id),
  ADD FOREIGN KEY (owner_id) REFERENCES users(id);
ALTER TABLE messages MODIFY type VARCHAR(20) NOT NULL DEFAULT 'text';
-- Daily check-ins (Phase 8b). Dates are local dates in TZ (default Asia/Kolkata).
CREATE TABLE IF NOT EXISTS checkins (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL,
  date DATE NOT NULL,
  kind ENUM('morning','evening') NOT NULL,
  text TEXT NULL, -- raw member text (always kept)
  summary TEXT NULL, -- JSON {done:[], pending:[], blockers:[]}
  payload TEXT NULL, -- JSON {selectedTaskIds:[], taskStatuses:{id:status}, tasks:[{id,title,status,dueDate}]}
  message_id BIGINT NULL, -- member message in the check-in chat
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_checkin (user_id, date, kind),
  INDEX idx_checkin_date (date),
  FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS checkin_revisions (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  checkin_id INT NOT NULL,
  old_text TEXT NULL,
  old_payload TEXT NULL,
  edited_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (checkin_id) REFERENCES checkins(id)
);

-- Scheduler marker: one row per user/date/kind (morning|evening|morning_nudge|evening_nudge), so restarts never double-post.
CREATE TABLE IF NOT EXISTS checkin_prompts (
  user_id INT NOT NULL,
  date DATE NOT NULL,
  kind VARCHAR(20) NOT NULL,
  message_id BIGINT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id, date, kind),
  FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS app_settings (
  name VARCHAR(64) PRIMARY KEY,
  value TEXT NOT NULL, -- JSON
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

INSERT IGNORE INTO app_settings (name, value) VALUES
  ('checkin.enabled', 'true'), ('checkin.morningTime', '"10:00"'), ('checkin.eveningTime', '"18:30"'),
  ('checkin.days', '[1,2,3,4,5,6]'), ('checkin.nudgeMinutes', '120');
