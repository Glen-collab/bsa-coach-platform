-- Allow display_mode = 'contest' so a gym TV can be flipped to the running
-- strongman comp (leaderboard.bestrongagain.com/contests/tv) from the Gym TV
-- remote, alongside Workouts / Leaderboard / Cards.
--
-- display_mode is a text column but is whitelisted by a CHECK constraint, so
-- accepting the new mode in kiosk.py alone isn't enough — without this the
-- UPDATE raises CheckViolation and the remote's optimistic toggle snaps back
-- to Leaderboard.
--
-- Widening only: every previously valid value stays valid, so this is safe to
-- run against a live table and needs no backfill.

BEGIN;

ALTER TABLE coach_devices
  DROP CONSTRAINT IF EXISTS coach_devices_display_mode_check;

ALTER TABLE coach_devices
  ADD CONSTRAINT coach_devices_display_mode_check
  CHECK (display_mode = ANY (ARRAY[
    'workout'::text,
    'leaderboard'::text,
    'contest'::text,
    'cards'::text,
    'game_nes'::text,
    'game_snes'::text,
    'game_n64'::text,
    'game_gba'::text
  ]));

COMMIT;
