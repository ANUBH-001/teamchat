-- Run once on DBs created before the AI engine (Phase 4)
USE teamchat;
ALTER TABLE users ADD COLUMN is_bot TINYINT(1) NOT NULL DEFAULT 0;
ALTER TABLE messages ADD COLUMN type VARCHAR(10) NOT NULL DEFAULT 'text', ADD COLUMN payload TEXT NULL;
ALTER TABLE task_events ADD COLUMN message_id BIGINT NULL;
