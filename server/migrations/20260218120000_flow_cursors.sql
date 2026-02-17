CREATE TABLE IF NOT EXISTS flow_cursors (
  id          TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  tenant_id   TEXT NOT NULL,
  session_id  TEXT NOT NULL,
  flow_id     TEXT NOT NULL,
  node_id     TEXT NOT NULL,
  node_type   TEXT NOT NULL DEFAULT '',
  created_at  TEXT NOT NULL DEFAULT to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
  UNIQUE(tenant_id, session_id)
);
