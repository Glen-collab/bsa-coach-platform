-- 009_template_programs.sql
-- Template library — flag admin-authored programs as public starter
-- templates. Any coach can clone a template into their own account
-- (new access_code, new user_email) so they can modify freely without
-- affecting the original.

ALTER TABLE workout_programs
  ADD COLUMN IF NOT EXISTS is_template BOOLEAN NOT NULL DEFAULT FALSE;

CREATE INDEX IF NOT EXISTS idx_workout_programs_is_template
  ON workout_programs (is_template)
  WHERE is_template = TRUE;
