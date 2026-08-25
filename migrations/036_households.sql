-- 036_households.sql
-- Families that share one pool of sessions.
--
-- One person pays and several people train off it: Mark pays for himself and
-- Deb; Troy paid for Grady and Lane; Mark also covered Kristin and Joel. In the
-- FileMaker ledger this was expressed by typing the payer's name on the child's
-- line — which is why 'Wendorf Troy to grady' and 'Bushweiler, Kristin (Joel)'
-- exist as separate "clients".
--
-- The accounting unit becomes the household. When a client belongs to one, ALL
-- their purchases and ALL their attendance roll up to it, and every member sees
-- the same remaining figure — because there is only one pool. A client with no
-- household is unchanged: their balance is their own.
--
-- Apply on EC2:
--   PGPASSWORD='...' psql -h <rds-host> -U bsa_admin -d bestrongagain -f 036_households.sql

BEGIN;

CREATE TABLE IF NOT EXISTS households (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  coach_id   UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name       TEXT NOT NULL,                    -- 'Bushweiler', 'Wendorf'
  payer_id   UUID,                             -- the client who actually pays; informational
  note       TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE clients
  ADD COLUMN IF NOT EXISTS household_id UUID REFERENCES households(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_clients_household
  ON clients (household_id) WHERE household_id IS NOT NULL;

-- The pool: everything every member bought, minus everything every member used.
CREATE OR REPLACE VIEW household_balance AS
SELECT h.id                                              AS household_id,
       h.coach_id,
       h.name,
       COUNT(DISTINCT c.id)                              AS members,
       COALESCE(SUM(p.bought), 0)                        AS purchased,
       COALESCE(SUM(a.used), 0)                          AS used,
       COALESCE(SUM(p.bought), 0) - COALESCE(SUM(a.used), 0) AS remaining,
       MAX(a.last_visit)                                 AS last_visit
FROM households h
LEFT JOIN clients c ON c.household_id = h.id
LEFT JOIN (SELECT client_id, SUM(sessions_purchased) bought
             FROM session_packages GROUP BY client_id) p ON p.client_id = c.id
LEFT JOIN (SELECT client_id, SUM(sessions_used) used,
                  MAX(attended_on) FILTER (WHERE source <> 'adjustment') last_visit
             FROM attendance GROUP BY client_id) a ON a.client_id = c.id
GROUP BY h.id, h.coach_id, h.name;

-- A household member's balance IS the household's. Visits stay personal —
-- Deb's visit count is hers, only the session pool is shared.
--
-- Dropped and recreated rather than CREATE OR REPLACE: adding household_id in
-- the middle of the column list is a rename as far as Postgres is concerned,
-- and REPLACE refuses it.
DROP VIEW IF EXISTS client_balance;
CREATE VIEW client_balance AS
SELECT c.id                                            AS client_id,
       c.coach_id,
       c.display_name,
       c.billing_type,
       c.household_id,
       COALESCE(hb.purchased, p.bought, 0)             AS purchased,
       COALESCE(hb.used,      a.used,   0)             AS used,
       COALESCE(hb.remaining, COALESCE(p.bought,0) - COALESCE(a.used,0)) AS remaining,
       a.first_visit,
       a.last_visit,
       a.visits,
       (a.last_visit + INTERVAL '1 year')::date        AS credits_expire_on,
       (a.last_visit < CURRENT_DATE - INTERVAL '1 year') AS forfeited,
       COALESCE(p.needs_review, FALSE)                 AS balance_needs_review,
       hb.name                                         AS household_name,
       hb.members                                      AS household_members
FROM clients c
LEFT JOIN household_balance hb ON hb.household_id = c.household_id
LEFT JOIN (
  SELECT client_id, SUM(sessions_purchased) AS bought, bool_or(needs_review) AS needs_review
  FROM session_packages GROUP BY client_id
) p ON p.client_id = c.id
LEFT JOIN (
  SELECT client_id,
         SUM(sessions_used)                                      AS used,
         MIN(attended_on) FILTER (WHERE source <> 'adjustment')  AS first_visit,
         MAX(attended_on) FILTER (WHERE source <> 'adjustment')  AS last_visit,
         COUNT(*)         FILTER (WHERE source <> 'adjustment')  AS visits
  FROM attendance GROUP BY client_id
) a ON a.client_id = c.id;

COMMIT;

-- Verify:
--   SELECT * FROM household_balance;
