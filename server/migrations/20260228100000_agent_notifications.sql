CREATE TABLE IF NOT EXISTS agent_notifications (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
    agent_id TEXT NOT NULL REFERENCES agents (id) ON DELETE CASCADE,
    session_id TEXT NOT NULL REFERENCES sessions (id) ON DELETE CASCADE,
    message_id TEXT REFERENCES chat_messages (id) ON DELETE SET NULL,
    kind TEXT NOT NULL DEFAULT 'mention',
    title TEXT NOT NULL,
    body TEXT NOT NULL,
    read_at TEXT,
    created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_agent_notifications_agent_created
    ON agent_notifications (agent_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_agent_notifications_agent_read
    ON agent_notifications (agent_id, read_at);
