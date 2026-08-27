-- 034_client_payments.sql
-- Monthly dues: when someone last paid, so the check-in row can flag who owes.
--
-- A separate table rather than a `last_paid_on` column on clients, for the same
-- reason the ledger's three grand-total columns were a mistake: the last payment
-- is derivable from the payments, and a stored copy drifts from its own source.
-- MAX(paid_on) is the answer, and history comes free.
--
-- Nothing is required. A client Glen keeps off the books simply has no rows here
-- and shows no money anywhere — that is what billing_type 'untracked' means.
--
-- Apply on EC2:
--   PGPASSWORD='...' psql -h <rds-host> -U bsa_admin -d bestrongagain -f 034_client_payments.sql

BEGIN;

CREATE TABLE IF NOT EXISTS client_payments (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id    UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  paid_on      DATE NOT NULL,
  amount       NUMERIC(10,2),          -- nullable: "they paid" without recording how much
  method       TEXT,                   -- cash | check | stripe | other
  -- Normally NULL and the next due date is paid_on + 1 month. Set it when a
  -- payment covers something other than a single month (three months up front,
  -- a half month to realign a billing date).
  covers_until DATE,
  note         TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_payments_client ON client_payments (client_id, paid_on DESC);

-- What they pay per month, so the card can show it and the "mark paid" button
-- can default to the right figure instead of making Glen type it every time.
ALTER TABLE clients
  ADD COLUMN IF NOT EXISTS monthly_amount NUMERIC(8,2);

-- When each client is next due. Postgres handles month-end properly:
-- 31 Jan + 1 month = 28 Feb, not an invalid date.
CREATE OR REPLACE VIEW client_dues AS
SELECT c.id AS client_id,
       c.coach_id,
       c.billing_type,
       p.last_paid,
       p.last_amount,
       COALESCE(p.covers_until, p.last_paid + INTERVAL '1 month')::date AS due_on,
       (COALESCE(p.covers_until, p.last_paid + INTERVAL '1 month')::date
          - CURRENT_DATE) AS days_until_due
FROM clients c
LEFT JOIN (
  SELECT DISTINCT ON (client_id)
         client_id, paid_on AS last_paid, amount AS last_amount, covers_until
  FROM client_payments
  ORDER BY client_id, paid_on DESC, created_at DESC
) p ON p.client_id = c.id;

COMMIT;

-- Verify:
--   SELECT * FROM client_dues WHERE last_paid IS NOT NULL LIMIT 5;
