-- Run once on DBs created before swipe-to-reply (Phase 8a)
USE teamchat;
ALTER TABLE messages ADD COLUMN reply_to_id BIGINT NULL;
