-- 004_chatbot_config.sql
-- Adds per-coach chatbot persona config so the BSA chatbot can speak in
-- each coach's voice (white-label). NULL = use default Glen voice.
--
-- Schema of the JSONB:
--   coach_voice_name      str   — what the bot calls the coach ("Coach Steve")
--   gym_name              str   — gym/brand name
--   single_coach          bool  — true = only one persona; no Ali handoffs
--   secondary_coach_name  str   — optional partner like "Ali"
--   secondary_coach_role  str   — e.g. "nutrition + AdvoCare"
--   business_url          str   — where the bot points clients (own site, affiliate, etc.)
--   business_pitch        str   — short description of what they sell
--   coach_philosophy      str   — freeform bio/voice text for the model to mimic
--   advocare_enabled      bool  — keep AdvoCare PC pitch + basket-card logic active

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS chatbot_config JSONB DEFAULT NULL;
