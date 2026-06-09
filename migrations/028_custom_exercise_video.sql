-- 028_custom_exercise_video.sql
-- Adds an optional Cloudflare video UID to custom exercises so a coach-authored
-- combo / custom move can carry a filmed demo straight into the builder + tracker.
BEGIN;
ALTER TABLE custom_exercises ADD COLUMN IF NOT EXISTS video_uid TEXT;
COMMIT;
