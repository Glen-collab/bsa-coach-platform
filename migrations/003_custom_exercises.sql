-- 003_custom_exercises.sql
-- Coach-proposed exercises that aren't in the bundled JS libraries.
-- Flow: coach submits -> status='pending' -> admin approves -> status='approved'
-- -> appears in Media Library for ALL coaches to upload their own video against.

BEGIN;

CREATE TABLE IF NOT EXISTS custom_exercises (
  id                  SERIAL PRIMARY KEY,
  proposed_by_user_id UUID NOT NULL REFERENCES users(id) ON DELETE SET NULL,
  name                TEXT NOT NULL,
  category            TEXT,
  subcategory         TEXT,
  source_library      TEXT NOT NULL DEFAULT 'custom'
                        CHECK (source_library IN ('exerciseLibrary','martialArtsLibrary','mobilityExercises','warmupExercises','custom')),
  description         TEXT,
  status              TEXT NOT NULL DEFAULT 'pending'
                        CHECK (status IN ('pending','approved','rejected','removed')),
  admin_notes         TEXT,
  approved_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  approved_at         TIMESTAMPTZ,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Prevent duplicate proposals of the same name within the same library
-- (case-insensitive). Allow pending + approved to coexist under different names
-- but block someone from proposing "Lat Pulldown" twice.
CREATE UNIQUE INDEX IF NOT EXISTS idx_custom_exercises_unique_name
  ON custom_exercises (LOWER(name), source_library)
  WHERE status IN ('pending','approved');

CREATE INDEX IF NOT EXISTS idx_custom_exercises_status
  ON custom_exercises (status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_custom_exercises_proposer
  ON custom_exercises (proposed_by_user_id);

-- Auto-bump updated_at
CREATE OR REPLACE FUNCTION custom_exercises_touch_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_custom_exercises_touch ON custom_exercises;
CREATE TRIGGER trg_custom_exercises_touch
  BEFORE UPDATE ON custom_exercises
  FOR EACH ROW EXECUTE FUNCTION custom_exercises_touch_updated_at();

COMMIT;
