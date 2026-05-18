-- Password reset tokens. One-time use, 1-hour TTL.
-- We store the SHA-256 of the token (not the token itself) so a DB leak
-- can't be used to hijack an in-flight reset.

CREATE TABLE IF NOT EXISTS password_resets (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash    VARCHAR(128) NOT NULL UNIQUE,
    expires_at    TIMESTAMPTZ NOT NULL,
    used_at       TIMESTAMPTZ,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_password_resets_user_id     ON password_resets(user_id);
CREATE INDEX IF NOT EXISTS idx_password_resets_expires_at  ON password_resets(expires_at) WHERE used_at IS NULL;
