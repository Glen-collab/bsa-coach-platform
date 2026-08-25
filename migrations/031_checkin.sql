-- 031_checkin.sql
-- Client check-in: the attendance ledger that FileMaker has been carrying since 2008.
--
-- Two things this schema exists to fix, both inherited from the FileMaker file:
--
--   1. A check-in and a purchase are different events. They shared one row shape
--      for eighteen years, so recording a payment meant duplicating a person's
--      record. Here they are separate tables and the balance is a SUM(), never
--      a stored number that can drift from its own inputs.
--
--   2. "Sessions remaining" was only ever in Glen's head. `client_balance`
--      computes it, including the contract's rolling one-year forfeiture:
--      credits expire a year after the client's LAST VISIT, not a fixed date.
--
-- Multi-tenant from day one. Scoping is (coach_id OR gym_id) because a solo
-- trainer has gym_id NULL (see 014_gyms.sql) while gym partners share one.
-- Retro-fitting tenancy onto a live attendance table is miserable; adding the
-- column now costs nothing.
--
-- Apply on EC2:
--   PGPASSWORD='...' psql -h <rds-host> -U bsa_admin -d bestrongagain -f 031_checkin.sql

BEGIN;

-- ── People ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS clients (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  coach_id        UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  gym_id          UUID REFERENCES gyms(id) ON DELETE SET NULL,
  user_id         UUID REFERENCES users(id) ON DELETE SET NULL,  -- when they have a login

  first_name      TEXT NOT NULL DEFAULT '',
  last_name       TEXT NOT NULL DEFAULT '',
  display_name    TEXT NOT NULL,                 -- what the check-in row shows
  date_of_birth   DATE,                          -- age, and the guardian rule on waivers

  -- How they pay. 'untracked' means count the sessions and show no money at all.
  billing_type    TEXT NOT NULL DEFAULT 'monthly'
                    CHECK (billing_type IN ('monthly','package','drop_in','one_on_one','untracked')),
  rate_amount     NUMERIC(8,2),                  -- per-session rate, drop-ins only

  -- Grouping. `sessions` holds pinned 'dow-block' keys like '2-morning';
  -- anything not pinned is learned from attendance.attended_at instead.
  sports          TEXT[] NOT NULL DEFAULT '{}',
  sessions        TEXT[] NOT NULL DEFAULT '{}',
  slot            TEXT,                          -- manual time override: 'morning' | 'h9' | …

  status          TEXT NOT NULL DEFAULT 'active'
                    CHECK (status IN ('active','prospect','inactive')),
  email           TEXT,
  cell_phone      TEXT,
  home_phone      TEXT,
  street          TEXT, city TEXT, state TEXT, zip TEXT,
  guardian_first  TEXT, guardian_last TEXT,
  emergency_name  TEXT, emergency_phone TEXT,

  legacy_name     TEXT,                          -- exact FileMaker string, kept for audit
  legacy_category TEXT,                          -- the retired Y/A/B letter. Nothing reads it.
  notes           TEXT,

  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_clients_coach   ON clients (coach_id, status);
CREATE INDEX IF NOT EXISTS idx_clients_gym     ON clients (gym_id) WHERE gym_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_clients_name    ON clients (coach_id, lower(display_name));
CREATE INDEX IF NOT EXISTS idx_clients_sports  ON clients USING GIN (sports);

-- One import must not create the same person twice if it is re-run.
CREATE UNIQUE INDEX IF NOT EXISTS uq_clients_legacy
  ON clients (coach_id, legacy_name) WHERE legacy_name IS NOT NULL;

-- ── Attendance: one row per visit, 2008 → forever ─────────────────────────
CREATE TABLE IF NOT EXISTS attendance (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id     UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  coach_id      UUID REFERENCES users(id) ON DELETE SET NULL,
  gym_id        UUID REFERENCES gyms(id) ON DELETE SET NULL,

  attended_on   DATE NOT NULL,
  -- The clock stamp. This is what teaches the app that Tuesday 9am and Tuesday
  -- 2pm are different groups of people. NULL on the 135k imported rows because
  -- FileMaker only ever recorded the date.
  attended_at   TIMESTAMPTZ,

  sessions_used NUMERIC(5,2) NOT NULL DEFAULT 1,
  paid          BOOLEAN,                         -- NULL = nobody said. Never blocks a check-in.
  amount        NUMERIC(8,2),
  coach_name    TEXT,
  session_type  TEXT,
  source        TEXT NOT NULL DEFAULT 'phone'
                  CHECK (source IN ('phone','kiosk','legacy','web')),
  note          TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- One check-in per person per day: tapping a row twice is an undo, not a double.
CREATE UNIQUE INDEX IF NOT EXISTS uq_attendance_day
  ON attendance (client_id, attended_on);
CREATE INDEX IF NOT EXISTS idx_attendance_client ON attendance (client_id, attended_on DESC);
CREATE INDEX IF NOT EXISTS idx_attendance_date   ON attendance (coach_id, attended_on DESC);
-- Drives session learning: only rows that carry a real clock time matter.
CREATE INDEX IF NOT EXISTS idx_attendance_at
  ON attendance (client_id, attended_at) WHERE attended_at IS NOT NULL;

-- ── Session credits IN (rare now, but the balances are real) ──────────────
CREATE TABLE IF NOT EXISTS session_packages (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id          UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  purchased_on       DATE NOT NULL,
  sessions_purchased NUMERIC(6,2) NOT NULL,
  amount_paid        NUMERIC(10,2),              -- nullable: off-books packages
  payment_method     TEXT,
  check_no           TEXT,
  -- Set by the importer where the ledger's purchase/visit columns cannot be
  -- reconciled. The UI shows the history and refuses to assert a balance.
  needs_review       BOOLEAN NOT NULL DEFAULT FALSE,
  note               TEXT,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_packages_client ON session_packages (client_id, purchased_on DESC);

-- ── Waivers: every signature, kept forever, never overwritten ─────────────
-- Column set deliberately mirrors the leaderboard's waiver_submissions, which
-- is already correct — except the parent fields are conditional here, because
-- adult and one-on-one clients have no guardian.
CREATE TABLE IF NOT EXISTS client_waivers (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id      UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  version        TEXT NOT NULL,
  text_sha256    TEXT,                           -- hash of the exact text shown
  signed_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  typed_name     TEXT NOT NULL,
  signed_by      TEXT NOT NULL DEFAULT 'self' CHECK (signed_by IN ('self','guardian')),
  guardian_name  TEXT, guardian_email TEXT, guardian_phone TEXT,
  ip             INET,
  user_agent     TEXT,
  imported_from  TEXT,                           -- 'leaderboard' for migrated rows
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_waivers_client ON client_waivers (client_id, signed_at DESC);

-- ── The balance. Never stored, always true. ───────────────────────────────
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
         SUM(sessions_used) AS used,
         MIN(attended_on)   AS first_visit,
         MAX(attended_on)   AS last_visit,
         COUNT(*)           AS visits
  FROM attendance GROUP BY client_id
) a ON a.client_id = c.id;

COMMIT;

-- Verify:
--   \d clients
--   SELECT COUNT(*) FROM clients;
--   SELECT * FROM client_balance ORDER BY visits DESC NULLS LAST LIMIT 5;
