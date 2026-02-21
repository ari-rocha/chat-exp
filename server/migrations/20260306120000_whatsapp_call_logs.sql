CREATE TABLE IF NOT EXISTS whatsapp_call_logs (
    call_id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
    session_id TEXT NOT NULL REFERENCES sessions (id) ON DELETE CASCADE,
    direction TEXT NOT NULL DEFAULT '',
    state TEXT NOT NULL DEFAULT 'INCOMING',
    started_at_ms BIGINT,
    ended_at_ms BIGINT,
    duration_sec INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_whatsapp_call_logs_session
    ON whatsapp_call_logs (session_id);
