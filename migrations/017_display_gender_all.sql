-- 017_display_gender_all.sql
-- Allow 'A' (all) as a value for coach_devices.display_gender so the gym
-- TV scoreboard can lock to "show everyone in one combined ranking"
-- instead of just "Boys" or "Girls". Migration 016's check constraint
-- only accepted 'M', 'F', or NULL.

BEGIN;

ALTER TABLE coach_devices DROP CONSTRAINT IF EXISTS coach_devices_display_gender_check;
ALTER TABLE coach_devices
  ADD CONSTRAINT coach_devices_display_gender_check
  CHECK (display_gender IS NULL OR display_gender IN ('M', 'F', 'A'));

COMMIT;
