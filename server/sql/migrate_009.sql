-- Round 3 (2026-11-18): multi-assignee tasks, 7 statuses, close instead of delete, message <-> task links,
-- emoji avatars, one login per user. Run after migrate_008. BACK UP THE DB FIRST.
-- No USE line on purpose: pass the DB name, e.g.
--   local: mysql -h 127.0.0.1 -P 3307 -u root teamchat < sql/migrate_009.sql
--   prod:  mysql -u team_chat_user -p team_chat_db < sql/migrate_009.sql

-- 1. users: emoji avatar + current login session (NULL = old token without sv still accepted until the next login)
ALTER TABLE users ADD COLUMN avatar_emoji VARCHAR(16) NULL, ADD COLUMN session_id CHAR(32) NULL;

-- 2. tasks: free status key, close columns, index for assignee lists
ALTER TABLE tasks MODIFY status VARCHAR(20) NOT NULL DEFAULT 'todo',
  ADD COLUMN closed_at TIMESTAMP NULL, ADD COLUMN closed_by INT NULL,
  ADD INDEX idx_tasks_assignee_status (assignee_id, status),
  ADD CONSTRAINT fk_tasks_closed_by FOREIGN KEY (closed_by) REFERENCES users(id);

-- 3. statuses: in_progress -> coding, review -> testing
UPDATE tasks SET status = 'coding' WHERE status = 'in_progress';
UPDATE tasks SET status = 'testing' WHERE status = 'review';

-- 4. per-person assignees (tasks.assignee_id stays as the primary = first assignee)
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

-- 5. one assignee row per existing task
INSERT IGNORE INTO task_assignees (task_id, user_id, status, completed_at, added_by, added_at)
  SELECT id, assignee_id, status, completed_at, created_by, created_at FROM tasks WHERE assignee_id IS NOT NULL;

-- 6. soft-deleted tasks become closed (after step 5 so assignee rows keep their real status)
UPDATE tasks SET status = 'closed', closed_at = deleted_at, deleted_at = NULL WHERE deleted_at IS NOT NULL;

-- 7. task_events: per-person status subject, source chat + text snapshot (messages are purged weekly)
ALTER TABLE task_events ADD COLUMN subject_id INT NULL, ADD COLUMN chat_id INT NULL, ADD COLUMN source_text VARCHAR(1000) NULL,
  ADD INDEX idx_te_message (message_id), ADD INDEX idx_te_task (task_id, id);

-- 8. status history keys + subject
UPDATE task_events SET old_value = 'coding' WHERE event = 'status' AND old_value = 'in_progress';
UPDATE task_events SET new_value = 'coding' WHERE event = 'status' AND new_value = 'in_progress';
UPDATE task_events SET old_value = 'testing' WHERE event = 'status' AND old_value = 'review';
UPDATE task_events SET new_value = 'testing' WHERE event = 'status' AND new_value = 'review';
UPDATE task_events e JOIN tasks t ON t.id = e.task_id SET e.subject_id = t.assignee_id WHERE e.event = 'status';

-- 9. source backfill
UPDATE task_events e JOIN messages m ON m.id = e.message_id SET e.chat_id = m.chat_id, e.source_text = LEFT(m.body, 1000)
  WHERE e.message_id IS NOT NULL;

-- 10. messages: card -> source message, message -> task (no FKs: the weekly purge hard-deletes; code nulls them)
ALTER TABLE messages ADD COLUMN source_message_id BIGINT NULL, ADD COLUMN task_id INT NULL,
  ADD INDEX idx_msg_source (source_message_id), ADD INDEX idx_msg_task (task_id), ADD INDEX idx_msg_chat_id (chat_id, id),
  ADD INDEX idx_msg_reply (reply_to_id);

-- 11. backfill bot cards from their payload JSON
UPDATE messages SET source_message_id = JSON_EXTRACT(payload, '$.replyTo')
  WHERE type = 'bot' AND JSON_VALID(payload) AND JSON_TYPE(JSON_EXTRACT(payload, '$.replyTo')) = 'INTEGER';
UPDATE messages SET task_id = JSON_EXTRACT(payload, '$.task.id')
  WHERE type = 'bot' AND JSON_VALID(payload) AND JSON_UNQUOTE(JSON_EXTRACT(payload, '$.kind')) IN ('task', 'ask', 'reminder')
    AND JSON_TYPE(JSON_EXTRACT(payload, '$.task.id')) = 'INTEGER';

-- 12. Version settings (latestVersionCode 4, latestVersionName 0.4.0, minVersionCode 4) are set in Admin -> Settings
--     at deploy, after the 0.4.0 APK is uploaded (see docs/DEPLOY.md). Not done here.
