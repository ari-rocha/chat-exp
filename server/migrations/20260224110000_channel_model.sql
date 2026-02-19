-- Dedicated channel model
CREATE TABLE IF NOT EXISTS channels (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
    inbox_id TEXT REFERENCES inboxes (id) ON DELETE SET NULL,
    channel_type TEXT NOT NULL,
    name TEXT NOT NULL,
    config TEXT NOT NULL DEFAULT '{}',
    enabled BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_channels_tenant ON channels (tenant_id);
CREATE INDEX IF NOT EXISTS idx_channels_inbox ON channels (inbox_id);

-- Backfill channel rows from existing inboxes.channels JSON string arrays.
INSERT INTO
    channels (
        id,
        tenant_id,
        inbox_id,
        channel_type,
        name,
        config,
        enabled,
        created_at,
        updated_at
    )
SELECT
    'chn_' || MD5(i.id || ':' || value || ':' || NOW()::text || RANDOM()::text),
    i.tenant_id,
    i.id,
    LOWER(value) AS channel_type,
    INITCAP(LOWER(value)) || ' Channel' AS name,
    '{}',
    TRUE,
    NOW()::text,
    NOW()::text
FROM inboxes i,
    LATERAL (
        SELECT DISTINCT TRIM(BOTH ' ' FROM v) AS value
        FROM jsonb_array_elements_text(
                COALESCE(NULLIF(i.channels, ''), '[]')::jsonb
            ) AS t(v)
    ) x
WHERE
    x.value <> ''
    AND NOT EXISTS (
        SELECT 1
        FROM channels c
        WHERE
            c.tenant_id = i.tenant_id
            AND c.inbox_id = i.id
            AND c.channel_type = LOWER(x.value)
    );
