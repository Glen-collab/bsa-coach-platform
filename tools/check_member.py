"""Parameterized version of check_finn.py — cross-references a member
against users + subscriptions + Stripe.

  USER_QUERY=jayce  venv/bin/python check_member.py

The query is fuzzy-matched against email + first_name + last_name.
"""

import os
import sys
from dotenv import load_dotenv

load_dotenv("/opt/bestrongagain/.env")

import psycopg2
import stripe

stripe.api_key = os.environ["STRIPE_SECRET_KEY"]
q = os.environ.get("USER_QUERY", "").strip().lower()
if not q:
    print("Set USER_QUERY=<name-or-email-fragment>")
    sys.exit(1)
like = f"%{q}%"

conn = psycopg2.connect(os.environ["DATABASE_URL"])
conn.set_session(readonly=True)
cur = conn.cursor()


def section(title):
    print("\n" + "=" * 60)
    print(title)
    print("=" * 60)


section(f"USERS table — match on {q!r}")
cur.execute(
    """
    SELECT id, email, first_name, last_name, role,
           stripe_customer_id, active_kiosk_program_id,
           referred_by_id, created_at
    FROM users
    WHERE LOWER(first_name) LIKE %s
       OR LOWER(last_name)  LIKE %s
       OR LOWER(email)      LIKE %s
    ORDER BY created_at DESC
    """,
    (like, like, like),
)
users = cur.fetchall()
if not users:
    print("(no rows)")
    sys.exit(0)
cols = [d[0] for d in cur.description]
for row in users:
    print(dict(zip(cols, row)))

# Use first match for deep dive.
user_id = users[0][0]
email   = users[0][1]

section("SUBSCRIPTIONS for that user")
cur.execute(
    """
    SELECT tier, status, amount_cents, stripe_subscription_id,
           current_period_start, current_period_end, cancelled_at, created_at
    FROM subscriptions WHERE user_id = %s ORDER BY created_at DESC
    """,
    (user_id,),
)
subs = cur.fetchall()
if not subs:
    print("(no subscription rows — webhook never fired or never paid)")
else:
    cols = [d[0] for d in cur.description]
    for row in subs:
        print(dict(zip(cols, row)))

section("STRIPE customer.search by email")
try:
    customers = stripe.Customer.search(query=f"email:'{email}'")
    if not customers.data:
        print("(no stripe customer with that email)")
    for c in customers.data:
        print(f"  cus_id={c.id}  email={c.email}  name={c.name}  created={c.created}")
        s_list = stripe.Subscription.list(customer=c.id, limit=10)
        for s in s_list.data:
            items = s["items"]["data"]
            p = items[0]["price"] if items else {}
            amount = (p.get("unit_amount") or 0) / 100
            print(f"    sub={s.id}  status={s.status}  price_id={p.get('id')}  amount=${amount}/mo  current_period_end={s.current_period_end}")
except Exception as e:
    print(f"Stripe search error: {type(e).__name__}: {e}")

section("STRIPE checkout sessions with matching customer email")
try:
    sessions = stripe.checkout.Session.list(limit=100)
    matches = []
    for sess in sessions.data:
        cd = sess.customer_details
        e = cd.email if cd else None
        n = cd.name  if cd else None
        if (e and q in (e or "").lower()) or (n and q in (n or "").lower()):
            matches.append(sess)
    if not matches:
        print("(no matching checkout sessions)")
    for sess in matches:
        print(f"  session={sess.id}  status={sess.status}  payment_status={sess.payment_status}  amount=${(sess.amount_total or 0)/100}")
        print(f"    customer_email={sess.customer_details.email if sess.customer_details else '?'}")
        print(f"    metadata={dict(sess.metadata) if sess.metadata else {}}")
except Exception as e:
    print(f"checkout.list error: {type(e).__name__}: {e}")

cur.close()
conn.close()
