"""One-shot diagnostic: did finn fox actually pay + sign up + get the email?

Runs on EC2 against /opt/bestrongagain/.env. Read-only.

  cd /opt/bestrongagain && venv/bin/python check_finn.py
"""
import os
import sys
from dotenv import load_dotenv

# Explicit path: this script is intended to be run from /opt/bestrongagain on EC2.
load_dotenv("/opt/bestrongagain/.env")

import psycopg2
import stripe

stripe.api_key = os.environ["STRIPE_SECRET_KEY"]

DSN = os.environ["DATABASE_URL"]
conn = psycopg2.connect(DSN)
conn.set_session(readonly=True)
cur = conn.cursor()


def section(title):
    print("\n" + "=" * 60)
    print(title)
    print("=" * 60)


# --- USERS ---
section("USERS table — match on first/last name LIKE finn/fox")
cur.execute(
    """
    SELECT id, email, first_name, last_name, role,
           stripe_customer_id, active_kiosk_program_id,
           referred_by_id, created_at
    FROM users
    WHERE LOWER(first_name) LIKE %s OR LOWER(last_name) LIKE %s
       OR LOWER(email) LIKE %s
    ORDER BY created_at DESC
    """,
    ("%finn%", "%fox%", "%finn%"),
)
users = cur.fetchall()
if not users:
    print("(no rows)")
else:
    cols = [d[0] for d in cur.description]
    for row in users:
        print(dict(zip(cols, row)))

finn_user_id = users[0][0] if users else None
finn_email   = users[0][1] if users else None
finn_cus_id  = users[0][5] if users else None
finn_program = users[0][6] if users else None

# --- SUBSCRIPTIONS ---
section("SUBSCRIPTIONS for that user")
if finn_user_id:
    cur.execute(
        """
        SELECT * FROM subscriptions WHERE user_id = %s ORDER BY created_at DESC
        """,
        (finn_user_id,),
    )
    subs = cur.fetchall()
    if not subs:
        print("(no subscriptions row in DB — webhook may not have fired)")
    else:
        cols = [d[0] for d in cur.description]
        for row in subs:
            print(dict(zip(cols, row)))
else:
    print("(skipped — no finn user)")

# --- STRIPE: look up by email AND by customer id ---
section("STRIPE customers — search by email")
if finn_email:
    try:
        customers = stripe.Customer.search(query=f"email:'{finn_email}'")
        for c in customers.data:
            print(f"  cus_id={c.id}  email={c.email}  name={c.name}  created={c.created}")
            # subscriptions on this customer
            subs = stripe.Subscription.list(customer=c.id, limit=5)
            for s in subs.data:
                price_id = s["items"]["data"][0]["price"]["id"] if s["items"]["data"] else None
                amount   = s["items"]["data"][0]["price"]["unit_amount"] if s["items"]["data"] else None
                print(f"    sub={s.id}  status={s.status}  price_id={price_id}  amount=${(amount or 0)/100}")
    except Exception as e:
        print(f"  Stripe search error: {e}")
else:
    print("(skipped — no finn email)")

# --- STRIPE checkout sessions ---
section("STRIPE checkout sessions in the last ~30 days mentioning finn")
try:
    sessions = stripe.checkout.Session.list(limit=100)
    matches = []
    for sess in sessions.data:
        cd = sess.customer_details
        email = cd.email if cd else None
        name  = cd.name  if cd else None
        if (email and "finn" in (email or "").lower()) or (name and "finn" in (name or "").lower()):
            matches.append(sess)
    if matches:
        for sess in matches:
            print(f"  session={sess.id}  status={sess.status}  payment_status={sess.payment_status}")
            print(f"    customer_email={sess.customer_details.email if sess.customer_details else '?'}")
            print(f"    amount_total=${(sess.amount_total or 0)/100}")
            print(f"    metadata={sess.metadata}")
    else:
        print("(no recent checkout session with 'finn' in customer details)")
except Exception as e:
    print(f"  Stripe checkout.list error: {type(e).__name__}: {e}")

section("STRIPE payment intents mentioning finn (one-time fallback)")
try:
    pis = stripe.PaymentIntent.list(limit=100)
    matches = []
    for pi in pis.data:
        if pi.receipt_email and "finn" in pi.receipt_email.lower():
            matches.append(pi)
    if matches:
        for pi in matches:
            print(f"  pi={pi.id}  status={pi.status}  amount=${(pi.amount or 0)/100}  email={pi.receipt_email}")
    else:
        print("(no recent payment intent with 'finn' email)")
except Exception as e:
    print(f"  PaymentIntent.list error: {type(e).__name__}: {e}")

# --- EMAIL audit ---
# email_helper.py uses Gmail SMTP and (per the code) likely doesn't log to DB.
# Check if there's an email_log table anyway.
section("EMAIL audit — looking for email_log / email_audit table")
cur.execute(
    """
    SELECT table_name FROM information_schema.tables
    WHERE table_schema = 'public' AND (table_name ILIKE 'email%' OR table_name ILIKE '%email_log%')
    """
)
tables = cur.fetchall()
if tables:
    for (t,) in tables:
        print(f"  found: {t}")
        cur.execute(f"SELECT * FROM {t} WHERE LOWER(to_email) LIKE %s ORDER BY id DESC LIMIT 5", ("%finn%",))
        for row in cur.fetchall():
            print(f"    {row}")
else:
    print("(no email log table — emails are fire-and-forget via Gmail SMTP, not audited in DB)")

# --- Who referred Finn? ---
section("Who referred Finn?")
if finn_user_id:
    cur.execute(
        "SELECT id, email, first_name, last_name, role FROM users WHERE id = (SELECT referred_by_id FROM users WHERE id = %s)",
        (finn_user_id,),
    )
    r = cur.fetchone()
    print(dict(zip([d[0] for d in cur.description], r)) if r else "(no referrer found)")

# --- Workout activity for Finn ---
section("workout_user_position + workout_logs for Finn")
if finn_user_id:
    for tbl in ("workout_user_position", "workout_logs"):
        try:
            cur.execute(f"SELECT * FROM {tbl} WHERE user_id = %s ORDER BY 1 DESC LIMIT 5", (finn_user_id,))
            rows = cur.fetchall()
            print(f"  {tbl}: {len(rows)} row(s)")
            for row in rows:
                print(f"    {row}")
        except Exception as e:
            print(f"  {tbl} query error: {e}")

print("\nDone.")
cur.close()
conn.close()
