-- 021_game_systems_n64_gba.sql
-- Add N64 + GBA to game mode options. Add available_systems column so
-- each Pi reports which consoles it has ROMs for — the dashboard only
-- shows buttons for systems the device actually supports.

BEGIN;

ALTER TABLE coach_devices
  DROP CONSTRAINT IF EXISTS coach_devices_display_mode_check;

ALTER TABLE coach_devices
  ADD CONSTRAINT coach_devices_display_mode_check
  CHECK (display_mode IN ('workout', 'leaderboard', 'game_nes', 'game_snes', 'game_n64', 'game_gba'));

ALTER TABLE coach_devices
  ADD COLUMN IF NOT EXISTS available_systems TEXT DEFAULT 'nes,snes';

COMMIT;
