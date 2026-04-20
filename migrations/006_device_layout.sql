-- 006_device_layout.sql
-- Add a per-device layout picker for the gym TV. Each Pi device now has a
-- layout preference: two-day, single WOD, or WOD + Scaled (Rx + regression).

BEGIN;

ALTER TABLE coach_devices
  ADD COLUMN IF NOT EXISTS layout TEXT NOT NULL DEFAULT 'two_day'
    CHECK (layout IN ('two_day', 'wod', 'wod_scaled'));

COMMIT;
