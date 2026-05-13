-- 019_kiosk_game_mode.sql
-- Extend the per-device display_mode enum so a Pi can flip from the
-- workout TV view into a retro arcade (NES / SNES) and back. The
-- coach platform's admin GymTV "Game Mode" card calls /device/set-display
-- with mode='game_nes' | 'game_snes' (or 'workout' to stop). The Pi's
-- kiosk agent polls /tv-config, sees the mode change, and execs the
-- mode-switcher script which kills Chromium kiosk and launches RetroArch.

BEGIN;

ALTER TABLE coach_devices
  DROP CONSTRAINT IF EXISTS coach_devices_display_mode_check;

ALTER TABLE coach_devices
  ADD CONSTRAINT coach_devices_display_mode_check
  CHECK (display_mode IN ('workout', 'leaderboard', 'game_nes', 'game_snes'));

COMMIT;
