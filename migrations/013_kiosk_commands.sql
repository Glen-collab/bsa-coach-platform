-- 013_kiosk_commands.sql
-- Queue of commands that the phone/coach-dashboard sends to a Pi kiosk.
-- The Pi polls /api/kiosk/commands?coach_code=... every ~10s and executes
-- any pending command (shutdown, reboot, reload). Each command expires
-- after 5 minutes so a Pi that was offline won't wake up and immediately
-- halt itself from an hours-old request.

CREATE TABLE IF NOT EXISTS kiosk_commands (
  id           SERIAL PRIMARY KEY,
  coach_code   VARCHAR(64) NOT NULL,
  command      TEXT NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  executed_at  TIMESTAMPTZ,
  expires_at   TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '5 minutes')
);

CREATE INDEX IF NOT EXISTS idx_kiosk_commands_pending
  ON kiosk_commands (coach_code, executed_at)
  WHERE executed_at IS NULL;
