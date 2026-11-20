CREATE DATABASE IF NOT EXISTS teamchat CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE teamchat;

CREATE TABLE IF NOT EXISTS users (
  id INT AUTO_INCREMENT PRIMARY KEY,
  phone VARCHAR(20) NOT NULL UNIQUE,
  name VARCHAR(100) NOT NULL,
  role ENUM('boss','member') NOT NULL DEFAULT 'member',
  pin_hash VARCHAR(255) NULL,
  active TINYINT(1) NOT NULL DEFAULT 1,
  failed_attempts INT NOT NULL DEFAULT 0,
  locked_until TIMESTAMP NULL,
  is_bot TINYINT(1) NOT NULL DEFAULT 0, -- 'Team Assistant' system user (inactive, cannot log in)
  avatar_emoji VARCHAR(16) NULL,
  session_id CHAR(32) NULL, -- current login (JWT sv); a new login rotates it and logs the old device out
  avatar_url VARCHAR(255) NULL, -- round 4: /media/f/... profile photo
  profile_done TINYINT NOT NULL DEFAULT 0, -- round 4: onboarding seen (bots = 1)
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS invites (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL,
  code VARCHAR(64) NOT NULL UNIQUE,
  used_at TIMESTAMP NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS chats (
  id INT AUTO_INCREMENT PRIMARY KEY,
  type ENUM('all','group','dm','checkin') NOT NULL,
  name VARCHAR(100) NULL,
  created_by INT NULL,
  owner_id INT NULL, -- 'checkin' chats only: the member who owns this private chat (one per member)
  pinned_message_id BIGINT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  deleted_at TIMESTAMP NULL,
  UNIQUE KEY uq_checkin_owner (owner_id),
  FOREIGN KEY (created_by) REFERENCES users(id),
  FOREIGN KEY (owner_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS chat_members (
  chat_id INT NOT NULL,
  user_id INT NOT NULL,
  joined_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  left_at TIMESTAMP NULL,
  last_read_message_id BIGINT NULL,
  last_delivered_message_id BIGINT NULL,
  muted TINYINT(1) NOT NULL DEFAULT 0,
  pinned TINYINT(1) NOT NULL DEFAULT 0,
  favourite TINYINT NOT NULL DEFAULT 0, -- round 4
  PRIMARY KEY (chat_id, user_id),
  FOREIGN KEY (chat_id) REFERENCES chats(id),
  FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS messages (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  chat_id INT NOT NULL,
  sender_id INT NOT NULL,
  body TEXT NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  edited_at TIMESTAMP NULL,
  deleted_at TIMESTAMP NULL,
  client_id VARCHAR(64) NULL,
  type VARCHAR(20) NOT NULL DEFAULT 'text', -- text | bot | system | checkin_prompt | image | audio
  payload TEXT NULL, -- JSON for bot messages (task card / summary / clarify)
  reply_to_id BIGINT NULL, -- swipe-to-reply: quoted message in the same chat
  visible_to INT NULL, -- ephemeral bot reply: only this user ever receives it
  mentions TEXT NULL, -- JSON array of mentioned user ids
  source_message_id BIGINT NULL, -- bot card: the human message that caused it (no FK: purge hard-deletes)
  task_id INT NULL, -- card / command / #N message / reply in a task reply chain
  media_url VARCHAR(255) NULL, -- round 4: /media/f/... (image / audio)
  media TEXT NULL, -- round 4: JSON {kind, w, h, durationMs, waveform, lat, lng, address, takenAt, transcript, transcriptStatus}
  INDEX idx_chat_created (chat_id, created_at),
  INDEX idx_msg_source (source_message_id),
  INDEX idx_msg_task (task_id),
  INDEX idx_msg_chat_id (chat_id, id),
  INDEX idx_msg_reply (reply_to_id),
  INDEX idx_visible_to (visible_to),
  INDEX idx_messages_created (created_at),
  FOREIGN KEY (visible_to) REFERENCES users(id),
  UNIQUE KEY uq_sender_client (sender_id, client_id),
  FOREIGN KEY (chat_id) REFERENCES chats(id),
  FOREIGN KEY (sender_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS message_revisions (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  message_id BIGINT NOT NULL,
  old_body TEXT NOT NULL,
  edited_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (message_id) REFERENCES messages(id)
);

CREATE TABLE IF NOT EXISTS tasks (
  id INT AUTO_INCREMENT PRIMARY KEY,
  title VARCHAR(255) NOT NULL,
  description TEXT NULL,
  assignee_id INT NULL,
  created_by INT NULL,
  source_message_id BIGINT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'todo', -- aggregate: todo|planning|coding|testing|change_merged|done, or closed
  due_at TIMESTAMP NULL,
  completed_at TIMESTAMP NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  deleted_at TIMESTAMP NULL,
  project VARCHAR(60) NULL,
  chat_id INT NULL, -- chat where the task was made (/task); bot cards go there
  reminded_at TIMESTAMP NULL, -- 6-day pending reminder sent (once)
  closed_at TIMESTAMP NULL,
  closed_by INT NULL,
  private TINYINT NOT NULL DEFAULT 0, -- round 4: admin's own task, only the creator boss sees it
  INDEX idx_tasks_created (created_at),
  INDEX idx_tasks_assignee_status (assignee_id, status),
  CONSTRAINT fk_tasks_closed_by FOREIGN KEY (closed_by) REFERENCES users(id),
  FOREIGN KEY (assignee_id) REFERENCES users(id),
  FOREIGN KEY (chat_id) REFERENCES chats(id),
  FOREIGN KEY (created_by) REFERENCES users(id),
  FOREIGN KEY (source_message_id) REFERENCES messages(id)
);

CREATE TABLE IF NOT EXISTS task_events (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  task_id INT NOT NULL,
  actor_id INT NULL,
  event VARCHAR(50) NOT NULL,
  old_value TEXT NULL,
  new_value TEXT NULL,
  source VARCHAR(10) NOT NULL DEFAULT 'manual',
  message_id BIGINT NULL, -- chat message that triggered the change
  subject_id INT NULL, -- 'status': whose per-person status changed
  chat_id INT NULL, -- chat of message_id (kept after the purge)
  source_text VARCHAR(1000) NULL, -- snapshot of the message text
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_te_message (message_id),
  INDEX idx_te_task (task_id, id),
  FOREIGN KEY (task_id) REFERENCES tasks(id)
);

-- Multi-assignee: one row per person, own status; tasks.status = aggregate (lowest step; done when all done)
CREATE TABLE IF NOT EXISTS task_assignees (
  task_id INT NOT NULL,
  user_id INT NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'todo',
  completed_at TIMESTAMP NULL,
  added_by INT NULL,
  added_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  removed_at TIMESTAMP NULL,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (task_id, user_id),
  INDEX idx_ta_user (user_id, removed_at, status),
  FOREIGN KEY (task_id) REFERENCES tasks(id),
  FOREIGN KEY (user_id) REFERENCES users(id)
);

-- One reaction per user per message; removing sets deleted_at, reacting again revives the row.
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

-- Per-chat switches (botEnabled, aiDetect, notifyAdmin), JSON values. Global switches live in app_settings.
CREATE TABLE IF NOT EXISTS chat_settings (
  chat_id INT NOT NULL,
  name VARCHAR(64) NOT NULL,
  value TEXT NOT NULL,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (chat_id, name),
  FOREIGN KEY (chat_id) REFERENCES chats(id)
);

CREATE TABLE IF NOT EXISTS push_tokens (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL,
  token VARCHAR(255) NOT NULL UNIQUE,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id)
);

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

-- Scheduler marker: one row per user/date/kind (day|signoff|signoff_nudge; old: morning|evening|*_nudge), so restarts never double-post.
CREATE TABLE IF NOT EXISTS checkin_prompts (
  user_id INT NOT NULL,
  date DATE NOT NULL,
  kind VARCHAR(20) NOT NULL,
  message_id BIGINT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id, date, kind),
  FOREIGN KEY (user_id) REFERENCES users(id)
);

-- Evening sign-off (round 2): one row per member per day
CREATE TABLE IF NOT EXISTS signoffs (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL,
  date DATE NOT NULL,
  note TEXT NULL,
  summary TEXT NULL, -- JSON {counts:{given,done,left}, tasks:[{id,title,status}]}
  message_id BIGINT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_signoff (user_id, date),
  INDEX idx_signoff_date (date),
  FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS app_settings (
  name VARCHAR(64) PRIMARY KEY,
  value TEXT NOT NULL, -- JSON
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

INSERT IGNORE INTO app_settings (name, value) VALUES
  ('checkin.enabled', 'true'), ('checkin.morningTime', '"10:00"'), ('checkin.eveningTime', '"18:00"'),
  ('checkin.days', '[1,2,3,4,5,6]'), ('checkin.nudgeMinutes', '120');
