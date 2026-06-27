-- Per-athlete sprint PBs (best time per distance) for the Sprint %PB engine.
-- Lives on the same per-(access_code,email) row as the 1RM maxes. JSONB keyed
-- by distance ("40yd","100m",…) → best-time string. The tracker computes each
-- kid's target sprint time from THEIR PB ÷ the coach-prescribed intensity %.
ALTER TABLE workout_user_position
  ADD COLUMN IF NOT EXISTS sprint_pbs JSONB DEFAULT '{}'::jsonb;
