ALTER TABLE sessions
ADD COLUMN IF NOT EXISTS snooze_mode TEXT;

ALTER TABLE sessions
ADD COLUMN IF NOT EXISTS snoozed_until TEXT;

CREATE INDEX IF NOT EXISTS idx_sessions_snoozed_until
ON sessions (tenant_id, status, snooze_mode, snoozed_until);
