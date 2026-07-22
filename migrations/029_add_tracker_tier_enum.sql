-- 029_add_tracker_tier_enum.sql
--
-- ROOT CAUSE of "$5.99 charged but no subscription": the subscription_tier
-- enum only had {basic, coached, elite}. The $5.99 "tracker" tier was added to
-- the app (PRICE_IDS/TIER_AMOUNTS) but NOT to this enum, so every tracker
-- checkout charged the card + created a Stripe sub, then the webhook's
-- INSERT INTO subscriptions (tier='tracker') threw
--   psycopg2.errors.InvalidTextRepresentation: invalid input value for enum
--   subscription_tier: "tracker"
-- → the sub was never recorded → the paywall saw no active sub → user blocked,
-- and Stripe retried the webhook forever. Two clients (Dave, Tanner) hit this;
-- Tanner was double-charged because each silent failure made him retry.
--
-- Applied to the live RDS on 2026-07-22. Kept here so git matches the DB.
--
-- NOTE: ALTER TYPE ... ADD VALUE cannot run inside a transaction block on older
-- Postgres and the new value can't be used in the same transaction it's added.
-- Run this statement on its own (psql autocommits single statements).

ALTER TYPE subscription_tier ADD VALUE IF NOT EXISTS 'tracker';
