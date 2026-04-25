-- 010_cast_sessions.sql
-- "Cast to TV" pairing sessions. TV (smart-TV browser) hits /api/cast/register
-- and gets a 4-digit pair_code. Phone (tracker) pushes its current workout to
-- that code via /api/cast/push. TV polls /api/cast/poll/<code> and picks up
-- the bound session data within 2-3 seconds.
--
-- Rows live briefly. Ephemeral by design — pruned on register.

CREATE TABLE IF NOT EXISTS cast_sessions (
  id            SERIAL PRIMARY KEY,
  pair_code     TEXT NOT NULL,
  access_code   TEXT,
  user_email    TEXT,
  user_name     TEXT,
  week          INT,
  day           INT,
  main_maxes    JSONB,
  program_data  JSONB,        -- full snapshot so TV doesn't need to re-auth
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  bound_at      TIMESTAMPTZ,
  expires_at    TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '15 minutes')
);

-- Only one ACTIVE pair_code at a time (bound or still waiting)
CREATE UNIQUE INDEX IF NOT EXISTS idx_cast_sessions_active_code
  ON cast_sessions (pair_code)
  WHERE expires_at > NOW();

CREATE INDEX IF NOT EXISTS idx_cast_sessions_expires
  ON cast_sessions (expires_at);
