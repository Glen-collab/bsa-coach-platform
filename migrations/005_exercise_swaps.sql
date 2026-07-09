-- Per-athlete exercise swaps that persist across weeks.
-- Keyed by the LOWERCASED prescribed exercise name → the substitute:
--   { "safety bar squat": { "name": "Back Squat", "video": "<cf-uid>",
--                            "sets": "3", "reps": "8" } }
-- Re-applied on every program load (mirrors the sprint_pbs pattern), so a
-- client's swap sticks until they change it or revert to the prescribed move.
ALTER TABLE workout_user_position
  ADD COLUMN IF NOT EXISTS exercise_swaps JSONB DEFAULT '{}'::jsonb;
