-- ── Enrich contacts table ─────────────────────────────────────
ALTER TABLE contacts
ADD COLUMN IF NOT EXISTS company TEXT NOT NULL DEFAULT '';

ALTER TABLE contacts
ADD COLUMN IF NOT EXISTS location TEXT NOT NULL DEFAULT '';

ALTER TABLE contacts
ADD COLUMN IF NOT EXISTS avatar_url TEXT NOT NULL DEFAULT '';

ALTER TABLE contacts
ADD COLUMN IF NOT EXISTS last_seen_at TEXT NOT NULL DEFAULT '';

ALTER TABLE contacts
ADD COLUMN IF NOT EXISTS browser TEXT NOT NULL DEFAULT '';

ALTER TABLE contacts
ADD COLUMN IF NOT EXISTS os TEXT NOT NULL DEFAULT '';

-- ── Link sessions to contacts ────────────────────────────────
ALTER TABLE sessions
ADD COLUMN IF NOT EXISTS contact_id TEXT REFERENCES contacts (id) ON DELETE SET NULL;

-- ── Persistent visitor identity across sessions ──────────────
ALTER TABLE sessions
ADD COLUMN IF NOT EXISTS visitor_id TEXT NOT NULL DEFAULT '';

-- ── Tags ─────────────────────────────────────────────────────
CREATE TABLE
    IF NOT EXISTS tags (
        id TEXT PRIMARY KEY,
        tenant_id TEXT NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        color TEXT NOT NULL DEFAULT '#6366f1',
        created_at TEXT NOT NULL
    );

CREATE UNIQUE INDEX IF NOT EXISTS idx_tags_tenant_name ON tags (tenant_id, name);

-- ── Conversation ↔ Tag (many-to-many) ────────────────────────
CREATE TABLE
    IF NOT EXISTS conversation_tags (
        session_id TEXT NOT NULL REFERENCES sessions (id) ON DELETE CASCADE,
        tag_id TEXT NOT NULL REFERENCES tags (id) ON DELETE CASCADE,
        created_at TEXT NOT NULL,
        PRIMARY KEY (session_id, tag_id)
    );

-- ── Contact custom attributes (key/value per contact) ────────
CREATE TABLE
    IF NOT EXISTS contact_custom_attributes (
        id TEXT PRIMARY KEY,
        contact_id TEXT NOT NULL REFERENCES contacts (id) ON DELETE CASCADE,
        attribute_key TEXT NOT NULL,
        attribute_value TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
    );

CREATE UNIQUE INDEX IF NOT EXISTS idx_contact_attrs_key ON contact_custom_attributes (contact_id, attribute_key);

-- ── Conversation custom attributes (key/value per session) ───
CREATE TABLE
    IF NOT EXISTS conversation_custom_attributes (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL REFERENCES sessions (id) ON DELETE CASCADE,
        attribute_key TEXT NOT NULL,
        attribute_value TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
    );

CREATE UNIQUE INDEX IF NOT EXISTS idx_conv_attrs_key ON conversation_custom_attributes (session_id, attribute_key);