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
  type ENUM('all','group','dm') NOT NULL,
  name VARCHAR(100) NULL,
  created_by INT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  deleted_at TIMESTAMP NULL,
  FOREIGN KEY (created_by) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS chat_members (
  chat_id INT NOT NULL,
  user_id INT NOT NULL,
  joined_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  left_at TIMESTAMP NULL,
  last_read_message_id BIGINT NULL,
  last_delivered_message_id BIGINT NULL,
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
  type VARCHAR(10) NOT NULL DEFAULT 'text', -- text | bot
  payload TEXT NULL, -- JSON for bot messages (task card / summary / clarify)
  reply_to_id BIGINT NULL, -- swipe-to-reply: quoted message in the same chat
  INDEX idx_chat_created (chat_id, created_at),
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
  status ENUM('todo','in_progress','done') NOT NULL DEFAULT 'todo',
  due_at TIMESTAMP NULL,
  completed_at TIMESTAMP NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  deleted_at TIMESTAMP NULL,
  FOREIGN KEY (assignee_id) REFERENCES users(id),
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
  message_id BIGINT NULL, -- chat message that triggered an 'ai' change
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (task_id) REFERENCES tasks(id)
);

CREATE TABLE IF NOT EXISTS push_tokens (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL,
  token VARCHAR(255) NOT NULL UNIQUE,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id)
);
