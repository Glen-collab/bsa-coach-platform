-- 039_catchup_source.sql
-- A source for visits entered after the fact.
--
-- Back-dating is the normal case, not an edge one: a session runs Tuesday
-- evening and gets entered over coffee on Wednesday. Those rows are real visits
-- and count everywhere a visit counts — unlike 'adjustment', which is excluded.
-- They differ in one way only, and it is recorded in `attended_at` rather than
-- here: a catch-up row has NO clock stamp.
--
-- That matters because the clock stamp is what teaches the app who trains when.
-- Stamping NOW() on a back-dated row would record that Tuesday's group trains
-- at 6am on the evidence of when Glen typed it in, and one catch-up session
-- would bend the session grouping for weeks. NULL is what the imported ledger
-- rows already carry: a real day, an unknown hour. It still counts towards the
-- weekday pattern, just not the time block.
--
-- Keeping the source distinct means "which of these did I enter later?" stays
-- answerable, which is the question that gets asked when a count looks wrong.
--
-- Apply on EC2:
--   PGPASSWORD='...' psql -h <rds-host> -U bsa_admin -d bestrongagain -f 039_catchup_source.sql

BEGIN;

ALTER TABLE attendance DROP CONSTRAINT IF EXISTS attendance_source_check;
ALTER TABLE attendance ADD CONSTRAINT attendance_source_check
  CHECK (source IN ('phone', 'kiosk', 'legacy', 'web', 'adjustment', 'catchup'));

COMMIT;

-- Verify:
--   SELECT source, COUNT(*), COUNT(attended_at) AS with_a_clock
--     FROM attendance GROUP BY source ORDER BY 2 DESC;
