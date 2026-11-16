-- Run once on DBs created before tasks (Phase 3)
USE teamchat;
ALTER TABLE tasks ADD COLUMN completed_at TIMESTAMP NULL;
ALTER TABLE task_events ADD COLUMN source VARCHAR(10) NOT NULL DEFAULT 'manual';
