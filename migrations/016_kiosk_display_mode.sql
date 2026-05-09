-- 016_kiosk_display_mode.sql
-- Per-device toggle so any one Pi can flip from "show today's workout"
-- (default) to "show the leaderboard" without affecting other TVs in
-- the gym. The display_metric_id + display_gender + display_group are
-- passed to leaderboard.bestrongagain.com/tv as URL params when mode
-- is 'leaderboard'.

BEGIN;

ALTER TABLE coach_devices
  ADD COLUMN IF NOT EXISTS display_mode      TEXT NOT NULL DEFAULT 'workout'
    CHECK (display_mode IN ('workout', 'leaderboard')),
  ADD COLUMN IF NOT EXISTS display_metric_id INTEGER,
  ADD COLUMN IF NOT EXISTS display_gender    TEXT
    CHECK (display_gender IS NULL OR display_gender IN ('M', 'F')),
  ADD COLUMN IF NOT EXISTS display_group     TEXT;

COMMIT;
