-- 008_coach_branding.sql
-- Per-coach branding for gym TV kiosks.
--   brand_logo_data   : base64-encoded image (png/jpg/svg); NULL = use BSA default
--   brand_primary     : primary brand color hex (e.g. '#667eea')
--   brand_accent      : accent/highlight hex
--   brand_gym_name    : display name on the TV header (e.g. "Glen's MA Academy")
-- All nullable. When any are NULL the TV falls back to BSA defaults client-side.

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS brand_logo_data   TEXT,
  ADD COLUMN IF NOT EXISTS brand_primary     TEXT,
  ADD COLUMN IF NOT EXISTS brand_accent      TEXT,
  ADD COLUMN IF NOT EXISTS brand_gym_name    TEXT;
