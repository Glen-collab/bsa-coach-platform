-- 032_waiver_link.sql
-- Link clients to leaderboard athletes, and give them somewhere to hold the
-- guardian contact details that arrive with a signed waiver.
--
-- `leaderboard_athlete_id` is deliberately NOT a foreign key: the leaderboard
-- is a separate SQLite database in a separate codebase (see 014_gyms.sql era
-- notes). This column records which athlete a client corresponds to so the two
-- systems can be reconciled, without coupling them.
--
-- Apply on EC2:
--   PGPASSWORD='...' psql -h <rds-host> -U bsa_admin -d bestrongagain -f 032_waiver_link.sql

BEGIN;

ALTER TABLE clients
  ADD COLUMN IF NOT EXISTS leaderboard_athlete_id INTEGER,
  -- The waiver carries the parent's name, email, phone and address. For a
  -- 10-year-old the address IS the child's home address, so that goes to the
  -- client's own street/city/state/zip; the parent's contact details stay
  -- explicitly labelled as the guardian's.
  ADD COLUMN IF NOT EXISTS guardian_email TEXT,
  ADD COLUMN IF NOT EXISTS guardian_phone TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS uq_clients_leaderboard_athlete
  ON clients (coach_id, leaderboard_athlete_id)
  WHERE leaderboard_athlete_id IS NOT NULL;

-- Re-running the waiver import must not duplicate signatures. `imported_from`
-- carries 'leaderboard:<waiver_submissions.id>' so each one lands exactly once.
CREATE UNIQUE INDEX IF NOT EXISTS uq_waivers_imported_from
  ON client_waivers (imported_from)
  WHERE imported_from IS NOT NULL;

COMMIT;

-- Verify:
--   SELECT COUNT(*) FROM clients WHERE leaderboard_athlete_id IS NOT NULL;
--   SELECT COUNT(*) FROM client_waivers WHERE imported_from LIKE 'leaderboard:%';
