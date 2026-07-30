"""
test_webhook_ordering.py
========================
Regression test for the bug Michael Glatkowski's signup exposed on
2026-07-30: a real subscription with ZERO commission rows.

Stripe fires BOTH checkout.session.completed and invoice.payment_succeeded
for a new subscription and guarantees no ordering between them. In this
account the invoice event consistently arrives FIRST — before the
subscriptions row exists — so handle_invoice_paid bails on `if not row`.
Commissioning only from the invoice handler therefore commissioned nothing.

The rule this file defends:

    EITHER webhook can commission a period, and whichever arrives SECOND
    must be a no-op. Never zero rows, never two.

Runs inside a transaction that is always rolled back. Safe against production.

    /opt/bestrongagain/venv/bin/python test_webhook_ordering.py
"""

import os
import sys
import uuid

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from commission_engine import get_db  # noqa: E402
from stripe_routes import commission_payment, _already_commissioned  # noqa: E402

PASS, FAIL = [], []


def check(name, got, want):
    if got == want:
        PASS.append(name); print(f"  PASS  {name}")
    else:
        FAIL.append(name); print(f"  FAIL  {name}\n          got  {got!r}\n          want {want!r}")


class NoCommit:
    """commission_payment -> save_commissions commits; suppress it so the
    transaction can be rolled back and production is never written to."""

    def __init__(self, conn):
        self._conn = conn

    def commit(self):
        pass

    def __getattr__(self, name):
        return getattr(self._conn, name)


_real = get_db()
cur = _real.cursor()
db = NoCommit(_real)


def mkuser(role, referrer=None):
    uid = str(uuid.uuid4())
    cur.execute("""
        INSERT INTO users (id, email, first_name, last_name, password_hash,
                           role, referral_code, referred_by_id, is_active)
        VALUES (%s,%s,'T','User','x',%s,%s,%s,TRUE)
    """, (uid, f"wh-{uid[:8]}@test.invalid", role, f"WH{uid[:6].upper()}", referrer))
    return uid


def mksub(client_id, coach_id, cents=599):
    sid = str(uuid.uuid4())
    cur.execute("""
        INSERT INTO subscriptions (id, user_id, coach_id, tier, status,
            stripe_subscription_id, stripe_price_id, amount_cents,
            current_period_start, current_period_end)
        VALUES (%s,%s,%s,'tracker','active',%s,'price_x',%s,NOW(),NOW()+INTERVAL '1 month')
    """, (sid, client_id, coach_id, f"sub_{sid[:10]}", cents))
    return sid


def rows_for(sub_id):
    cur.execute("SELECT COUNT(*) FROM commissions WHERE subscription_id = %s", (sub_id,))
    return cur.fetchone()[0]


coach = mkuser("coach")
client = mkuser("member")

print("\n[A] invoice.paid arrives FIRST (the real-world ordering)")
sub_a = mksub(client, coach)
# The invoice handler fires before the subscriptions row exists and bails —
# that's the `if not row: return` path, so nothing is commissioned yet.
check("nothing commissioned while the row is missing", rows_for(sub_a), 0)
# Then checkout lands, inserts the row, and commissions it.
made = commission_payment(sub_a, client, coach, 599, db, "checkout.completed")
check("checkout commissions it", made, True)
check("exactly the coach + recruiter rows exist", rows_for(sub_a) > 0, True)
before = rows_for(sub_a)
# A retried/duplicate invoice webhook must not add more.
again = commission_payment(sub_a, client, coach, 599, db, "invoice.paid")
check("late invoice webhook is a no-op", again, False)
check("row count unchanged after the second webhook", rows_for(sub_a), before)

print("\n[B] checkout arrives FIRST")
sub_b = mksub(client, coach)
check("checkout commissions it", commission_payment(sub_b, client, coach, 599, db, "checkout.completed"), True)
n_b = rows_for(sub_b)
check("invoice webhook afterwards is a no-op", commission_payment(sub_b, client, coach, 599, db, "invoice.paid"), False)
check("no double-commission", rows_for(sub_b), n_b)

print("\n[C] The guard itself")
sub_c = mksub(client, coach)
check("fresh subscription is not yet commissioned", _already_commissioned(db, sub_c), False)
commission_payment(sub_c, client, coach, 599, db, "checkout.completed")
check("after commissioning, the guard trips", _already_commissioned(db, sub_c), True)

print("\n[D] Nothing is commissioned without a coach or an amount")
sub_d = mksub(client, coach)
check("no coach -> no commission", commission_payment(sub_d, client, None, 599, db, "x"), False)
check("zero amount -> no commission", commission_payment(sub_d, client, coach, 0, db, "x"), False)
check("negative amount -> no commission", commission_payment(sub_d, client, coach, -100, db, "x"), False)
check("still no rows", rows_for(sub_d), 0)

_real.rollback()
cur.execute("SELECT COUNT(*) FROM users WHERE email LIKE '%%@test.invalid'")
leaked = cur.fetchone()[0]
_real.rollback()
_real.close()

print("\n" + "=" * 60)
print(f"  {len(PASS)} passed, {len(FAIL)} failed   |   leaked rows: {leaked}")
print("=" * 60)
sys.exit(1 if (FAIL or leaked) else 0)
