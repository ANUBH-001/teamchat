-- Run once on DBs created before chat (Phase 2)
USE teamchat;
ALTER TABLE chat_members ADD COLUMN last_read_message_id BIGINT NULL;
ALTER TABLE chat_members ADD COLUMN last_delivered_message_id BIGINT NULL;
ALTER TABLE messages ADD COLUMN client_id VARCHAR(64) NULL;
ALTER TABLE messages ADD UNIQUE KEY uq_sender_client (sender_id, client_id);
