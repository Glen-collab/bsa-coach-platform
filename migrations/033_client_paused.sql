-- 033_client_paused.sql
-- A client who stops coming is not the same as a client who was never really a
-- client. 'prospect' means one visit and never seen again — the importer's
-- guess. 'paused' and 'former' are Glen's explicit decisions, made on the card.
--
--   active    on the check-in list
--   paused    membership on hold, expected back — off the list, easy to restore
--   former    no longer a client — off the list, history kept
--   prospect  a single historical visit; never promoted by anyone
--   inactive  legacy import bucket: no visit in 120 days, nobody has ruled on it
--
-- Apply on EC2:
--   PGPASSWORD='...' psql -h <rds-host> -U bsa_admin -d bestrongagain -f 033_client_paused.sql

BEGIN;

ALTER TABLE clients DROP CONSTRAINT IF EXISTS clients_status_check;
ALTER TABLE clients ADD CONSTRAINT clients_status_check
  CHECK (status IN ('active', 'paused', 'former', 'prospect', 'inactive'));

-- When a membership was paused or ended, and why. Nullable: the legacy import
-- never set a status by hand, so most rows have no such moment.
ALTER TABLE clients
  ADD COLUMN IF NOT EXISTS status_changed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS status_note TEXT;

COMMIT;

-- Verify:
--   SELECT status, COUNT(*) FROM clients GROUP BY status ORDER BY 2 DESC;
