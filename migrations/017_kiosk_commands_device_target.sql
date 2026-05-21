-- 017_kiosk_commands_device_target.sql
-- Per-device targeting for kiosk_commands. Coach can now send shutdown /
-- reboot / quit_game to ONE of their Pis instead of all of them.
--
-- device_serial NULL = broadcast (current behavior, "All TVs" button).
-- device_serial set  = only that Pi (matched on registration in coach_devices).
--
-- The Pi agent passes ?device=<serial> when polling /commands so we can
-- filter `WHERE device_serial IS NULL OR device_serial = <serial>`.

BEGIN;

ALTER TABLE kiosk_commands
  ADD COLUMN IF NOT EXISTS device_serial TEXT;

-- Pending lookup now filters by both coach_code and (optionally) device.
-- Old index stays valid for the broadcast path; this one helps the
-- targeted path without sequential-scanning the table.
CREATE INDEX IF NOT EXISTS idx_kiosk_commands_pending_device
  ON kiosk_commands (coach_code, device_serial, executed_at)
  WHERE executed_at IS NULL;

COMMIT;
