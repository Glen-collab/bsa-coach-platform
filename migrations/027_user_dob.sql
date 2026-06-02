-- Capture client date of birth at signup. Permanent (unlike a stored "age"),
-- and lets us compute current age for challenge / leaderboard age brackets and
-- show it on the coach/admin client lists + new-signup email.
ALTER TABLE users ADD COLUMN IF NOT EXISTS dob DATE;
