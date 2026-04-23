"""
stripe_routes.py
Handles Stripe webhooks and Connect onboarding
"""

from flask import Blueprint, request, jsonify
import stripe
import os
import psycopg2
import uuid
from services.commission_engine import (
    calculate_commissions,
    save_commissions,
    pay_commission
)
from email_helper import send_subscription_email, notify_new_subscription, notify_admin_new_signup

stripe_bp = Blueprint("stripe", __name__)
stripe.api_key = os.environ.get("STRIPE_SECRET_KEY")
WEBHOOK_SECRET = os.environ.get("STRIPE_WEBHOOK_SECRET")

# Stripe Price IDs - set these after creating products in Stripe
PRICE_IDS = {
    "basic":   os.environ.get("STRIPE_PRICE_BASIC"),    # $20/mo
    "coached": os.environ.get("STRIPE_PRICE_COACHED"),  # $200/mo
    "elite":   os.environ.get("STRIPE_PRICE_ELITE"),    # $400/mo
}

TIER_AMOUNTS = {
    "basic":   2000,
    "coached": 20000,
    "elite":   40000,
}


def get_db():
    return psycopg2.connect(os.environ.get("DATABASE_URL"))


# ============================================
# STRIPE CONNECT - Coach Onboarding
# ============================================

@stripe_bp.route("/connect/onboard", methods=["POST"])
def create_connect_account():
    """Create a Stripe Express account for a coach."""
    import jwt as pyjwt

    # Get user from JWT token
    auth = request.headers.get("Authorization", "")
    data = request.json or {}
    user_id = data.get("user_id")
    email = data.get("email")

    # Try to get from JWT if not in body
    if not user_id and auth.startswith("Bearer "):
        try:
            payload = pyjwt.decode(auth[7:], os.environ.get("SECRET_KEY"), algorithms=["HS256"])
            user_id = payload.get("user_id")
        except:
            pass

    if not user_id:
        return jsonify({"error": "Authentication required"}), 401

    db = get_db()
    try:
        # Get email from DB if not provided
        if not email:
            with db.cursor() as cur:
                cur.execute("SELECT email FROM users WHERE id = %s", (user_id,))
                row = cur.fetchone()
                email = row[0] if row else None

        if not email:
            return jsonify({"error": "User not found"}), 404

        # Check if already has a Stripe account
        with db.cursor() as cur:
            cur.execute("SELECT stripe_account_id FROM users WHERE id = %s", (user_id,))
            existing = cur.fetchone()
            stripe_acct_id = existing[0] if existing else None

        if not stripe_acct_id:
            # Create new Express account
            account = stripe.Account.create(
                type="express",
                email=email,
                capabilities={
                    "transfers": {"requested": True}
                }
            )
            stripe_acct_id = account.id

            # Save account ID
            with db.cursor() as cur:
                cur.execute("UPDATE users SET stripe_account_id = %s WHERE id = %s", (stripe_acct_id, user_id))
                db.commit()

        # Generate onboarding link
        link = stripe.AccountLink.create(
            account=stripe_acct_id,
            refresh_url=f"{os.environ.get('APP_URL', 'https://app.bestrongagain.com')}/dashboard",
            return_url=f"{os.environ.get('APP_URL', 'https://app.bestrongagain.com')}/dashboard",
            type="account_onboarding"
        )

        return jsonify({"onboarding_url": link.url})

    except stripe.error.StripeError as e:
        return jsonify({"error": str(e)}), 400
    finally:
        db.close()


@stripe_bp.route("/connect/status/<user_id>", methods=["GET"])
def check_connect_status(user_id):
    """Check if a coach has completed Stripe onboarding."""
    db = get_db()
    try:
        with db.cursor() as cur:
            cur.execute("""
                SELECT stripe_account_id FROM users WHERE id = %s
            """, (user_id,))
            row = cur.fetchone()

        if not row or not row[0]:
            return jsonify({"onboarded": False})

        account = stripe.Account.retrieve(row[0])
        onboarded = account.details_submitted

        # Update DB
        with db.cursor() as cur:
            cur.execute("""
                UPDATE users SET stripe_onboarded = %s WHERE id = %s
            """, (onboarded, user_id))
            db.commit()

        return jsonify({"onboarded": onboarded})

    finally:
        db.close()


# ============================================
# CHECKOUT - Member Subscribing
# ============================================

@stripe_bp.route("/checkout", methods=["POST"])
def create_checkout():
    """Create a Stripe checkout session for a member subscribing."""
    import jwt as pyjwt

    data = request.json or {}
    tier = data.get("tier", "basic")
    user_id = data.get("user_id")
    coach_id = data.get("coach_id")

    # Get user_id from JWT if not in body
    auth = request.headers.get("Authorization", "")
    if not user_id and auth.startswith("Bearer "):
        try:
            payload = pyjwt.decode(auth[7:], os.environ.get("SECRET_KEY"), algorithms=["HS256"])
            user_id = payload.get("user_id")
        except:
            pass

    if not user_id:
        return jsonify({"error": "Authentication required"}), 401

    if tier not in PRICE_IDS:
        return jsonify({"error": "Invalid tier"}), 400

    # If no coach_id, check who referred this user
    db = get_db()
    if not coach_id:
        try:
            with db.cursor() as cur:
                cur.execute("SELECT referred_by_id FROM users WHERE id = %s", (user_id,))
                row = cur.fetchone()
                if row and row[0]:
                    coach_id = str(row[0])
        except:
            pass
    db.close()

    app_url = os.environ.get('APP_URL', 'https://app.bestrongagain.com')

    session = stripe.checkout.Session.create(
        payment_method_types=["card"],
        mode="subscription",
        line_items=[{
            "price": PRICE_IDS[tier],
            "quantity": 1
        }],
        success_url=f"{app_url}/dashboard?subscribed=true",
        cancel_url=f"{app_url}/dashboard",
        metadata={
            "user_id": user_id,
            "coach_id": coach_id or "",
            "tier": tier
        }
    )

    return jsonify({"checkout_url": session.url})


# ============================================
# WEBHOOK - Handle Stripe Events
# ============================================

@stripe_bp.route("/webhook", methods=["POST"])
def stripe_webhook():
    payload = request.data
    sig_header = request.headers.get("Stripe-Signature")

    try:
        event = stripe.Webhook.construct_event(
            payload, sig_header, WEBHOOK_SECRET
        )
    except (ValueError, stripe.error.SignatureVerificationError):
        return jsonify({"error": "Invalid signature"}), 400

    db = get_db()
    try:
        if event["type"] == "checkout.session.completed":
            handle_checkout_completed(event["data"]["object"], db)

        elif event["type"] == "invoice.payment_succeeded":
            handle_invoice_paid(event["data"]["object"], db)

        elif event["type"] == "customer.subscription.deleted":
            handle_subscription_cancelled(event["data"]["object"], db)

    finally:
        db.close()

    return jsonify({"received": True})


def handle_checkout_completed(session, db):
    """New subscriber - create subscription record, trigger commissions."""
    user_id = session["metadata"]["user_id"]
    coach_id = session["metadata"].get("coach_id") or None
    tier = session["metadata"]["tier"]
    stripe_sub_id = session["subscription"]

    # Retrieve the subscription to get price info
    stripe_sub = stripe.Subscription.retrieve(stripe_sub_id)

    subscription_id = str(uuid.uuid4())
    amount_cents = TIER_AMOUNTS[tier]

    with db.cursor() as cur:
        cur.execute("""
            INSERT INTO subscriptions (
                id, user_id, coach_id, tier, status,
                stripe_subscription_id, stripe_price_id, amount_cents,
                current_period_start, current_period_end
            ) VALUES (%s, %s, %s, %s, 'active', %s, %s, %s, NOW(), NOW() + INTERVAL '1 month')
        """, (
            subscription_id, user_id, coach_id, tier,
            stripe_sub_id, PRICE_IDS[tier], amount_cents
        ))
        db.commit()

    # Send subscription confirmation email to the user
    try:
        with db.cursor() as cur:
            cur.execute("SELECT email, first_name FROM users WHERE id = %s", (user_id,))
            user_row = cur.fetchone()
        if user_row:
            send_subscription_email(user_row[0], user_row[1], tier)
    except:
        pass

    # Calculate and save commissions if there's a coach
    if coach_id:
        commissions = calculate_commissions(
            subscription_id, user_id, coach_id, amount_cents, db
        )
        save_commissions(commissions, db)

        # Pay out immediately for transaction-based commissions
        for c in commissions:
            if c["commission_amount_cents"] > 0:
                pay_commission(c["id"], db)

        # Notify the coach they have a new client
        try:
            with db.cursor() as cur:
                cur.execute("SELECT email, first_name FROM users WHERE id = %s", (coach_id,))
                coach_row = cur.fetchone()
                cur.execute("SELECT first_name, last_name, email FROM users WHERE id = %s", (user_id,))
                client_row = cur.fetchone()
            if coach_row and client_row:
                notify_new_subscription(
                    coach_row[0], coach_row[1],
                    f"{client_row[0]} {client_row[1]}", client_row[2], tier
                )
        except:
            pass


def handle_invoice_paid(invoice, db):
    """Recurring payment - fire commissions again each billing cycle."""
    stripe_sub_id = invoice.get("subscription")
    if not stripe_sub_id:
        return

    with db.cursor() as cur:
        cur.execute("""
            SELECT id, user_id, coach_id, tier, amount_cents
            FROM subscriptions
            WHERE stripe_subscription_id = %s
        """, (stripe_sub_id,))
        row = cur.fetchone()

    if not row:
        return

    sub_id, user_id, coach_id, tier, amount_cents = row

    if coach_id:
        commissions = calculate_commissions(
            sub_id, user_id, coach_id, amount_cents, db
        )
        save_commissions(commissions, db)
        for c in commissions:
            if c["commission_amount_cents"] > 0:
                pay_commission(c["id"], db)


def handle_subscription_cancelled(subscription, db):
    """Mark subscription cancelled in our DB."""
    with db.cursor() as cur:
        cur.execute("""
            UPDATE subscriptions
            SET status = 'cancelled', cancelled_at = NOW()
            WHERE stripe_subscription_id = %s
        """, (subscription["id"],))
        db.commit()
