-- 007_friends_and_messages.sql
-- Friend-only direct messaging. Requester/recipient pattern for friendships +
-- a simple messages table for DMs.
-- Coach / admin oversight allowed per platform policy — users are notified on
-- first-use (messaging_consent_at on users).

BEGIN;

-- ── Friendships ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS user_friendships (
  id            SERIAL PRIMARY KEY,
  requester_id  UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  recipient_id  UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status        TEXT NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending', 'accepted', 'declined', 'blocked')),
  requested_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  accepted_at   TIMESTAMPTZ,
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (requester_id, recipient_id),
  CHECK (requester_id <> recipient_id)
);

CREATE INDEX IF NOT EXISTS idx_user_friendships_recipient
  ON user_friendships (recipient_id, status);
CREATE INDEX IF NOT EXISTS idx_user_friendships_requester
  ON user_friendships (requester_id, status);

-- ── Messages ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS user_messages (
  id            SERIAL PRIMARY KEY,
  from_user_id  UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  to_user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  body          TEXT NOT NULL CHECK (length(body) > 0 AND length(body) <= 2000),
  sent_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  read_at       TIMESTAMPTZ
);

-- Unread lookup (red-dot badge): "how many messages TO me that I haven't read"
CREATE INDEX IF NOT EXISTS idx_user_messages_unread
  ON user_messages (to_user_id, read_at)
  WHERE read_at IS NULL;

-- Thread lookup: messages between two users, newest first
CREATE INDEX IF NOT EXISTS idx_user_messages_thread
  ON user_messages (from_user_id, to_user_id, sent_at DESC);
CREATE INDEX IF NOT EXISTS idx_user_messages_thread_reverse
  ON user_messages (to_user_id, from_user_id, sent_at DESC);

-- ── Consent flag ──────────────────────────────────────────────────────
-- Records when the user acknowledged that messages may be reviewed by coaches
-- and admins for safety + product improvement. Null = haven't consented yet.
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS messaging_consent_at TIMESTAMPTZ;

COMMIT;
