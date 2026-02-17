-- ── Flow input variables ──────────────────────────────────────
ALTER TABLE flows
ADD COLUMN IF NOT EXISTS input_variables TEXT NOT NULL DEFAULT '[]';

-- ── Mark flows as AI agent tools ─────────────────────────────
ALTER TABLE flows
ADD COLUMN IF NOT EXISTS ai_tool BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE flows
ADD COLUMN IF NOT EXISTS ai_tool_description TEXT NOT NULL DEFAULT '';