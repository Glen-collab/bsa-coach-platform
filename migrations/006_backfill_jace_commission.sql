-- One-time backfill for Jace Mullett's $20 basic subscription, which
-- predated the commission_engine fix that records the coach 80% +
-- routes platform fee 10% + unclaimed upline 10% to the platform owner.
-- All three rows go to Glen (coach + platform owner + no upline). Idempotent.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM commissions
    WHERE subscription_id = '67cfd787-b824-43f4-b870-b3282322e864'::uuid
  ) THEN
    INSERT INTO commissions (
      id, earner_id, subscription_id, source_user_id,
      sale_amount_cents, commission_rate, commission_amount_cents,
      depth_from_earner, status
    ) VALUES
      -- Glen as coach (80%)
      (gen_random_uuid(),
       '53702390-87ad-4eac-bdc8-cc2a3408cdb6'::uuid,
       '67cfd787-b824-43f4-b870-b3282322e864'::uuid,
       'b0256462-8f41-4ae0-b86b-3a047b8b77bc'::uuid,
       2000, 0.80, 1600, 0, 'pending'),
      -- Glen as platform fee (10%)
      (gen_random_uuid(),
       '53702390-87ad-4eac-bdc8-cc2a3408cdb6'::uuid,
       '67cfd787-b824-43f4-b870-b3282322e864'::uuid,
       'b0256462-8f41-4ae0-b86b-3a047b8b77bc'::uuid,
       2000, 0.10, 200, 0, 'pending'),
      -- Glen as unclaimed upline (10%)
      (gen_random_uuid(),
       '53702390-87ad-4eac-bdc8-cc2a3408cdb6'::uuid,
       '67cfd787-b824-43f4-b870-b3282322e864'::uuid,
       'b0256462-8f41-4ae0-b86b-3a047b8b77bc'::uuid,
       2000, 0.10, 200, 0, 'pending');
  END IF;
END $$;
