"""
commission_engine.py
====================
Commission logic for BeStrongAgain coach platform.

HOW IT WORKS:
- Every coach keeps 90% of their client revenue.
- 10% goes to the platform as an administration fee (covers app, videos,
  hosting, billing, support). This applies to ALL coaches at ANY depth.
- Referral bonus: if you recruit a coach, you get 10% of their client
  revenue as a one-level referral bonus. ONE level only — no chains.

EXAMPLE:
  Client pays $200/mo for Coached tier:
  - Coach keeps $160 (80%)
  - Platform gets $20 (10%)
  - Coach's recruiter gets $20 (10%)

  If nobody recruited the coach:
  - Coach keeps $160 (80%)
  - Platform gets $40 (10% fee + 10% unclaimed upline)
"""

import uuid
from decimal import Decimal
from datetime import datetime
import psycopg2
import stripe
import os

# Revenue split
PLATFORM_FEE_RATE = Decimal("0.10")    # 10% platform/admin fee — always
REFERRAL_BONUS_RATE = Decimal("0.10")  # 10% to whoever recruited the coach — one level only
MAX_COMMISSION_DEPTH = 1               # One level of referral only — not a pyramid

stripe.api_key = os.environ.get("STRIPE_SECRET_KEY")


def get_db():
    return psycopg2.connect(os.environ.get("DATABASE_URL"))


def get_upline_chain(coach_id: str, db) -> list:
    """
    Walk up the referral tree from the COACH who made the sale.
    Returns list of upline users ordered closest-first.
    Stops at MAX_COMMISSION_DEPTH.
    """
    chain = []
    current_id = coach_id
    visited = set()

    with db.cursor() as cur:
        while current_id and len(chain) < MAX_COMMISSION_DEPTH:
            if current_id in visited:
                break
            visited.add(current_id)

            cur.execute("""
                SELECT id, referred_by_id, stripe_account_id, stripe_onboarded, role
                FROM users
                WHERE id = %s AND is_active = TRUE
            """, (current_id,))
            row = cur.fetchone()

            if not row:
                break

            user_id_val, referred_by_id, stripe_acct, onboarded, role = row

            # Don't add the coach themselves — they keep their 80%
            if str(user_id_val) != coach_id:
                chain.append({
                    "id": str(user_id_val),
                    "stripe_account_id": stripe_acct,
                    "stripe_onboarded": onboarded,
                    "role": role,
                })

            current_id = str(referred_by_id) if referred_by_id else None

    return chain


def calculate_commissions(
    subscription_id: str,
    client_user_id: str,
    coach_user_id: str,
    sale_amount_cents: int,
    db
) -> list:
    """
    Given a sale, calculate commissions.

    Every sale splits three ways:
    1. Coach keeps 80%
    2. Platform fee 10% — always goes to platform
    3. Upline 10% — goes to whoever recruited the coach

    If nobody recruited the coach, the platform gets 20% total (10% + 10%).
    Coach always keeps 80% regardless of who recruited them.
    """
    commissions = []

    # Get the direct recruiter only (one level)
    upline = get_upline_chain(coach_user_id, db)

    # Platform fee — always recorded (10%)
    platform_fee_cents = int(sale_amount_cents * PLATFORM_FEE_RATE)
    commissions.append({
        "id": str(uuid.uuid4()),
        "earner_id": "PLATFORM",  # handled separately — goes to platform revenue
        "subscription_id": subscription_id,
        "source_user_id": client_user_id,
        "sale_amount_cents": sale_amount_cents,
        "commission_rate": float(PLATFORM_FEE_RATE),
        "admin_fee_cents": None,
        "commission_amount_cents": platform_fee_cents,
        "depth_from_earner": 0,
        "status": "platform"
    })

    # Referral bonus — only if someone recruited this coach
    if upline:
        recruiter = upline[0]
        referral_cents = int(sale_amount_cents * REFERRAL_BONUS_RATE)
        commissions.append({
            "id": str(uuid.uuid4()),
            "earner_id": recruiter["id"],
            "subscription_id": subscription_id,
            "source_user_id": client_user_id,
            "sale_amount_cents": sale_amount_cents,
            "commission_rate": float(REFERRAL_BONUS_RATE),
            "admin_fee_cents": None,
            "commission_amount_cents": referral_cents,
            "depth_from_earner": 1,
            "status": "pending"
        })

    return commissions


def save_commissions(commissions: list, db):
    """Insert commission records into DB. Skips platform fee entries (tracked separately)."""
    with db.cursor() as cur:
        for c in commissions:
            if c["earner_id"] == "PLATFORM":
                continue  # Platform revenue — not a payout, just tracking
            cur.execute("""
                INSERT INTO commissions (
                    id, earner_id, subscription_id, source_user_id,
                    sale_amount_cents, commission_rate, admin_fee_cents,
                    commission_amount_cents, depth_from_earner, status
                ) VALUES (
                    %(id)s, %(earner_id)s, %(subscription_id)s, %(source_user_id)s,
                    %(sale_amount_cents)s, %(commission_rate)s, %(admin_fee_cents)s,
                    %(commission_amount_cents)s, %(depth_from_earner)s, %(status)s
                )
            """, c)
        db.commit()


def pay_commission(commission_id: str, db):
    """
    Execute a Stripe Transfer for a pending commission.
    Only pays if earner has a connected Stripe account.
    """
    with db.cursor() as cur:
        cur.execute("""
            SELECT c.id, c.earner_id, c.commission_amount_cents,
                   u.stripe_account_id, u.stripe_onboarded
            FROM commissions c
            JOIN users u ON u.id = c.earner_id
            WHERE c.id = %s AND c.status = 'pending'
        """, (commission_id,))
        row = cur.fetchone()

        if not row:
            return {"error": "Commission not found or already paid"}

        comm_id, earner_id, amount_cents, stripe_acct, onboarded = row

        if not stripe_acct or not onboarded:
            return {"error": f"Earner {earner_id} has no connected Stripe account"}

        if amount_cents <= 0:
            return {"skipped": "Admin fee — handled monthly"}

        try:
            transfer = stripe.Transfer.create(
                amount=amount_cents,
                currency="usd",
                destination=stripe_acct,
                metadata={"commission_id": str(comm_id)}
            )

            cur.execute("""
                UPDATE commissions
                SET status = 'paid', stripe_transfer_id = %s, paid_at = NOW()
                WHERE id = %s
            """, (transfer.id, str(comm_id)))
            db.commit()

            return {"success": True, "transfer_id": transfer.id}

        except stripe.error.StripeError as e:
            cur.execute("UPDATE commissions SET status = 'failed' WHERE id = %s", (str(comm_id),))
            db.commit()
            return {"error": str(e)}


    # No monthly admin fee processing needed in this model.
    # The 10% platform fee is collected per transaction automatically.
