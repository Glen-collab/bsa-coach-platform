-- 018_kiosk_display_year.sql
-- Per-device year filter for the leaderboard scoreboard. NULL = all-time
-- (each athlete's best ever for the metric, the existing behavior).
-- Set to a year ('2026') to show only results recorded in that calendar
-- year — useful for "current year records" vs "all-time records."

BEGIN;

ALTER TABLE coach_devices
  ADD COLUMN IF NOT EXISTS display_year TEXT;

COMMIT;
