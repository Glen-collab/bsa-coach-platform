-- 015_kiosk_view_state.sql
-- Phone-as-remote: per-device view state (week + starting day) so a coach
-- can drive what's shown on the gym TV from the GymTV dashboard page.
-- The Pi polls /api/kiosk/tv-config every 60s and adopts whatever week/
-- start_day the dashboard set, no IR remote / gamepad required.

BEGIN;

ALTER TABLE coach_devices
  ADD COLUMN IF NOT EXISTS view_week      INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS view_start_day INTEGER NOT NULL DEFAULT 1;

COMMIT;
