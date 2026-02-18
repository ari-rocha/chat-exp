-- ── Tenant system: roles, invitations, members ──
-- Add role column to agents (owner, admin, agent)
ALTER TABLE agents
ADD COLUMN IF NOT EXISTS role TEXT NOT NULL DEFAULT 'agent';

-- Add avatar_url to agents
ALTER TABLE agents
ADD COLUMN IF NOT EXISTS avatar_url TEXT NOT NULL DEFAULT '';

-- Add last_seen_at to agents
ALTER TABLE agents
ADD COLUMN IF NOT EXISTS last_seen_at TEXT NOT NULL DEFAULT '';

-- Tenant invitations table
CREATE TABLE
    IF NOT EXISTS tenant_invitations (
        id TEXT PRIMARY KEY,
        tenant_id TEXT NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
        email TEXT NOT NULL,
        role TEXT NOT NULL DEFAULT 'agent',
        token TEXT NOT NULL UNIQUE,
        status TEXT NOT NULL DEFAULT 'pending',
        invited_by TEXT NOT NULL REFERENCES agents (id) ON DELETE CASCADE,
        created_at TEXT NOT NULL,
        expires_at TEXT NOT NULL
    );

-- Make email unique per tenant instead of globally unique
ALTER TABLE agents
DROP CONSTRAINT IF EXISTS agents_email_key;

CREATE UNIQUE INDEX IF NOT EXISTS agents_email_tenant_unique ON agents (tenant_id, email);