ALTER TABLE chat_logs ADD COLUMN feedback VARCHAR(10) DEFAULT NULL;
ALTER TABLE chat_logs ALTER COLUMN message TYPE TEXT;
-- This allows values like 'up', 'down', or null