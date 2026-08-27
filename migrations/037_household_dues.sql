-- 037_household_dues.sql
-- One household, one monthly bill.
--
-- Jake and Lexi Powell pay $150 a month between them. Recording that as $75
-- each would be inventing a split that does not exist and would show two
-- payments to chase instead of one. The household already pools sessions; it
-- pools the monthly bill too.
--
-- A payment logged against ANY member counts for the whole household, because
-- in practice one person hands over the money for everyone.
--
-- Apply on EC2:
--   PGPASSWORD='...' psql -h <rds-host> -U bsa_admin -d bestrongagain -f 037_household_dues.sql

BEGIN;

ALTER TABLE households
  ADD COLUMN IF NOT EXISTS monthly_amount NUMERIC(8,2);

DROP VIEW IF EXISTS client_dues;
CREATE VIEW client_dues AS
WITH per_client AS (
  SELECT DISTINCT ON (client_id)
         client_id, paid_on AS last_paid, amount AS last_amount, covers_until
  FROM client_payments
  ORDER BY client_id, paid_on DESC, created_at DESC
),
per_household AS (
  -- The household's most recent payment, whoever handed it over.
  SELECT DISTINCT ON (c.household_id)
         c.household_id, p.paid_on AS last_paid, p.amount AS last_amount, p.covers_until
  FROM client_payments p
  JOIN clients c ON c.id = p.client_id
  WHERE c.household_id IS NOT NULL
  ORDER BY c.household_id, p.paid_on DESC, p.created_at DESC
)
SELECT c.id                                        AS client_id,
       c.coach_id,
       c.billing_type,
       c.household_id,
       COALESCE(hh.last_paid,    pc.last_paid)     AS last_paid,
       COALESCE(hh.last_amount,  pc.last_amount)   AS last_amount,
       COALESCE(h.monthly_amount, c.monthly_amount) AS monthly_amount,
       COALESCE(
         COALESCE(hh.covers_until, pc.covers_until),
         COALESCE(hh.last_paid, pc.last_paid) + INTERVAL '1 month'
       )::date                                     AS due_on,
       (COALESCE(
          COALESCE(hh.covers_until, pc.covers_until),
          COALESCE(hh.last_paid, pc.last_paid) + INTERVAL '1 month'
        )::date - CURRENT_DATE)                    AS days_until_due
FROM clients c
LEFT JOIN households   h  ON h.id  = c.household_id
LEFT JOIN per_client   pc ON pc.client_id    = c.id
LEFT JOIN per_household hh ON hh.household_id = c.household_id;

COMMIT;

-- Verify:
--   SELECT client_id, last_paid, due_on, monthly_amount FROM client_dues
--    WHERE household_id IS NOT NULL;
