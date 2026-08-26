-- 040_client_messages.sql
-- What was sent to a client, and when.
--
-- The log is the point, not a side effect. "Did I already wish her happy
-- birthday?" and "when did I last chase him about September?" are the questions
-- that get asked, and without a record the answer is a guess — which in
-- practice means either sending twice or not sending at all.
--
-- Two channels, sent two different ways:
--
--   'email' is sent by the server through the existing Gmail SMTP, so it goes
--           out whether or not the coach's laptop is awake.
--   'sms'   is NOT sent by the server. There is no SMS provider here and adding
--           one would be a monthly bill. The button opens an `sms:` link, the
--           phone's own Messages app sends it from Glen's real number — which
--           is better anyway, because a text from the gym's actual number is
--           the one people reply to. The row here records that he sent it.
--
-- So an 'sms' row means "handed to the phone", not "delivered". That is the
-- honest limit of what this can know, and the UI says so.
--
-- Apply on EC2:
--   PGPASSWORD='...' psql -h <rds-host> -U bsa_admin -d bestrongagain -f 040_client_messages.sql

BEGIN;

CREATE TABLE IF NOT EXISTS client_messages (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id   UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  channel     TEXT NOT NULL CHECK (channel IN ('email', 'sms')),
  -- Who it actually went to. Almost always a parent: of 179 active clients,
  -- none have their own address on file and 54 have a guardian's from a waiver.
  -- Storing the address rather than deriving it later means the record still
  -- reads true after someone's contact details are corrected.
  to_address  TEXT NOT NULL,
  to_name     TEXT,
  is_guardian BOOLEAN NOT NULL DEFAULT FALSE,
  kind        TEXT,                    -- 'birthday' | 'reminder' | 'dues' | 'note'
  subject     TEXT,
  body        TEXT NOT NULL,
  sent_by     UUID REFERENCES users(id) ON DELETE SET NULL,
  sent_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_messages_client ON client_messages (client_id, sent_at DESC);

COMMIT;

-- Verify:
--   SELECT channel, kind, COUNT(*) FROM client_messages GROUP BY 1,2 ORDER BY 3 DESC;
