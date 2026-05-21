-- 020_user_goals.sql — capture the new member's goals at signup so the
-- admin notification email arrives with enough context to draft a
-- personalized welcome reply.

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS goals text[];

CREATE INDEX IF NOT EXISTS idx_users_goals ON users USING GIN (goals);
