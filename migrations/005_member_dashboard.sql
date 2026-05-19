-- Member-dashboard retention features.
-- 1. coach_summaries — AI-generated weekly/monthly recaps that the coach
--    explicitly pushes to a member's dashboard (separate from the email
--    flow, which is fire-and-forget).
-- 2. workout_logs.body_weight_lbs — optional weight at workout time, fed
--    by the tracker's weight tile. Charted on the member dashboard.

CREATE TABLE IF NOT EXISTS coach_summaries (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    coach_id    UUID REFERENCES users(id) ON DELETE SET NULL,
    period      TEXT NOT NULL CHECK (period IN ('weekly', 'monthly')),
    body        TEXT NOT NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_coach_summaries_user_created
    ON coach_summaries(user_id, created_at DESC);

ALTER TABLE workout_logs
    ADD COLUMN IF NOT EXISTS body_weight_lbs NUMERIC(5,1);
