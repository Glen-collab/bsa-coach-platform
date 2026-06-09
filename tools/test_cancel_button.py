"""End-to-end check: when a user has an active subscription, does
/api/auth/me return a tier that the MemberDashboard would use to render
the 'Manage Subscription / Cancel' button?

Procedure:
  1. Find glen+test@gmail.com.
  2. Snapshot their current subscription status.
  3. Flip it to 'active'.
  4. Mint a JWT and hit /api/auth/me.
  5. Print the tier + the frontend's render decision.
  6. Restore the original status no matter what.
"""

import os
import sys
from datetime import datetime, timedelta, timezone

from dotenv import load_dotenv

load_dotenv("/opt/bestrongagain/.env")

import jwt as pyjwt
import psycopg2
import requests

conn = psycopg2.connect(os.environ["DATABASE_URL"])
cur = conn.cursor()

cur.execute("SELECT id, email, role FROM users WHERE LOWER(email) = %s", ("glen+test@gmail.com",))
row = cur.fetchone()
if not row:
    print("test user glen+test@gmail.com not found; aborting")
    sys.exit(1)
user_id, email, role = row
print(f"test user: {email} role={role}")

cur.execute(
    "SELECT id, status, cancelled_at FROM subscriptions WHERE user_id = %s ORDER BY created_at DESC LIMIT 1",
    (user_id,),
)
sub = cur.fetchone()
if not sub:
    print("test user has no subscription row; aborting")
    sys.exit(1)
sub_id, original_status, original_cancelled_at = sub
print(f"sub current: status={original_status} cancelled_at={original_cancelled_at}")

try:
    cur.execute(
        "UPDATE subscriptions SET status = 'active', cancelled_at = NULL WHERE id = %s",
        (sub_id,),
    )
    conn.commit()
    print("flipped to active")

    token = pyjwt.encode(
        {
            "user_id": str(user_id),
            "role": role,
            "exp": datetime.now(timezone.utc) + timedelta(minutes=5),
        },
        os.environ["SECRET_KEY"],
        algorithm="HS256",
    )

    r = requests.get(
        "https://app.bestrongagain.com/api/auth/me",
        headers={"Authorization": f"Bearer {token}"},
        timeout=10,
    )
    print(f"/api/auth/me → {r.status_code}")
    data = r.json()
    tier = data.get("tier")
    status = data.get("subscription_status")
    print(f"  tier={tier!r}  subscription_status={status!r}")

    will_render = bool(tier and str(tier).lower() != "free")
    print(f"frontend decision: currentTier={tier!r} → cancel button shows: {will_render}")

finally:
    cur.execute(
        "UPDATE subscriptions SET status = %s, cancelled_at = %s WHERE id = %s",
        (original_status, original_cancelled_at, sub_id),
    )
    conn.commit()
    print("reverted sub to original state")

cur.close()
conn.close()
