-- 002_video_waiver.sql
-- One-time video-content license waiver for coaches/admin who upload videos to the
-- platform. Once accepted, never prompted again (enforced in MediaLibrary.jsx).

BEGIN;

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS video_waiver_accepted_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS video_waiver_version TEXT;

COMMIT;

-- Verify:
--   \d users
