-- 011_magic_link.sql
-- Magic-link (passwordless) login columns on users. Used by the tracker's
-- FriendChat flow so access-code-only users can sign in via email instead of
-- creating a password.

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS magic_token       TEXT,
  ADD COLUMN IF NOT EXISTS magic_expires_at  TIMESTAMPTZ;

-- Partial index: only rows with an active token get indexed (most of users
-- table has NULL in this column, so the index stays tiny)
CREATE INDEX IF NOT EXISTS idx_users_magic_token
  ON users (magic_token)
  WHERE magic_token IS NOT NULL;
