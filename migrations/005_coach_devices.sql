-- 005_coach_devices.sql
-- Multi-device kiosk system. Each Pi self-registers by CPU serial on first boot.
-- Coach can rename, assign a program per device, delete old ones.

BEGIN;

CREATE TABLE IF NOT EXISTS coach_devices (
  id                 SERIAL PRIMARY KEY,
  coach_id           UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  device_serial      TEXT NOT NULL,
  display_name       TEXT NOT NULL,
  active_program_id  INTEGER REFERENCES workout_programs(id) ON DELETE SET NULL,
  last_seen_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (coach_id, device_serial)
);

CREATE INDEX IF NOT EXISTS idx_coach_devices_coach
  ON coach_devices (coach_id, last_seen_at DESC);

COMMIT;
