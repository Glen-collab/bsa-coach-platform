-- 035_adjustments.sql
-- A balance correction is not a visit.
--
-- Two things need to move a balance without anybody having walked through the
-- door: the 11 negative rows the FileMaker ledger carried (manual corrections
-- Glen made over the years), and reconciliations like Troy Wendorf's, where a
-- parent's package paid for his kids' sessions and the recorded totals drifted.
--
-- Modelling those as attendance rows is right — they consume sessions — but
-- counting them as VISITS is not: it inflates "830 visits" to 831 and puts a
-- phantom training day in the weekday pattern that drives session grouping.
-- So they get their own source, and every visit count excludes it.
--
-- Apply on EC2:
--   PGPASSWORD='...' psql -h <rds-host> -U bsa_admin -d bestrongagain -f 035_adjustments.sql

BEGIN;

ALTER TABLE attendance DROP CONSTRAINT IF EXISTS attendance_source_check;
ALTER TABLE attendance ADD CONSTRAINT attendance_source_check
  CHECK (source IN ('phone', 'kiosk', 'legacy', 'web', 'adjustment'));

-- The ledger's negative rows were always corrections, never attendance.
UPDATE attendance
   SET source = 'adjustment',
       note = COALESCE(note, 'Manual balance correction carried over from FileMaker')
 WHERE sessions_used < 0 AND source = 'legacy';

-- Session credits can be corrected too, without pretending a purchase happened.
ALTER TABLE session_packages
  ADD COLUMN IF NOT EXISTS is_adjustment BOOLEAN NOT NULL DEFAULT FALSE;

-- Sessions used still counts adjustments — that is the point of them.
-- Visit counts no longer do.
CREATE OR REPLACE VIEW client_balance AS
SELECT c.id                                            AS client_id,
       c.coach_id,
       c.display_name,
       c.billing_type,
       COALESCE(p.bought, 0)                           AS purchased,
       COALESCE(a.used, 0)                             AS used,
       COALESCE(p.bought, 0) - COALESCE(a.used, 0)     AS remaining,
       a.first_visit,
       a.last_visit,
       a.visits,
       (a.last_visit + INTERVAL '1 year')::date        AS credits_expire_on,
       (a.last_visit < CURRENT_DATE - INTERVAL '1 year') AS forfeited,
       COALESCE(p.needs_review, FALSE)                 AS balance_needs_review
FROM clients c
LEFT JOIN (
  SELECT client_id,
         SUM(sessions_purchased) AS bought,
         bool_or(needs_review)   AS needs_review
  FROM session_packages GROUP BY client_id
) p ON p.client_id = c.id
LEFT JOIN (
  SELECT client_id,
         SUM(sessions_used)                                          AS used,
         MIN(attended_on) FILTER (WHERE source <> 'adjustment')      AS first_visit,
         MAX(attended_on) FILTER (WHERE source <> 'adjustment')      AS last_visit,
         COUNT(*)         FILTER (WHERE source <> 'adjustment')      AS visits
  FROM attendance GROUP BY client_id
) a ON a.client_id = c.id;

COMMIT;

-- Verify:
--   SELECT source, COUNT(*) FROM attendance GROUP BY source;
