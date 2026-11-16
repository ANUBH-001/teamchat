-- Run once on DBs created before auth (Phase 1)
USE teamchat;
ALTER TABLE users ADD COLUMN failed_attempts INT NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN locked_until TIMESTAMP NULL;
-- invites.code now stores a SHA-256 hex hash of the invite code
ALTER TABLE invites MODIFY code VARCHAR(64) NOT NULL;
