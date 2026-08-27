-- 038_absences.sql
-- "Away" — vacation, work, travel. Why a name isn't in the gym this week.
--
-- This is NOT the same thing as status 'paused', and conflating them would lose
-- the distinction that matters: paused is a decision about a MEMBERSHIP (on
-- hold, maybe not paying), away is a fact about a PERSON (in Florida until the
-- 8th, still a member, still owes September). Glen wants to know why someone
-- is missing without having to change what they are.
--
-- It is a table rather than a column on `clients` because the history is the
-- useful part. "Away since the 3rd" answers today's question; "that's her
-- fourth trip since March" is the one worth knowing when she asks about her
-- session balance. A column would forget every previous absence the moment the
-- next one started, which is exactly how the FileMaker contact file ended up
-- empty.
--
-- Apply on EC2:
--   PGPASSWORD='...' psql -h <rds-host> -U bsa_admin -d bestrongagain -f 038_absences.sql

BEGIN;

CREATE TABLE IF NOT EXISTS client_absences (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id   UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  -- Free text, with the UI offering the handful that actually occur. A CHECK
  -- constraint here would mean a migration every time life invents a new reason
  -- to miss a session.
  reason      TEXT NOT NULL,
  -- The "Where" field on the sheet — 'Florida'. Optional, and shown on the row
  -- while they are away, so it is a place far more often than it is a comment.
  note        TEXT,
  starts_on   DATE NOT NULL DEFAULT CURRENT_DATE,
  -- The LAST day away, not the day they're back. The row reads "back Sep 1",
  -- which is ends_on + 1 — stored this way so `ends_on >= CURRENT_DATE` is the
  -- whole of "are they away today", with no off-by-one to get wrong later.
  --
  -- NULL is the common case and the honest one: he knows they're gone, he
  -- doesn't know when they're back. An absence ends when someone says so, or
  -- the moment they walk in and get checked in.
  ends_on     DATE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by  UUID REFERENCES users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_absences_client ON client_absences (client_id, starts_on DESC);

-- Who is away right now. DISTINCT ON keeps the most recently started one when
-- a stale open-ended absence overlaps a new one — the newer answer is the true
-- one, and neither row gets destroyed to say so.
DROP VIEW IF EXISTS client_away;
CREATE VIEW client_away AS
SELECT DISTINCT ON (a.client_id)
       a.client_id,
       a.id         AS absence_id,
       a.reason,
       a.note,
       a.starts_on,
       a.ends_on,
       (a.ends_on - CURRENT_DATE) AS days_left
  FROM client_absences a
 WHERE a.starts_on <= CURRENT_DATE
   AND (a.ends_on IS NULL OR a.ends_on >= CURRENT_DATE)
 ORDER BY a.client_id, a.starts_on DESC, a.created_at DESC;

COMMIT;

-- Verify:
--   SELECT * FROM client_away;
--   SELECT reason, COUNT(*) FROM client_absences GROUP BY reason ORDER BY 2 DESC;
