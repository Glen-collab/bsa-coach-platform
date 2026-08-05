-- 028_athlete_onboarding.sql
-- Per-ATHLETE onboarding state, keyed by email.
--
-- Every "first time" gate in the tracker was stored in localStorage and keyed
-- by program code, so they replayed constantly:
--   * welcome walkthrough  — key included the access code, so every new program
--                            was a new "first visit"
--   * challenge announce   — localStorage only, so every device asked again
--   * questionnaire        — key was code+email, same problem as welcome
--   * consent              — re-asked per program
--
-- A client doing day 1 from one program and day 2 from another therefore sat
-- through the whole intro twice a week, on top of re-typing his email because
-- an iOS home-screen PWA has its own storage. That is minutes of a training
-- session spent dismissing screens he had already dismissed.
--
-- Keyed by email rather than users.id on purpose: 1-on-1 clients and kiosk
-- athletes log workouts without necessarily owning a users row, and email is
-- what every tracker endpoint already keys on.

BEGIN;

CREATE TABLE IF NOT EXISTS athlete_onboarding (
    user_email                 TEXT PRIMARY KEY,
    welcome_seen_at            TIMESTAMPTZ,
    consent_accepted_at        TIMESTAMPTZ,
    questionnaire_completed_at TIMESTAMPTZ,
    dismissed_challenges       JSONB NOT NULL DEFAULT '[]'::jsonb,
    updated_at                 TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Backfill from what we already know, so nobody who has ALREADY completed
-- these gets asked again the first time this ships.
INSERT INTO athlete_onboarding (user_email, consent_accepted_at, questionnaire_completed_at)
SELECT LOWER(user_email),
       MIN(CASE WHEN consent_accepted        THEN COALESCE(updated_at, NOW()) END),
       MIN(CASE WHEN questionnaire_completed THEN COALESCE(updated_at, NOW()) END)
FROM workout_user_position
GROUP BY LOWER(user_email)
ON CONFLICT (user_email) DO NOTHING;

-- Anyone with a logged workout has plainly been through the walkthrough.
UPDATE athlete_onboarding a
SET welcome_seen_at = COALESCE(a.welcome_seen_at, l.first_log)
FROM (SELECT LOWER(user_email) AS em, MIN(created_at) AS first_log
      FROM workout_logs GROUP BY LOWER(user_email)) l
WHERE a.user_email = l.em;

COMMIT;
