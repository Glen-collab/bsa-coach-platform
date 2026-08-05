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
    "tracker": os.environ.get("STRIPE_PRICE_TRACKER"),  # $5.99/mo — tracker only, no coaching
    "basic":   os.environ.get("STRIPE_PRICE_BASIC"),    # $20/mo
    "coached": os.environ.get("STRIPE_PRICE_COACHED"),  # $200/mo
    "elite":   os.environ.get("STRIPE_PRICE_ELITE"),    # $400/mo
}

TIER_AMOUNTS = {
    "tracker": 599,
    "basic":   2000,
    "coached": 20000,
    "elite":   40000,
}


def resolve_subscription_price(stripe_sub, tier):
    """
    What Stripe ACTUALLY billed, not what our table says it should have been.

    This number drives commission payouts, so a wrong value silently pays
    coaches off a fiction. Reading it from Stripe means:
      - a price edited in the Stripe dashboard can't desync from TIER_AMOUNTS
      - per-coach custom prices work without a hardcoded tier entry

    Falls back to the tier table if Stripe's shape is ever unexpected, so
    this is never worse than the previous hardcoded behaviour.

    Returns (amount_cents, stripe_price_id).
    """
    try:
        item = stripe_sub["items"]["data"][0]
        price = item["price"]
        amount = price["unit_amount"]
        # A metered/tiered price can carry unit_amount = None. Only trust a
        # real positive integer; anything else falls through to the table.
        if isinstance(amount, int) and amount > 0:
            return amount, price["id"]
    except (KeyError, IndexError, TypeError):
        pass

    return TIER_AMOUNTS.get(tier), PRICE_IDS.get(tier)


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

    # silent=True tolerates empty/missing body and guarantees we return JSON,
    # not HTML (Safari renders HTML errors as "The string did not match the
    # expected pattern" via res.json() — prevent leaking those).
    data = request.get_json(silent=True) or {}
    tier = data.get("tier", "basic")
    user_id = data.get("user_id")
    coach_id = data.get("coach_id")

    # Get user_id from JWT if not in body
    auth = request.headers.get("Authorization", "")
    if not user_id and auth.startswith("Bearer "):
        try:
            payload = pyjwt.decode(auth[7:], os.environ.get("SECRET_KEY"), algorithms=["HS256"])
            user_id = payload.get("user_id")
        except Exception:
            pass

    if not user_id:
        return jsonify({"error": "Authentication required"}), 401

    if tier not in PRICE_IDS:
        return jsonify({"error": "Invalid tier"}), 400
    if not PRICE_IDS[tier]:
        return jsonify({"error": f"{tier} price not configured on server (STRIPE_PRICE_{tier.upper()} missing)"}), 500

    # Look up the referring coach (for commissions) and the member's existing
    # Stripe customer id (so a tier change reuses the same customer instead of
    # spawning a duplicate — and so the downgrade cleanup can find their old sub).
    db = get_db()
    stripe_customer_id = None
    user_email = None
    try:
        with db.cursor() as cur:
            cur.execute("SELECT referred_by_id, stripe_customer_id, email FROM users WHERE id = %s", (user_id,))
            row = cur.fetchone()
            if row:
                if not coach_id and row[0]:
                    coach_id = str(row[0])
                stripe_customer_id = row[1]
                user_email = row[2]
    except Exception:
        pass
    db.close()

    app_url = os.environ.get('APP_URL', 'https://app.bestrongagain.com')

    try:
        session_kwargs = dict(
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
        # Reuse the existing customer on a repeat/downgrade purchase.
        if stripe_customer_id:
            session_kwargs["customer"] = stripe_customer_id
        elif user_email:
            # Pre-fill the email so a first-time subscriber lands on the card
            # fields instead of an email prompt. One less screen between them
            # and paying — the checkout drop-off we actually observed was
            # someone stalling on the pre-card screens, not on the card itself.
            # Mutually exclusive with `customer`: Stripe rejects both together.
            session_kwargs["customer_email"] = user_email
        session = stripe.checkout.Session.create(**session_kwargs)
    except stripe.error.StripeError as e:
        return jsonify({"error": f"Stripe: {str(e)}"}), 400

    return jsonify({"checkout_url": session.url})


# ============================================
# BILLING PORTAL - Self-serve cancel / payment method / invoices
# ============================================

@stripe_bp.route("/billing-portal", methods=["POST"])
def billing_portal():
    """Create a Stripe-hosted billing portal session for the authenticated
    user. The portal lets them cancel their subscription, update their card,
    and download invoices — without us building UI. Cancellation events flow
    back through the existing /webhook handler.
    """
    import jwt as pyjwt

    auth = request.headers.get("Authorization", "")
    if not auth.startswith("Bearer "):
        return jsonify({"error": "Authentication required"}), 401
    try:
        payload = pyjwt.decode(auth[7:], os.environ.get("SECRET_KEY"), algorithms=["HS256"])
        user_id = payload.get("user_id")
    except Exception:
        return jsonify({"error": "Invalid token"}), 401
    if not user_id:
        return jsonify({"error": "Authentication required"}), 401

    db = get_db()
    try:
        with db.cursor() as cur:
            cur.execute("SELECT stripe_customer_id FROM users WHERE id = %s", (user_id,))
            row = cur.fetchone()
        stripe_customer_id = row[0] if row else None
        if not stripe_customer_id:
            return jsonify({
                "error": "no_subscription",
                "message": "You don't have an active subscription to manage yet."
            }), 400

        # Bounce back to the member dashboard once they're done in the portal.
        body = request.json or {}
        return_url = body.get("return_url") or "https://app.bestrongagain.com/dashboard"

        session = stripe.billing_portal.Session.create(
            customer=stripe_customer_id,
            return_url=return_url,
        )
        return jsonify({"url": session.url})
    except stripe.error.StripeError as e:
        return jsonify({"error": "stripe_error", "message": str(e)}), 500
    finally:
        db.close()


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


def _md(obj, key, default=None):
    """Safe field lookup on Stripe StripeObject (which doesn't support
    .get() and doesn't dict-cast cleanly). Returns default when missing."""
    try:
        if key in obj:
            return obj[key]
    except Exception:
        pass
    return default


def handle_checkout_completed(session, db):
    """New subscriber - create subscription record, trigger commissions."""
    metadata = session["metadata"] if "metadata" in session else None
    user_id = _md(metadata, "user_id") if metadata is not None else None
    coach_id = (_md(metadata, "coach_id") if metadata is not None else None) or None
    tier = _md(metadata, "tier") if metadata is not None else None
    stripe_sub_id = _md(session, "subscription")
    if not user_id or not tier or not stripe_sub_id:
        return

    # Retrieve the subscription to get price info
    stripe_sub = stripe.Subscription.retrieve(stripe_sub_id)

    subscription_id = str(uuid.uuid4())
    amount_cents, stripe_price_id = resolve_subscription_price(stripe_sub, tier)

    if not amount_cents:
        # Unknown tier AND unreadable Stripe price — recording a subscription
        # with a null amount would poison every commission calculated off it.
        # Bail loudly instead; the payment is already captured and can be
        # reconciled by hand.
        print(f"[stripe] ABORT checkout {stripe_sub_id}: no resolvable price "
              f"(tier={tier!r}). Subscription NOT recorded — reconcile manually.")
        return

    stripe_customer_id = _md(session, "customer")

    # Pick the default starter program for newly-paying members. Code
    # 7741 = "Beginner Adult" — bodyweight-friendly first program. We
    # assign it ONLY if the user doesn't already have an active program,
    # so coaches who manually assigned a custom program aren't disturbed.
    DEFAULT_PROGRAM_ACCESS_CODE = "7741"

    with db.cursor() as cur:
        cur.execute("""
            INSERT INTO subscriptions (
                id, user_id, coach_id, tier, status,
                stripe_subscription_id, stripe_price_id, amount_cents,
                current_period_start, current_period_end
            ) VALUES (%s, %s, %s, %s, 'active', %s, %s, %s, NOW(), NOW() + INTERVAL '1 month')
        """, (
            subscription_id, user_id, coach_id, tier,
            stripe_sub_id, stripe_price_id, amount_cents
        ))

        # Stamp Stripe customer ID on the user (lets us look up their
        # subscription from the customer side later — e.g. customer
        # portal links).
        if stripe_customer_id:
            cur.execute(
                "UPDATE users SET stripe_customer_id = %s WHERE id = %s AND stripe_customer_id IS NULL",
                (stripe_customer_id, user_id),
            )

        # Assign the starter program if the user doesn't already have one
        # (coaches may pre-assign a custom program before payment lands).
        cur.execute("""
            UPDATE users
               SET active_kiosk_program_id = (
                   SELECT id FROM workout_programs
                   WHERE access_code = %s AND is_active = TRUE
                   LIMIT 1
               )
             WHERE id = %s AND active_kiosk_program_id IS NULL
        """, (DEFAULT_PROGRAM_ACCESS_CODE, user_id))

        db.commit()

    # Tier change / downgrade cleanup. This checkout created a NEW subscription.
    # If the member already had a DIFFERENT active subscription (e.g. the $20
    # basic they're dropping from), cancel it in Stripe and mark it cancelled so
    # they end up with exactly one active sub — never billed for both. Runs
    # after the main commit so a Stripe hiccup can't roll back provisioning.
    try:
        with db.cursor() as cur:
            cur.execute("""
                SELECT id, stripe_subscription_id FROM subscriptions
                WHERE user_id = %s AND status = 'active'
                  AND stripe_subscription_id IS NOT NULL
                  AND stripe_subscription_id != %s
            """, (user_id, stripe_sub_id))
            old_subs = cur.fetchall()
            for old_id, old_stripe_id in old_subs:
                try:
                    stripe.Subscription.delete(old_stripe_id)
                except stripe.error.StripeError:
                    pass  # already cancelled/gone on Stripe's side — still mark it
                cur.execute(
                    "UPDATE subscriptions SET status = 'cancelled' WHERE id = %s",
                    (old_id,))
            db.commit()
    except Exception:
        pass

    # Send subscription confirmation email to the user. Pass the actual
    # assigned program's access code so the email matches what the
    # dashboard will load (was sending legacy STARTER_CODES["bodyweight"]
    # which didn't match the webhook's assignment).
    try:
        with db.cursor() as cur:
            cur.execute("""
                SELECT u.email, u.first_name, wp.access_code
                  FROM users u
                  LEFT JOIN workout_programs wp ON wp.id = u.active_kiosk_program_id
                 WHERE u.id = %s
            """, (user_id,))
            user_row = cur.fetchone()
        if user_row:
            send_subscription_email(user_row[0], user_row[1], tier, access_code=user_row[2])
    except:
        pass

    # Commission the first period here TOO, not instead of handle_invoice_paid.
    #
    # Both events fire for a new subscription with no ordering guarantee. In
    # practice invoice.payment_succeeded arrives FIRST, before this handler has
    # inserted the subscriptions row — so that handler finds no row and bails.
    # Commissioning only there meant a new signup was never commissioned at
    # all. (Caught by Michael Glatkowski's live signup, 2026-07-30: real
    # subscription, zero commission rows.)
    #
    # commission_payment() is idempotent per subscription per month, so
    # whichever webhook lands second is a no-op and nobody is paid twice.
    #
    # A trialing subscription has collected nothing yet — skip it and let the
    # first real invoice commission it.
    if coach_id and _md(stripe_sub, "status") != "trialing":
        commission_payment(subscription_id, user_id, coach_id, amount_cents,
                           db, "checkout.completed")

    if coach_id:
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


def _already_commissioned(db, subscription_id):
    """
    Has this subscription already been commissioned for the current period?

    checkout.session.completed and invoice.payment_succeeded both fire for a
    new subscription and Stripe guarantees no ordering, so BOTH have to be
    able to do the work and whichever runs second must be a no-op. Keying on
    the calendar month is right for monthly billing, which is all we sell.
    """
    with db.cursor() as cur:
        cur.execute("""
            SELECT 1 FROM commissions
            WHERE subscription_id = %s
              AND created_at >= date_trunc('month', NOW())
            LIMIT 1
        """, (subscription_id,))
        return cur.fetchone() is not None


def commission_payment(sub_id, user_id, coach_id, amount_cents, db, source):
    """Record commissions once for a paid period. Safe to call from either webhook."""
    if not coach_id or not amount_cents or amount_cents <= 0:
        return False
    if _already_commissioned(db, sub_id):
        print(f"[stripe] commissions for {sub_id} already exist this period "
              f"({source}) — skipping")
        return False
    commissions = calculate_commissions(sub_id, user_id, coach_id, amount_cents, db)
    save_commissions(commissions, db)
    print(f"[stripe] commissioned {amount_cents}c for {sub_id} via {source}")
    return True


def handle_invoice_paid(invoice, db):
    """Recurring payment - fire commissions again each billing cycle."""
    stripe_sub_id = _md(invoice, "subscription")
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

    # Commission the amount THIS invoice actually collected, not the figure
    # cached at signup. Proration, a coach's price change, a coupon, or a
    # partial refund all make the stored amount wrong for this cycle.
    invoiced = _md(invoice, "amount_paid")
    if isinstance(invoiced, int):
        if invoiced <= 0:
            # An explicit zero is a free-trial or fully-discounted cycle.
            # Nothing was collected, so there is nothing to commission —
            # and we must NOT fall through to the stored amount, which
            # would pay a coach out of money that never arrived.
            return
        amount_cents = invoiced

    if coach_id:
        # Not paid out here. Commissions accumulate as 'pending' and settle on
        # a monthly cycle, because the per-active-client minimum can only be
        # worked out once the month is known, and because a refund after a
        # Transfer has left leaves a negative balance to claw back.
        commission_payment(sub_id, user_id, coach_id, amount_cents, db, "invoice.paid")


def handle_subscription_cancelled(subscription, db):
    """Mark subscription cancelled in our DB."""
    with db.cursor() as cur:
        cur.execute("""
            UPDATE subscriptions
            SET status = 'cancelled', cancelled_at = NOW()
            WHERE stripe_subscription_id = %s
        """, (subscription["id"],))
        db.commit()
