-- Workspace profile fields on tenant_settings
ALTER TABLE tenant_settings
ADD COLUMN IF NOT EXISTS workspace_short_bio TEXT NOT NULL DEFAULT '';

ALTER TABLE tenant_settings
ADD COLUMN IF NOT EXISTS workspace_description TEXT NOT NULL DEFAULT '';
