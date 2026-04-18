-- 001_trainer_media.sql
-- Per-coach video/audio uploads for the bundled exercise libraries
-- (exerciseLibrary.js, martialArtsLibrary.js, mobilityExercises.js, warmupExercises.js).
--
-- Lookup logic at runtime:
--   1. If user has a coach (users.coach_id IS NOT NULL):
--        SELECT * FROM trainer_media
--        WHERE trainer_id = :user_coach_id
--          AND exercise_name = :name
--          AND status = 'live';
--   2. If no row found OR user is anonymous (no signup yet):
--        Fall back to the bundled JS library video/audio.
--   3. Glen-featured global overrides:
--        SELECT * FROM trainer_media
--        WHERE featured_global = TRUE
--          AND status = 'live'
--        — admin can promote any coach's upload to be visible to all anonymous users.
--
-- Apply on EC2:
--   psql $DATABASE_URL -f 001_trainer_media.sql

BEGIN;

CREATE TABLE IF NOT EXISTS trainer_media (
  id                SERIAL PRIMARY KEY,
  trainer_id        UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  exercise_name     TEXT NOT NULL,
  category          TEXT,                              -- 'kicks', 'punches', 'chest', 'back', etc.
  source_library    TEXT,                              -- 'exerciseLibrary' | 'martialArtsLibrary' | 'mobilityExercises' | 'warmupExercises'
  media_type        TEXT NOT NULL CHECK (media_type IN ('video', 'audio')),
  cloudflare_uid    TEXT,                              -- Stream UID when media_type = 'video'
  storage_key       TEXT,                              -- R2/S3 path when media_type = 'audio'
  duration_seconds  INTEGER,                           -- optional, for capacity reporting
  status            TEXT NOT NULL DEFAULT 'live'
                      CHECK (status IN ('live', 'flagged', 'removed')),
  featured_global   BOOLEAN NOT NULL DEFAULT FALSE,    -- admin can toggle to make this visible to all anonymous users
  waiver_signed_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  uploaded_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- one upload per (trainer, exercise, media type) — re-upload replaces
  UNIQUE (trainer_id, exercise_name, media_type)
);

-- Main lookup: by coach + status
CREATE INDEX IF NOT EXISTS idx_trainer_media_trainer_status
  ON trainer_media (trainer_id, status);

-- Admin "All Coach Uploads" feed: newest first, optionally filter by status
CREATE INDEX IF NOT EXISTS idx_trainer_media_uploaded_at
  ON trainer_media (uploaded_at DESC);

-- Featured-global query (small set, but keep it cheap)
CREATE INDEX IF NOT EXISTS idx_trainer_media_featured
  ON trainer_media (featured_global)
  WHERE featured_global = TRUE;

-- Exercise lookup across all coaches (admin search)
CREATE INDEX IF NOT EXISTS idx_trainer_media_exercise
  ON trainer_media (exercise_name);

-- Auto-bump updated_at on row updates
CREATE OR REPLACE FUNCTION trainer_media_touch_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_trainer_media_touch ON trainer_media;
CREATE TRIGGER trg_trainer_media_touch
  BEFORE UPDATE ON trainer_media
  FOR EACH ROW EXECUTE FUNCTION trainer_media_touch_updated_at();

COMMIT;

-- Quick verify after running:
--   \d trainer_media
--   SELECT COUNT(*) FROM trainer_media;  -- should be 0 on first apply
