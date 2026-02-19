-- Unified user accounts + immutable workspace username + login tickets

CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    email TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    full_name TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    last_login_at TEXT NOT NULL DEFAULT ''
);

ALTER TABLE agents
ADD COLUMN IF NOT EXISTS user_id TEXT;

ALTER TABLE tenants
ADD COLUMN IF NOT EXISTS workspace_username TEXT;

CREATE TABLE IF NOT EXISTS auth_login_tickets (
    ticket TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    created_at TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    used BOOLEAN NOT NULL DEFAULT FALSE
);

-- Backfill users from existing tenant-scoped agent records.
INSERT INTO
    users (id, email, password_hash, full_name, created_at, updated_at)
SELECT DISTINCT ON (LOWER(a.email))
    'usr_' || MD5(LOWER(a.email) || NOW()::text || RANDOM()::text),
    LOWER(a.email) AS email,
    a.password_hash,
    a.name,
    NOW()::text,
    NOW()::text
FROM agents a
WHERE
    TRIM(a.email) <> ''
    AND NOT EXISTS (
        SELECT 1
        FROM users u
        WHERE
            u.email = LOWER(a.email)
    )
ORDER BY LOWER(a.email), a.id;

UPDATE agents a
SET
    user_id = u.id
FROM users u
WHERE
    LOWER(a.email) = u.email
    AND (
        a.user_id IS NULL
        OR a.user_id = ''
    );

-- Backfill workspace_username from slug/name and make unique.
UPDATE tenants
SET
    workspace_username = NULLIF(
        REGEXP_REPLACE(
            LOWER(
                COALESCE(NULLIF(slug, ''), NULLIF(name, ''), 'workspace')
            ),
            '[^a-z0-9-]',
            '-',
            'g'
        ),
        ''
    )
WHERE
    workspace_username IS NULL
    OR workspace_username = '';

UPDATE tenants
SET
    workspace_username = REGEXP_REPLACE(
        workspace_username,
        '-+',
        '-',
        'g'
    )
WHERE
    workspace_username IS NOT NULL;

UPDATE tenants
SET
    workspace_username = TRIM(BOTH '-' FROM workspace_username)
WHERE
    workspace_username IS NOT NULL;

UPDATE tenants
SET
    workspace_username = 'workspace-' || LEFT(id, 8)
WHERE
    workspace_username IS NULL
    OR workspace_username = '';

WITH
    ranked AS (
        SELECT
            id,
            workspace_username,
            ROW_NUMBER() OVER (
                PARTITION BY workspace_username
                ORDER BY id
            ) AS rn
        FROM tenants
    )
UPDATE tenants t
SET
    workspace_username = CASE
        WHEN r.rn = 1 THEN r.workspace_username
        ELSE r.workspace_username || '-' || r.rn::text
    END
FROM ranked r
WHERE
    t.id = r.id;

ALTER TABLE tenants
ALTER COLUMN workspace_username SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS tenants_workspace_username_unique ON tenants (workspace_username);

ALTER TABLE agents
ADD CONSTRAINT agents_user_id_fkey FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE;

ALTER TABLE agents
ALTER COLUMN user_id SET NOT NULL;
