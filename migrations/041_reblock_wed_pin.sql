-- 041_reblock_wed_pin.sql
-- Move the Wednesday 4pm pin from 'afternoon' to 'evening'.
--
-- The blocks became the gym's own hours (morning 5-11, afternoon 11-3, evening
-- 3-8), which reads every clock stamp correctly from that moment on. Pins do
-- not follow, because a pin is a stored string — `3-afternoon` — not a time.
-- So the eight people pinned to Wednesday afternoon kept pointing at 11-3 while
-- the session they actually attend, 4pm, had become evening. At 3pm they
-- dropped out of the current list entirely: the pin no longer matched, and
-- `3-evening` was already settled by another pin, so there was no fallback to
-- catch them.
--
-- Both members of that group with a clock stamp on file (Kathy Allen, Stacey
-- O'Leary) check in at 16:00, and Glen confirms the pin means his 4pm group.
--
-- Deduplicated on the way through: one of the eight may already carry
-- '3-evening', and a doubled key would count twice in the pinned tally that
-- decides whether a session has settled.
--
-- Apply on EC2:
--   PGPASSWORD='...' psql -h <rds-host> -U bsa_admin -d bestrongagain -f 041_reblock_wed_pin.sql
--
-- To undo, swap the two strings and run it again.

BEGIN;

UPDATE clients
   SET sessions = (SELECT ARRAY(
         SELECT DISTINCT unnest(array_replace(sessions, '3-afternoon', '3-evening'))))
     , updated_at = NOW()
 WHERE '3-afternoon' = ANY(sessions);

COMMIT;

-- Verify — expect no '3-afternoon' left, and '3-evening' up by eight:
--   SELECT g, COUNT(*) FROM clients c, unnest(c.sessions) g
--    WHERE c.status='active' GROUP BY 1 ORDER BY 1;
