-- 014_gyms.sql
-- Multi-coach gym entity. A gym has 2+ coaches who share a single video pool
-- and can transfer clients between each other if a coach quits/dies.
--
-- A coach with NULL gym_id is solo (Glen, Steve before becoming a partner).
-- Two coaches with the same gym_id are gym partners — their tracker_media
-- rows are pooled, and an admin can bulk-transfer one's clients + programs
-- to the other.
--
-- Apply on EC2:
--   PGPASSWORD='...' psql -h <rds-host> -U bsa_admin -d bestrongagain -f 014_gyms.sql

BEGIN;

CREATE TABLE IF NOT EXISTS gyms (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name        TEXT NOT NULL,
  owner_id    UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS gym_id UUID REFERENCES gyms(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_users_gym_id ON users (gym_id) WHERE gym_id IS NOT NULL;

COMMIT;
