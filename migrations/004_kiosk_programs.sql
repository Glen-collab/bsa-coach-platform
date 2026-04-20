-- 004_kiosk_programs.sql
-- Gym TV kiosk system — coaches flag programs as "show on kiosk" and pick one
-- as the currently-active program for their Pi-powered TV(s).

BEGIN;

-- Per-program flag: coach toggles this to make a program available on the kiosk tile view
ALTER TABLE workout_programs
  ADD COLUMN IF NOT EXISTS show_on_kiosk BOOLEAN NOT NULL DEFAULT FALSE;

-- Programs are owned by their creator via optional_trainer_email (coach's email).
CREATE INDEX IF NOT EXISTS idx_workout_programs_kiosk
  ON workout_programs (optional_trainer_email, show_on_kiosk)
  WHERE show_on_kiosk = TRUE;

-- Per-coach current active program — what their Pi TV(s) currently display
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS active_kiosk_program_id INTEGER
  REFERENCES workout_programs(id) ON DELETE SET NULL;

COMMIT;
