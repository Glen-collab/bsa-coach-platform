"""
commission_engine.py
====================
Commission logic for BeStrongAgain coach platform.

HOW IT WORKS:
- A coach keeps 80% of their FIRST $100 of client revenue each month, and
  70% of everything above that. The step is MARGINAL, like tax brackets —
  a flat cliff would mean a coach who crossed $100 took home LESS than one
  who stopped at $99, so growing would be punished.
- Referral bonus: if you recruit a coach, you get 10% of their client
  revenue. ONE level only — no chains. This is symmetric: a coach who
  recruits another coach earns it exactly like a clinician referrer does.
- The platform keeps the remainder (10% under the line, 20% over, plus the
  referral 10% when nobody recruited that coach). Stripe fees come out of
  the platform's share, which is why there is a price floor.

Every split sums to exactly 100% of the sale. Protect that property.

EXAMPLE — coach already at $100 this month, client pays $200:
  - Coach keeps $140 (70%, all above the line)
  - Coach's recruiter gets $20 (10%)
  - Platform gets $40 (20%)

EXAMPLE — coach's first $80 of the month:
  - Coach keeps $64 (80%)
  - Recruiter gets $8 (10%)
  - Platform gets $8 (10%)

TOOL-ONLY COACHES: a coach who uses the app as a clipboard and never sells
it to clients generates no revenue but still costs storage, video bandwidth
and support. Settlement therefore charges the GREATER of the platform's
share or a per-active-client minimum. See settle_month().
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

# Marginal coach split. Below the threshold the coach keeps BASE, above it
# they keep UPPER. Marginal, not a cliff.
COACH_BASE_RATE = Decimal("0.80")
COACH_UPPER_RATE = Decimal("0.70")
COACH_TIER_THRESHOLD_CENTS = 10000     # $100 of client revenue per calendar month

# Tool-only minimum: charged per client who logged at least one workout this
# month, when that exceeds the platform's share of the coach's client revenue.
ACTIVE_CLIENT_MIN_CENTS = 200          # $2 per active client per month


def split_coach_share(prior_month_cents, sale_cents):
    """
    Coach's cut of THIS sale, given what they've already billed this month.

    Marginal: the portion of the sale below the threshold earns BASE, the
    portion above earns UPPER. A sale can straddle the line — a coach at $90
    taking a $15 sale gets 80% of $10 and 70% of $5.

    Returns cents (int, floor). Never negative.
    """
    if sale_cents <= 0:
        return 0
    prior = max(0, int(prior_month_cents or 0))
    remaining_base = max(0, COACH_TIER_THRESHOLD_CENTS - prior)
    at_base = min(sale_cents, remaining_base)
    at_upper = sale_cents - at_base
    return int(Decimal(at_base) * COACH_BASE_RATE + Decimal(at_upper) * COACH_UPPER_RATE)


def coach_month_to_date_cents(coach_id, db, now=None):
    """
    The coach's own client revenue so far this calendar month, used to place
    the next sale in the right bracket.

    Reads depth-0 rows only — exactly one exists per sale, so summing their
    sale_amount_cents can't double-count the way summing every row would.
    """
    with db.cursor() as cur:
        cur.execute("""
            SELECT COALESCE(SUM(sale_amount_cents), 0)
            FROM commissions
            WHERE earner_id = %s
              AND depth_from_earner = 0
              AND created_at >= date_trunc('month', COALESCE(%s, NOW()))
        """, (coach_id, now))
        row = cur.fetchone()
        return int(row[0]) if row and row[0] is not None else 0

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

    Splits three ways and ALWAYS sums to exactly the sale amount:
    1. Selling coach — 80% below the monthly threshold, 70% above (marginal)
    2. Recruiter — 10%, one level, only if someone recruited this coach
    3. Platform — the remainder (so rounding never leaks or over-pays)

    The coach's row is the important one. It did not exist before: the old
    engine recorded only a platform row and a recruiter row, on the
    assumption that the coach "keeps" their share automatically. That would
    be true under Stripe DIRECT charges, where the coach is merchant of
    record. Checkout runs on the PLATFORM account, so the coach kept nothing
    and no code ever transferred it to them.
    """
    commissions = []
    sale_amount_cents = int(sale_amount_cents)
    if sale_amount_cents <= 0:
        return commissions

    # Get the direct recruiter only (one level)
    upline = get_upline_chain(coach_user_id, db)

    # Coach's marginal share, placed against what they've already billed
    # this month.
    prior = coach_month_to_date_cents(coach_user_id, db)
    coach_cents = split_coach_share(prior, sale_amount_cents)
    effective_rate = (Decimal(coach_cents) / Decimal(sale_amount_cents)) if sale_amount_cents else Decimal(0)
    commissions.append({
        "id": str(uuid.uuid4()),
        "earner_id": coach_user_id,
        "subscription_id": subscription_id,
        "source_user_id": client_user_id,
        "sale_amount_cents": sale_amount_cents,
        "commission_rate": float(round(effective_rate, 4)),
        "admin_fee_cents": None,
        "commission_amount_cents": coach_cents,
        "depth_from_earner": 0,
        "status": "pending"
    })

    # Referral bonus — only if someone recruited this coach
    referral_cents = 0
    if upline:
        recruiter = upline[0]
        referral_cents = int(Decimal(sale_amount_cents) * REFERRAL_BONUS_RATE)
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

    # Platform takes what's left. Computing it as a remainder rather than a
    # rate is what guarantees the three shares reconcile to the sale exactly,
    # including the odd cent from flooring.
    platform_cents = sale_amount_cents - coach_cents - referral_cents
    commissions.append({
        "id": str(uuid.uuid4()),
        "earner_id": "PLATFORM",  # handled separately — goes to platform revenue
        "subscription_id": subscription_id,
        "source_user_id": client_user_id,
        "sale_amount_cents": sale_amount_cents,
        "commission_rate": float(round(Decimal(platform_cents) / Decimal(sale_amount_cents), 4)),
        "admin_fee_cents": None,
        "commission_amount_cents": platform_cents,
        "depth_from_earner": 0,
        "status": "platform"
    })

    return commissions


def active_client_count(coach_id, db, month_start=None):
    """
    Clients of this coach who logged at least one workout in the month.

    Dormant clients cost nothing to serve, so they aren't billable. Counts
    distinct emails on programs this coach created.
    """
    with db.cursor() as cur:
        cur.execute("""
            SELECT COUNT(DISTINCT LOWER(w.user_email))
            FROM workout_logs w
            JOIN workout_programs p ON p.access_code = w.access_code
            JOIN users u ON LOWER(u.email) = LOWER(p.created_by)
            WHERE u.id = %s
              AND w.created_at >= date_trunc('month', COALESCE(%s, NOW()))
        """, (coach_id, month_start))
        row = cur.fetchone()
        return int(row[0]) if row and row[0] is not None else 0


def build_settlement(coach_id, db, month_start=None):
    """
    Work out what a coach is owed for the month, and what the platform keeps.

    The platform charges the GREATER of its share of the coach's client
    revenue or a per-active-client minimum. A coach who uses the app purely
    as a clipboard generates no revenue but still costs storage, video
    bandwidth and support; without the minimum they would pay nothing.

    Any shortfall is deducted from the coach's payout. Returns a plan dict —
    it does NOT move money. settle_month() does that.
    """
    with db.cursor() as cur:
        cur.execute("""
            SELECT COALESCE(SUM(sale_amount_cents), 0),
                   COALESCE(SUM(commission_amount_cents), 0)
            FROM commissions
            WHERE earner_id = %s AND depth_from_earner = 0 AND status = 'pending'
              AND created_at >= date_trunc('month', COALESCE(%s, NOW()))
        """, (coach_id, month_start))
        sale_total, coach_total = cur.fetchone()
        sale_total, coach_total = int(sale_total or 0), int(coach_total or 0)

        cur.execute(
            "SELECT referred_by_id, role FROM users WHERE id = %s", (coach_id,)
        )
        r = cur.fetchone()
        has_upline = bool(r and r[0])
        is_platform_owner = bool(r and r[1] == "admin")

    referral_total = int(Decimal(sale_total) * REFERRAL_BONUS_RATE) if has_upline else 0
    platform_share = sale_total - coach_total - referral_total

    actives = active_client_count(coach_id, db, month_start)
    # The platform owner is not charged the per-active-client minimum. He IS
    # the platform — billing him for his own 1-on-1 roster would just move
    # money from one of his pockets to the other, and it made the payroll
    # screen show him owing himself.
    minimum = 0 if is_platform_owner else actives * ACTIVE_CLIENT_MIN_CENTS
    shortfall = max(0, minimum - platform_share)
    payout = max(0, coach_total - shortfall)

    return {
        "coach_id": coach_id,
        "client_revenue_cents": sale_total,
        "coach_earned_cents": coach_total,
        "referral_cents": referral_total,
        "platform_share_cents": platform_share,
        "active_clients": actives,
        "minimum_cents": minimum,
        "shortfall_cents": shortfall,
        "payout_cents": payout,
        # Owed directly when there's no payout to deduct from — a tool-only
        # coach with zero client revenue. Needs a charge, not a deduction.
        "direct_charge_cents": max(0, shortfall - coach_total),
    }


def settle_month(db, month_start=None, dry_run=True):
    """
    Settle a month's pending commissions: ONE Stripe Transfer per earner.

    Batching matters. Transferring per client per month would pay a per-payout
    fee on every client; at the low end of allowed pricing that fee would eat
    most of the platform's margin. One transfer per coach per month amortises
    it across their whole roster.

    dry_run=True (the default) computes the whole plan and moves no money.
    Always dry-run first and read the plan.
    """
    plan = {"month_start": str(month_start) if month_start else "current",
            "dry_run": dry_run, "earners": [], "totals": {}}

    with db.cursor() as cur:
        cur.execute("""
            SELECT earner_id, COUNT(*), COALESCE(SUM(commission_amount_cents), 0)
            FROM commissions
            WHERE status = 'pending'
              AND created_at >= date_trunc('month', COALESCE(%s, NOW()))
              AND created_at <  date_trunc('month', COALESCE(%s, NOW())) + INTERVAL '1 month'
            GROUP BY earner_id
        """, (month_start, month_start))
        rows = cur.fetchall()

    total_out = total_held = 0
    for earner_id, n_rows, gross_cents in rows:
        gross_cents = int(gross_cents or 0)
        settlement = build_settlement(earner_id, db, month_start)
        # Only a coach's own depth-0 earnings carry the platform minimum.
        # Referral-only earners (a clinician who never sells) have no roster,
        # so nothing is deducted from them.
        deduction = min(settlement["shortfall_cents"], gross_cents)
        net_cents = max(0, gross_cents - deduction)

        entry = {
            "earner_id": str(earner_id),
            "rows": n_rows,
            "gross_cents": gross_cents,
            "deduction_cents": deduction,
            "net_cents": net_cents,
            "active_clients": settlement["active_clients"],
            "direct_charge_cents": settlement["direct_charge_cents"],
            "transfer_id": None,
            "skipped": None,
            "retained": False,
        }

        with db.cursor() as c2:
            c2.execute("SELECT role FROM users WHERE id = %s", (earner_id,))
            rr = c2.fetchone()
        entry["retained"] = bool(rr and rr[0] == "admin")

        if net_cents <= 0:
            entry["skipped"] = "nothing to pay after deductions"
        elif entry["retained"] and dry_run:
            entry["skipped"] = "retained by platform — already in your Stripe balance"
        elif dry_run:
            entry["skipped"] = "dry run"
        else:
            entry.update(_transfer_earner(earner_id, net_cents, db, month_start))

        total_out += net_cents
        total_held += deduction
        plan["earners"].append(entry)

    plan["totals"] = {
        "earners": len(rows),
        "payout_cents": total_out,
        "withheld_cents": total_held,
    }
    return plan


def _transfer_earner(earner_id, net_cents, db, month_start=None):
    """One Transfer for an earner, then mark their pending rows paid."""
    with db.cursor() as cur:
        cur.execute(
            "SELECT stripe_account_id, stripe_onboarded, role FROM users WHERE id = %s",
            (earner_id,),
        )
        row = cur.fetchone()

    # The platform owner is never transferred to. Charges are collected on the
    # platform account, so money earned from his own clients is ALREADY in his
    # Stripe balance — a Transfer to himself is both meaningless and
    # impossible (he has no Connect account, and shouldn't need one). Settle
    # the rows as retained so they stop reappearing in every future payroll.
    if row and row[2] == "admin":
        with db.cursor() as cur:
            cur.execute("""
                UPDATE commissions
                SET status = 'paid', paid_at = NOW()
                WHERE earner_id = %s AND status = 'pending'
                  AND created_at >= date_trunc('month', COALESCE(%s, NOW()))
                  AND created_at <  date_trunc('month', COALESCE(%s, NOW())) + INTERVAL '1 month'
            """, (earner_id, month_start, month_start))
            db.commit()
        return {"retained": True,
                "skipped": "retained by platform — already in your Stripe balance"}

    if not row or not row[0] or not row[1]:
        # Approved-but-not-onboarded is a real state — a coach can be promoted
        # and start selling before finishing Stripe. Leave the rows pending so
        # they settle next run rather than silently vanishing.
        return {"skipped": "earner has no completed Stripe Connect account"}

    try:
        transfer = stripe.Transfer.create(
            amount=net_cents,
            currency="usd",
            destination=row[0],
            metadata={"earner_id": str(earner_id), "kind": "monthly_settlement"},
        )
    except stripe.error.StripeError as e:
        return {"skipped": f"stripe error: {e}"}

    with db.cursor() as cur:
        cur.execute("""
            UPDATE commissions
            SET status = 'paid', stripe_transfer_id = %s, paid_at = NOW()
            WHERE earner_id = %s AND status = 'pending'
              AND created_at >= date_trunc('month', COALESCE(%s, NOW()))
              AND created_at <  date_trunc('month', COALESCE(%s, NOW())) + INTERVAL '1 month'
        """, (transfer.id, earner_id, month_start, month_start))
        db.commit()

    return {"transfer_id": transfer.id}


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
