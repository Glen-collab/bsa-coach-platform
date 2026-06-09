-- 024_challenge_self_report.sql
-- Rework challenges to self-reported results with flexible units.
-- Athletes submit their own scores (time, distance, reps, weight, etc.)
-- Best score per athlete wins. Unlimited attempts.

BEGIN;

-- Drop the old auto-scored entries table
DROP TABLE IF EXISTS challenge_entries;

-- Recreate challenges with flexible fields
ALTER TABLE challenges
  DROP CONSTRAINT IF EXISTS challenges_metric_type_check,
  ADD COLUMN IF NOT EXISTS unit TEXT NOT NULL DEFAULT 'reps',
  ADD COLUMN IF NOT EXISTS lower_is_better BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS duration_weeks INT;

-- Allow any metric_type string (not just total_volume/total_sessions)
ALTER TABLE challenges
  ALTER COLUMN metric_type SET DEFAULT 'custom';

-- Self-reported submissions (multiple per user per challenge, best wins)
CREATE TABLE IF NOT EXISTS challenge_submissions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    challenge_id UUID NOT NULL REFERENCES challenges(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    user_email TEXT NOT NULL,
    value NUMERIC NOT NULL,
    notes TEXT,
    submitted_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_challenge_subs_best
    ON challenge_submissions(challenge_id, user_id, value);

COMMIT;
