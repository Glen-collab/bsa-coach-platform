-- 025_trial_and_dismiss_count.sql
-- Track survey dismissals for existing clients (auto-start grace after 3).
-- Track free trial end date for new users (1-week trial).

BEGIN;

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS survey_dismiss_count INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS free_trial_ends_at TIMESTAMPTZ;

COMMIT;
