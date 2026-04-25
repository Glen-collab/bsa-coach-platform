-- 012_broadcast_messages.sql
-- Tag broadcast messages so the tracker UI can render them differently
-- (e.g., "📢 from your coach" badge) and admins can audit them separately.

ALTER TABLE user_messages
  ADD COLUMN IF NOT EXISTS is_broadcast BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS broadcast_batch_id UUID;
