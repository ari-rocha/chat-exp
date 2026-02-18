-- Bot profile columns on tenant_settings
ALTER TABLE tenant_settings ADD COLUMN IF NOT EXISTS bot_name TEXT NOT NULL DEFAULT '';
ALTER TABLE tenant_settings ADD COLUMN IF NOT EXISTS bot_avatar_url TEXT NOT NULL DEFAULT '';
