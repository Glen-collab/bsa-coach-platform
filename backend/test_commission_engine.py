"""
test_commission_engine.py
=========================
Tests for the money path. Run on the server where psycopg2 + the .env live:

    cd /opt/bestrongagain && python3 test_commission_engine.py

DB-backed tests run inside a transaction that is ALWAYS rolled back, so this
is safe to run against production. Nothing it writes survives.
"""

import os
import sys
import uuid
from decimal import Decimal

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from commission_engine import (  # noqa: E402
    split_coach_share,
    calculate_commissions,
    build_settlement,
    COACH_TIER_THRESHOLD_CENTS,
    ACTIVE_CLIENT_MIN_CENTS,
    get_db,
)

PASS, FAIL = [], []


def check(name, got, want):
    if got == want:
        PASS.append(name)
        print(f"  PASS  {name}")
    else:
        FAIL.append(name)
        print(f"  FAIL  {name}\n          got  {got!r}\n          want {want!r}")


def check_true(name, cond, detail=""):
    check(name, bool(cond), True) if cond else check(name, detail or False, True)


# ─────────────────────────────────────────────────────────────────────────────
print("\n[1] Marginal coach split — pure logic, no DB")
# ─────────────────────────────────────────────────────────────────────────────

# Wholly below the line: straight 80%.
check("$15 sale, nothing billed yet", split_coach_share(0, 1500), 1200)
check("$100 sale exactly fills the base bracket", split_coach_share(0, 10000), 8000)

# Wholly above the line: straight 70%.
check("$15 sale when already at $100", split_coach_share(10000, 1500), 1050)
check("$200 sale when already at $500", split_coach_share(50000, 20000), 14000)

# Straddling the line — the case a flat cliff gets wrong.
# At $90 prior, a $15 sale is $10 at 80% ($8.00) + $5 at 70% ($3.50) = $11.50
check("$15 sale straddling the line at $90", split_coach_share(9000, 1500), 1150)

# THE NOTCH TEST: crossing the threshold must never reduce take-home.
# 6 clients at $15 = $90 gross; 7 clients = $105 gross.
def cumulative(n, price=1500):
    total, prior = 0, 0
    for _ in range(n):
        c = split_coach_share(prior, price)
        total += c
        prior += price
    return total

six, seven = cumulative(6), cumulative(7)
check("6 clients -> $72.00", six, 7200)
check_true("7th client INCREASES take-home (no notch)", seven > six,
           f"6={six} 7={seven}")
check("7 clients -> $83.50 (marginal, not $73.50 cliff)", seven, 8350)

# Monotonic across a wide range — growth must always pay.
prev, monotonic = -1, True
for n in range(0, 40):
    v = cumulative(n)
    if v < prev:
        monotonic = False
        break
    prev = v
check("take-home is monotonic in client count", monotonic, True)

# Edge cases
check("zero sale", split_coach_share(0, 0), 0)
check("negative sale ignored", split_coach_share(0, -500), 0)
check("negative prior treated as zero", split_coach_share(-999, 1500), 1200)


# ─────────────────────────────────────────────────────────────────────────────
print("\n[2] calculate_commissions — splits reconcile to the sale exactly")
# ─────────────────────────────────────────────────────────────────────────────

db = get_db()
db.autocommit = False
cur = db.cursor()

# Build a throwaway coach + recruiter + client inside the transaction.
recruiter_id, coach_id, client_id = str(uuid.uuid4()), str(uuid.uuid4()), str(uuid.uuid4())
cur.execute("""
    INSERT INTO users (id, email, first_name, last_name, password_hash, role, referral_code, is_active)
    VALUES (%s,%s,'Rec','Ruiter','x','coach',%s,TRUE)
""", (recruiter_id, f"rec-{recruiter_id[:8]}@test.invalid", f"REC{recruiter_id[:6].upper()}"))
cur.execute("""
    INSERT INTO users (id, email, first_name, last_name, password_hash, role, referral_code, referred_by_id, is_active)
    VALUES (%s,%s,'Co','Ach','x','coach',%s,%s,TRUE)
""", (coach_id, f"coach-{coach_id[:8]}@test.invalid", f"CO{coach_id[:6].upper()}", recruiter_id))
cur.execute("""
    INSERT INTO users (id, email, first_name, last_name, password_hash, role, referral_code, is_active)
    VALUES (%s,%s,'Cli','Ent','x','member',%s,TRUE)
""", (client_id, f"cli-{client_id[:8]}@test.invalid", f"CL{client_id[:6].upper()}"))
# NO commit anywhere in this file. Every helper takes the same connection, so
# uncommitted rows are visible within this transaction — and a commit would
# write test users into the production users table permanently.

sub_id = str(uuid.uuid4())
# commissions.subscription_id is FK-constrained, so the parent row has to exist.
cur.execute("""
    INSERT INTO subscriptions (id, user_id, coach_id, tier, status,
        stripe_subscription_id, stripe_price_id, amount_cents,
        current_period_start, current_period_end)
    VALUES (%s,%s,%s,'basic','active',%s,'price_test',1500, NOW(), NOW() + INTERVAL '1 month')
""", (sub_id, client_id, coach_id, f"sub_test_{sub_id[:8]}"))


def totals(rows):
    return sum(r["commission_amount_cents"] for r in rows)


def by_depth(rows, depth, earner=None):
    for r in rows:
        if r["depth_from_earner"] == depth and (earner is None or r["earner_id"] == earner):
            return r
    return None


rows = calculate_commissions(sub_id, client_id, coach_id, 1500, db)
check("$15 sale: three rows (coach, recruiter, platform)", len(rows), 3)
check("$15 sale: shares sum to the sale", totals(rows), 1500)
check("$15 sale: coach gets 80%", by_depth(rows, 0, coach_id)["commission_amount_cents"], 1200)
check("$15 sale: recruiter gets 10%", by_depth(rows, 1)["commission_amount_cents"], 150)
check("$15 sale: platform gets the rest", by_depth(rows, 0, "PLATFORM")["commission_amount_cents"], 150)

# An amount that doesn't divide cleanly — the platform remainder must absorb it.
rows = calculate_commissions(sub_id, client_id, coach_id, 599, db)
check("$5.99 sale: shares still sum exactly", totals(rows), 599)
check_true("$5.99 sale: no negative share",
           all(r["commission_amount_cents"] >= 0 for r in rows))

# No recruiter -> platform keeps the referral slice, still sums.
rows_no_up = calculate_commissions(sub_id, client_id, recruiter_id, 1500, db)
check("no recruiter: two rows only", len(rows_no_up), 2)
check("no recruiter: still sums to the sale", totals(rows_no_up), 1500)
check("no recruiter: platform keeps 20%",
      by_depth(rows_no_up, 0, "PLATFORM")["commission_amount_cents"], 300)

check("zero-dollar sale produces nothing",
      calculate_commissions(sub_id, client_id, coach_id, 0, db), [])


# ─────────────────────────────────────────────────────────────────────────────
print("\n[3] Month-to-date bracket — the coach's rate steps down mid-month")
# ─────────────────────────────────────────────────────────────────────────────

# Persist enough depth-0 revenue to push the coach past the threshold.
cur.execute("""
    INSERT INTO commissions (id, earner_id, subscription_id, source_user_id,
        sale_amount_cents, commission_rate, commission_amount_cents,
        depth_from_earner, status)
    VALUES (%s,%s,%s,%s,%s,0.80,%s,0,'pending')
""", (str(uuid.uuid4()), coach_id, sub_id, client_id, 9000, 7200))

rows = calculate_commissions(sub_id, client_id, coach_id, 1500, db)
check("at $90 MTD, next $15 straddles: coach gets $11.50",
      by_depth(rows, 0, coach_id)["commission_amount_cents"], 1150)
check("straddling sale still sums to the sale", totals(rows), 1500)


# ─────────────────────────────────────────────────────────────────────────────
print("\n[4] Settlement — tool-only minimum and the greater-of rule")
# ─────────────────────────────────────────────────────────────────────────────

plan = build_settlement(coach_id, db)
check("settlement sees the $90 of client revenue", plan["client_revenue_cents"], 9000)
check("coach earned $72 on it", plan["coach_earned_cents"], 7200)
check("recruiter's 10% is accounted for", plan["referral_cents"], 900)
check("platform share = revenue - coach - recruiter",
      plan["platform_share_cents"],
      plan["client_revenue_cents"] - plan["coach_earned_cents"] - plan["referral_cents"])
check_true("payout never negative", plan["payout_cents"] >= 0)

# A coach with revenue but no active clients has no minimum to meet.
check("no active clients -> no minimum", plan["minimum_cents"], 0)
check("no minimum -> no shortfall", plan["shortfall_cents"], 0)
check("payout equals what the coach earned", plan["payout_cents"], 7200)

# Tool-only: no client revenue at all.
tool_id = str(uuid.uuid4())
cur.execute("""
    INSERT INTO users (id, email, first_name, last_name, password_hash, role, referral_code, is_active)
    VALUES (%s,%s,'Tool','Only','x','coach',%s,TRUE)
""", (tool_id, f"tool-{tool_id[:8]}@test.invalid", f"TL{tool_id[:6].upper()}"))

tool_plan = build_settlement(tool_id, db)
check("tool-only coach earned nothing", tool_plan["coach_earned_cents"], 0)
check("tool-only coach has no payout", tool_plan["payout_cents"], 0)
check_true("tool-only shortfall can't be deducted -> becomes a direct charge",
           tool_plan["direct_charge_cents"] == tool_plan["shortfall_cents"])

# Greater-of arithmetic, checked directly.
for actives, plat, want_short in [(0, 0, 0), (20, 4000, 0), (20, 3000, 1000), (5, 0, 1000)]:
    minimum = actives * ACTIVE_CLIENT_MIN_CENTS
    check(f"greater-of: {actives} active, platform {plat}c -> shortfall {want_short}c",
          max(0, minimum - plat), want_short)


# ─────────────────────────────────────────────────────────────────────────────
print("\n[5] settle_month — batching, and it must not move money on a dry run")
# ─────────────────────────────────────────────────────────────────────────────

from commission_engine import settle_month  # noqa: E402

sp = settle_month(db, dry_run=True)
check_true("dry run is flagged as such", sp["dry_run"] is True)
check_true("dry run executed no transfers",
           all(e["transfer_id"] is None for e in sp["earners"]))
check_true("every earner is accounted for with a reason",
           all(e["skipped"] for e in sp["earners"]))

ours = [e for e in sp["earners"] if e["earner_id"] == coach_id]
check("our test coach appears exactly once in the plan", len(ours), 1)
check("coach's gross is the $72 pending", ours[0]["gross_cents"], 7200)
check_true("net never exceeds gross",
           all(e["net_cents"] <= e["gross_cents"] for e in sp["earners"]))
check_true("no negative payout",
           all(e["net_cents"] >= 0 for e in sp["earners"]))
check("totals add up",
      sp["totals"]["payout_cents"],
      sum(e["net_cents"] for e in sp["earners"]))

# One row per earner — that's the batching guarantee. Paying per client would
# incur a per-payout fee on every single client.
ids = [e["earner_id"] for e in sp["earners"]]
check("one settlement row per earner (batched)", len(ids), len(set(ids)))

# An earner with no completed Connect account must be skipped, not paid, and
# must keep their rows pending for the next run.
plan_live_shape = _transfer_probe = None
from commission_engine import _transfer_earner  # noqa: E402
res = _transfer_earner(coach_id, 100, db)
check_true("un-onboarded earner is skipped, not transferred",
           res.get("transfer_id") is None and "Connect" in (res.get("skipped") or ""))

cur.execute("SELECT COUNT(*) FROM commissions WHERE earner_id = %s AND status='pending'", (coach_id,))
check("skipped earner's rows stay pending", cur.fetchone()[0], 1)


# ─────────────────────────────────────────────────────────────────────────────
db.rollback()
cur.execute("SELECT COUNT(*) FROM users WHERE email LIKE '%%@test.invalid'")
leaked = cur.fetchone()[0]
db.rollback()
db.close()

print(f"\n{'='*60}")
print(f"  {len(PASS)} passed, {len(FAIL)} failed")
if leaked:
    print(f"  WARNING: {leaked} test users survived — expected 0")
print(f"{'='*60}")
sys.exit(1 if FAIL else 0)
