-- ── Add agent identity to chat messages ──
-- Track which agent sent each message (NULL for visitor/bot/system messages)
ALTER TABLE chat_messages
ADD COLUMN IF NOT EXISTS agent_id TEXT;

ALTER TABLE chat_messages
ADD COLUMN IF NOT EXISTS agent_name TEXT NOT NULL DEFAULT '';

ALTER TABLE chat_messages
ADD COLUMN IF NOT EXISTS agent_avatar_url TEXT NOT NULL DEFAULT '';