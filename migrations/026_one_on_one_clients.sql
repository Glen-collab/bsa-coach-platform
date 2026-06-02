-- 1-on-1 Training: a coach's curated "folder" of clients they personally train,
-- so the picker shows just these (not everyone who's ever logged), pinned at top.
-- group_name (nullable) groups 2-4 of them; rows sharing a group_name = one group.
CREATE TABLE IF NOT EXISTS one_on_one_clients (
  id            SERIAL PRIMARY KEY,
  coach_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  client_email  TEXT NOT NULL,
  client_name   TEXT,
  access_code   TEXT,
  group_name    TEXT,
  created_at    TIMESTAMP DEFAULT NOW(),
  UNIQUE (coach_id, client_email)
);

CREATE INDEX IF NOT EXISTS idx_one_on_one_coach ON one_on_one_clients(coach_id);
