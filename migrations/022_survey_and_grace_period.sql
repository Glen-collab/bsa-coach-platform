-- 022_survey_and_grace_period.sql
-- Transition survey for existing free clients + grace period before paywall.

BEGIN;

CREATE TABLE IF NOT EXISTS transition_surveys (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_email TEXT NOT NULL,
    user_name TEXT,
    rating INT CHECK (rating BETWEEN 1 AND 5),
    improvements TEXT,
    continue_likelihood INT CHECK (continue_likelihood BETWEEN 1 AND 10),
    comments TEXT,
    submitted_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS grace_period_ends_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS survey_completed_at TIMESTAMPTZ;

COMMIT;
