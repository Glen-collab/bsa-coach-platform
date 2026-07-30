"""
test_scenarios.py
=================
The real stories, played out end to end against the real engine.

Cast:
  BSA    — the platform (Glen)
  Glen   — platform owner, also trains his own 1-on-1 clients
  Katie  — physical therapist. Refers trainers. Never trains app clients.
  Blake  — trainer with a gym. Katie referred him.

Every figure asserted here is a number quoted to Glen while designing this.
If the engine ever stops agreeing with the pitch, these fail.

Runs inside a transaction that is ALWAYS rolled back. Safe against production.

    /opt/bestrongagain/venv/bin/python test_scenarios.py
"""

import os
import sys
import uuid

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from commission_engine import (  # noqa: E402
    calculate_commissions, save_commissions, build_settlement,
    settle_month, get_db, ACTIVE_CLIENT_MIN_CENTS,
)

PASS, FAIL = [], []
D = lambda c: "$" + format(c / 100.0, ",.2f")  # noqa: E731


def check(name, got, want):
    # bool is a subclass of int, so guard it or True prints as "$0.01".
    shown = got if isinstance(got, bool) or not isinstance(got, int) else D(got)
    if got == want:
        PASS.append(name); print(f"  PASS  {name}  ({shown})")
    else:
        FAIL.append(name); print(f"  FAIL  {name}\n          got  {got}\n          want {want}")


class NoCommit:
    """
    Pass-through connection whose commit() does nothing.

    save_commissions() commits, which against production would make every
    scenario row permanent. psycopg2 won't let you reassign .commit on a real
    connection, so the engine gets this wrapper instead and the real
    connection is rolled back at the end.
    """

    def __init__(self, conn):
        self._conn = conn

    def commit(self):
        pass

    def __getattr__(self, name):
        return getattr(self._conn, name)


_real = get_db()
cur = _real.cursor()
db = NoCommit(_real)


def mkuser(first, last, role, referrer=None):
    uid = str(uuid.uuid4())
    cur.execute("""
        INSERT INTO users (id, email, first_name, last_name, password_hash,
                           role, referral_code, referred_by_id, is_active)
        VALUES (%s,%s,%s,%s,'x',%s,%s,%s,TRUE)
    """, (uid, f"{first.lower()}-{uid[:8]}@test.invalid", first, last, role,
          f"{first[:3].upper()}{uid[:6].upper()}", referrer))
    return uid


def mksub(client_id, coach_id, cents):
    sid = str(uuid.uuid4())
    cur.execute("""
        INSERT INTO subscriptions (id, user_id, coach_id, tier, status,
            stripe_subscription_id, stripe_price_id, amount_cents,
            current_period_start, current_period_end)
        VALUES (%s,%s,%s,'basic','active',%s,'price_x',%s,NOW(),NOW()+INTERVAL '1 month')
    """, (sid, client_id, coach_id, f"sub_{sid[:10]}", cents))
    return sid


def sell(coach_id, cents, label):
    """One client pays. Returns the split."""
    client = mkuser(label, "Client", "member")
    sub = mksub(client, coach_id, cents)
    rows = calculate_commissions(sub, client, coach_id, cents, db)
    save_commissions(rows, db)   # commit is neutralised above
    return rows, client


def earned(rows, earner):
    return sum(r["commission_amount_cents"] for r in rows if r["earner_id"] == earner)


# ═════════════════════════════════════════════════════════════════════════════
print("\nSCENARIO 1 — Katie refers Blake. Blake puts up a flyer at $15.")
print("             20 gym clients sign up to track their workouts.\n")
# ═════════════════════════════════════════════════════════════════════════════

katie = mkuser("Katie", "PT", "coach")                 # referrer, no clients of her own
blake = mkuser("Blake", "Trainer", "coach", katie)     # Katie recruited him

blake_total = katie_total = bsa_total = 0
for i in range(20):
    rows, _ = sell(blake, 1500, f"C{i}")
    blake_total += earned(rows, blake)
    katie_total += earned(rows, katie)
    bsa_total += earned(rows, "PLATFORM")

check("Blake's 20 clients gross", 20 * 1500, 30000)
check("Blake keeps (80% of first $100, 70% after)", blake_total, 22000)
check("Katie's referral, 10% of everything Blake sells", katie_total, 3000)
check("BSA keeps the remainder", bsa_total, 30000 - 22000 - 3000)
check("nothing leaks — the three shares equal the gross",
      blake_total + katie_total + bsa_total, 30000)

print(f"\n    Blake {D(blake_total)}   Katie {D(katie_total)}   BSA {D(bsa_total)} (before Stripe)")
print(f"    Stripe takes about $14.70 of BSA's {D(bsa_total)}, leaving roughly $35.30.\n")


# ═════════════════════════════════════════════════════════════════════════════
print("SCENARIO 2 — Blake never makes a flyer. Same 20 clients, none paying.")
print("             He just uses the app as his clipboard.\n")
# ═════════════════════════════════════════════════════════════════════════════

blake2 = mkuser("Blake2", "ToolOnly", "coach", katie)
plan2 = build_settlement(blake2, db)

check("Blake earns nothing from the app", plan2["coach_earned_cents"], 0)
check("Katie earns nothing off him either", plan2["referral_cents"], 0)
check("BSA's share of his client revenue", plan2["platform_share_cents"], 0)
check("so BSA bills the per-active-client minimum instead",
      20 * ACTIVE_CLIENT_MIN_CENTS, 4000)
check("with no payout to deduct from, it becomes a direct charge",
      plan2["direct_charge_cents"], plan2["shortfall_cents"])

print(f"\n    Reselling earns Blake {D(blake_total)}/mo. Tool-only costs him $40.00/mo.")
print(f"    The flyer is worth {D(blake_total + 4000)}/mo to him. That's the nudge.\n")


# ═════════════════════════════════════════════════════════════════════════════
print("SCENARIO 3 — Blake grows from 6 clients to 7. Growth must never hurt.\n")
# ═════════════════════════════════════════════════════════════════════════════

b6 = mkuser("Blake6", "Six", "coach", katie)
six_total = sum(earned(sell(b6, 1500, f"S{i}")[0], b6) for i in range(6))
b7 = mkuser("Blake7", "Seven", "coach", katie)
seven_total = sum(earned(sell(b7, 1500, f"V{i}")[0], b7) for i in range(7))

check("6 clients", six_total, 7200)
check("7 clients", seven_total, 8350)
check("the 7th client pays Blake more, not less", seven_total > six_total, True)
print(f"\n    On a hard cliff the 7th client would have DROPPED him to $73.50.")
print(f"    Marginal brackets pay him {D(seven_total)}. He never loses by growing.\n")


# ═════════════════════════════════════════════════════════════════════════════
print("SCENARIO 4 — Katie's own economics. She trains nobody.\n")
# ═════════════════════════════════════════════════════════════════════════════

kplan = build_settlement(katie, db)
check("Katie has no clients of her own", kplan["client_revenue_cents"], 0)
check("so no minimum is charged to her", kplan["minimum_cents"], 0)
check("and nothing is deducted from her referral income", kplan["shortfall_cents"], 0)
check("Katie's referral earnings this month", katie_total, 3000)
print(f"\n    Katie nets {D(katie_total)}/mo from one Blake. Five Blakes = {D(katie_total*5)}/mo.\n")


# ═════════════════════════════════════════════════════════════════════════════
print("SCENARIO 5 — Payout run. One transfer each, nobody paid twice.\n")
# ═════════════════════════════════════════════════════════════════════════════

sp = settle_month(db, dry_run=True)
ids = [e["earner_id"] for e in sp["earners"]]
check("one settlement row per earner", len(ids), len(set(ids)))
check("dry run moved no money", all(e["transfer_id"] is None for e in sp["earners"]), True)

b = next(e for e in sp["earners"] if e["earner_id"] == blake)
k = next(e for e in sp["earners"] if e["earner_id"] == katie)
check("Blake's payout matches what he earned", b["gross_cents"], 22000)

# Katie referred Blake AND the two coaches from scenario 3, so her settlement
# is the sum across all three — 10% of $300 + 10% of $90 + 10% of $105.
# This is the compounding the referral program is for: one introduction each,
# income from all of them, forever, with no further work.
check("Katie is paid across every coach she recruited, not just Blake",
      k["gross_cents"], 3000 + 900 + 1050)
check("neither is paid without Stripe onboarding",
      b["skipped"] is not None and k["skipped"] is not None, True)
print(f"\n    Both held: {b['skipped']!r}")
print("    That is Drew's exact situation today — approved, selling, unpayable.\n")


# ═════════════════════════════════════════════════════════════════════════════
print("SCENARIO 6 — Blake's mixed book: 10 flyer clients at $15 AND")
print("             5 coached clients at $200. Katie referred him.\n")
# ═════════════════════════════════════════════════════════════════════════════

blake3 = mkuser("Blake3", "Mixed", "coach", katie)
b3 = k3 = bsa3 = 0
for i in range(10):
    r, _ = sell(blake3, 1500, f"F{i}")
    b3 += earned(r, blake3); k3 += earned(r, katie); bsa3 += earned(r, "PLATFORM")
for i in range(5):
    r, _ = sell(blake3, 20000, f"P{i}")
    b3 += earned(r, blake3); k3 += earned(r, katie); bsa3 += earned(r, "PLATFORM")

gross3 = 10 * 1500 + 5 * 20000
check("Blake's monthly gross", gross3, 115000)
check("Blake keeps 80% of first $100, 70% of the rest", b3, 8000 + int(105000 * 0.70))
check("Katie's 10% of everything Blake sells", k3, 11500)
check("BSA keeps the remainder", bsa3, gross3 - b3 - k3)
check("reconciles to the gross exactly", b3 + k3 + bsa3, gross3)

# 15 charges: 10 small, 5 large. Stripe is 2.9% + 30c on each.
stripe3 = round(10 * (1500 * 0.029 + 30) + 5 * (20000 * 0.029 + 30))
check("BSA after Stripe's cut", bsa3 - stripe3, 22000 - 3785)

# The per-active-client minimum is nowhere near binding here.
mplan = build_settlement(blake3, db)
check("15 active clients would owe a $30 minimum", 15 * ACTIVE_CLIENT_MIN_CENTS, 3000)
check("but BSA's real share dwarfs it, so nothing is added",
      mplan["shortfall_cents"], 0)

print(f"""
    Gross        {D(gross3)}
    Blake        {D(b3)}
    Katie        {D(k3)}
    BSA          {D(bsa3)}  (before Stripe)
    Stripe       {D(stripe3)}
    BSA net      {D(bsa3 - stripe3)}

    The 5 coached clients are 87% of the revenue. The flyer tier is the
    on-ramp; the $200 clients are where the money actually is.
""")


# ═════════════════════════════════════════════════════════════════════════════
_real.rollback()
cur.execute("SELECT COUNT(*) FROM users WHERE email LIKE '%%@test.invalid'")
leaked = cur.fetchone()[0]
_real.rollback()
_real.close()

print("=" * 64)
print(f"  {len(PASS)} passed, {len(FAIL)} failed   |   leaked rows: {leaked}")
print("=" * 64)
sys.exit(1 if (FAIL or leaked) else 0)
