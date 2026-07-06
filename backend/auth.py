"""
auth.py - Registration, login, JWT auth, coach application
"""

from flask import Blueprint, request, jsonify
import psycopg2
import bcrypt
import jwt
import uuid
import random
import string
import os
from datetime import datetime, timedelta
from functools import wraps
from email_helper import notify_admin_new_signup, notify_admin_coach_application, send_welcome_email, send_email, TRAINER_EMAIL

auth_bp = Blueprint("auth", __name__)


def get_db():
    return psycopg2.connect(os.environ.get("DATABASE_URL"))


def generate_referral_code(first_name: str) -> str:
    suffix = ''.join(random.choices(string.ascii_uppercase + string.digits, k=5))
    return f"{first_name.upper()[:4]}{suffix}"


# "Tom from MySpace" — every BSA signup gets Glen as an auto-accepted
# friend so they can DM him via the in-app chat without going through
# the friend-request/accept flow. Source-of-truth identifier is the
# TRAINER_EMAIL constant from email_helper. No-ops if Glen's account
# doesn't exist yet (fresh env), the new user IS Glen (self-signup),
# or a friendship row already exists in any state.
def auto_friend_admin(cur, new_user_id):
    cur.execute("SELECT id FROM users WHERE LOWER(email) = LOWER(%s) LIMIT 1", (TRAINER_EMAIL,))
    row = cur.fetchone()
    if not row:
        return
    admin_id = row[0] if not isinstance(row, dict) else row["id"]
    if str(admin_id) == str(new_user_id):
        return
    cur.execute("""
        INSERT INTO user_friendships (requester_id, recipient_id, status, accepted_at)
        VALUES (%s, %s, 'accepted', NOW())
        ON CONFLICT (requester_id, recipient_id) DO NOTHING
    """, (admin_id, new_user_id))


# Messaging consent is auto-stamped on register so a new user can DM
# their auto-friend admin immediately instead of hitting the "Got it"
# disclosure screen first. The disclosure text ("A coach may read your
# chats to keep things safe — be kind, only message friends") still
# belongs in the user-facing ToS / welcome email so the legal posture
# is preserved; clicking Sign Up is the implicit acceptance.
def auto_accept_messaging_consent(cur, user_id):
    cur.execute(
        "UPDATE users SET messaging_consent_at = COALESCE(messaging_consent_at, NOW()) WHERE id = %s",
        (user_id,),
    )


def make_token(user_id: str, role: str, days: int = 30) -> str:
    return jwt.encode({
        "user_id": user_id,
        "role": role,
        "exp": datetime.utcnow() + timedelta(days=days)
    }, os.environ.get("SECRET_KEY"), algorithm="HS256")


def get_current_user():
    """Extract user from JWT token in Authorization header."""
    auth = request.headers.get("Authorization", "")
    if not auth.startswith("Bearer "):
        return None
    try:
        payload = jwt.decode(auth[7:], os.environ.get("SECRET_KEY"), algorithms=["HS256"])
        return payload
    except:
        return None


def require_auth(f):
    """Decorator to require valid JWT."""
    @wraps(f)
    def decorated(*args, **kwargs):
        user = get_current_user()
        if not user:
            return jsonify({"error": "Authentication required"}), 401
        request.current_user = user
        return f(*args, **kwargs)
    return decorated


@auth_bp.route("/register", methods=["POST"])
def register():
    data = request.json
    email = data.get("email", "").lower().strip()
    password = data.get("password")
    first_name = data.get("first_name", "")
    last_name = data.get("last_name", "")
    referral_code = data.get("referral_code", "").upper().strip()

    # Optional date of birth (YYYY-MM-DD). Validated lightly; bad/blank → NULL.
    dob = (data.get("dob") or "").strip() or None
    if dob:
        try:
            import datetime as _dt
            d = _dt.date.fromisoformat(dob)
            if d.year < 1900 or d > _dt.date.today():
                dob = None
        except ValueError:
            dob = None

    # Members only — coaches go through application process
    role = "member"

    if not email or not password:
        return jsonify({"error": "Email and password required"}), 400

    password_hash = bcrypt.hashpw(password.encode(), bcrypt.gensalt()).decode()
    user_id = str(uuid.uuid4())
    my_referral_code = generate_referral_code(first_name or email)

    db = get_db()
    try:
        with db.cursor() as cur:
            # Look up referrer (their coach)
            referred_by_id = None
            if referral_code:
                cur.execute("SELECT id FROM users WHERE referral_code = %s", (referral_code,))
                ref_row = cur.fetchone()
                if ref_row:
                    referred_by_id = ref_row[0]
            # No (or unknown) referral code → attribute the signup to the
            # platform OWNER so every client is credited to Glen until there are
            # real coaches to assign them to (Glen's call 2026-06-16). Without
            # this, orphan signups (Tanner, Amy, …) linked to nobody and never
            # showed on his dashboard.
            if not referred_by_id:
                cur.execute("SELECT id FROM users WHERE referral_code = %s", (OWNER_REFERRAL_CODE,))
                owner_row = cur.fetchone()
                if owner_row:
                    referred_by_id = owner_row[0]

            cur.execute("""
                INSERT INTO users (
                    id, email, password_hash, first_name, last_name,
                    role, referred_by_id, referral_code, dob
                ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)
            """, (
                user_id, email, password_hash, first_name, last_name,
                role, referred_by_id, my_referral_code, dob
            ))
            auto_friend_admin(cur, user_id)
            auto_accept_messaging_consent(cur, user_id)
            db.commit()

        # Notify Glen of new signup
        referred_by_name = None
        referred_by_email = None
        if referred_by_id:
            with db.cursor() as cur2:
                cur2.execute("SELECT first_name, last_name, email, role FROM users WHERE id = %s", (referred_by_id,))
                ref = cur2.fetchone()
                if ref:
                    referred_by_name = f"{ref[0]} {ref[1]}"
                    referred_by_email = ref[2]
        try:
            # Admin notification is deferred until /submit-goals so the
            # email arrives with the goals attached — Glen needs that
            # context to draft a personalized reply. If the user bails
            # between register and goal-submit, they still show up in
            # the admin dashboard.
            # Send welcome email to new user
            send_welcome_email(email, first_name)
            # If referred by a coach (not Glen), notify the coach too
            if referred_by_email and referred_by_email != TRAINER_EMAIL:
                send_email(
                    referred_by_email,
                    f"New Client Signup: {first_name} {last_name}",
                    f"""
                    <div style="font-family:-apple-system,sans-serif;max-width:600px;margin:0 auto;">
                        <div style="background:linear-gradient(135deg,#B37602,#8a5b00);padding:20px;text-align:center;border-radius:12px 12px 0 0;">
                            <h1 style="color:#fff;margin:0;font-size:20px;">You Have a New Client!</h1>
                        </div>
                        <div style="background:#fff;padding:24px;border:1px solid #e5e7eb;border-radius:0 0 12px 12px;">
                            <p style="font-size:16px;color:#333;margin-top:0;"><strong>{first_name} {last_name}</strong> just signed up using your referral link.</p>
                            <div style="background:#f8f9fa;border-radius:10px;padding:14px;margin:16px 0;">
                                <p style="margin:4px 0;font-size:14px;"><strong>Email:</strong> <a href="mailto:{email}" style="color:#B37602;">{email}</a></p>
                            </div>
                            <h3 style="font-size:15px;color:#1a1a2e;margin-bottom:8px;">What to do next:</h3>
                            <ol style="font-size:14px;color:#555;line-height:2;padding-left:20px;">
                                <li>Welcome them — send a quick intro email</li>
                                <li>Build their program in the <a href="https://workoutbuild.netlify.app" style="color:#B37602;">Workout Builder</a></li>
                                <li>Send them the access code so they can start training</li>
                            </ol>
                            <p style="font-size:14px;color:#888;margin-bottom:0;">
                                Log in to your <a href="https://app.bestrongagain.com/dashboard" style="color:#B37602;">coach dashboard</a> to manage your clients.
                            </p>
                        </div>
                    </div>
                    """,
                    reply_to=email
                )
        except:
            pass  # Don't fail registration if email fails

        token = make_token(user_id, role)
        return jsonify({
            "token": token,
            "user": {
                "id": user_id,
                "email": email,
                "first_name": first_name,
                "role": role,
                "referral_code": my_referral_code
            }
        })

    except psycopg2.IntegrityError:
        # Most common cause: someone already has an account at this email
        # (e.g. Bluehost-era imports clicking "Become a Member" from the
        # tracker). Return a structured signal so the frontend can route
        # them into the login flow instead of dead-ending on a red banner.
        return jsonify({
            "code": "account_exists",
            "error": "account_exists",
            "message": f"An account already exists for {email}. Log in to continue.",
            "email": email,
        }), 409
    finally:
        db.close()


# Goal chip → starter program access code. Auto-assigns the closest-matching
# program Glen has already built instead of always Beginner Adult, so a new
# member lands on something relevant to what they picked (the $5.99 "floor").
# First matching goal wins; anything unmatched falls back to Beginner Adult.
# Keep these keys EXACTLY in sync with GOAL_OPTIONS in src/pages/Register.jsx.
GOAL_PROGRAM_CODES = {
    "Get Jacked":              "8165",  # High Volume Ball Buster
    "Build Muscle":            "5503",  # 4 Week Strength
    "Focus on Form":           "7741",  # Beginner Adult
    "Aging Gracefully":        "7928",  # Body weight Mobility
    "Weight Loss":             "6073",  # Moderate Fitness
    "Hyrox / Competition":     "9310",  # hyrox
    "Martial Arts":            "5765",  # Warrior Strength (TKD Hybrid)
    "Coming Back from Injury": "6707",  # Back in Shape
}
STARTER_FALLBACK_CODE = "7741"  # Beginner Adult

# Platform owner (Glen). Orphan signups with no referral code default to him so
# every client is attributed until real coaches exist.
OWNER_REFERRAL_CODE = "GLENM7NUS"


@auth_bp.route("/submit-goals", methods=["POST"])
@require_auth
def submit_goals():
    """Saves the new member's goals, auto-assigns the Beginner Adult
    starter program (access code 7741) for free users so they can start
    training immediately, and fires the admin notification email — now
    with goals attached so Glen can draft a personalized reply on the spot.
    """
    me = request.current_user["user_id"]
    data = request.json or {}
    goals = data.get("goals") or []
    # Defensive: cap goal count + length so a hostile payload can't bloat the row
    if not isinstance(goals, list):
        return jsonify({"error": "goals must be an array"}), 400
    goals = [str(g).strip()[:80] for g in goals if str(g).strip()][:12]

    db = get_db()
    try:
        with db.cursor() as cur:
            # Detect first-time-set vs update — goals can change over time
            # (someone signs up wanting "Get Jacked" then six months later
            # is into Hyrox), so this endpoint serves both. The admin
            # notification email subject reflects which path fired.
            cur.execute("SELECT goals FROM users WHERE id = %s", (me,))
            prev_row = cur.fetchone()
            previous_goals = (prev_row[0] if prev_row else None) or []
            is_update = bool(previous_goals)
            # Save goals
            cur.execute("UPDATE users SET goals = %s WHERE id = %s", (goals, me))
            # Assign Beginner Adult (access_code 7741) as starter ONLY if no
            # program has been assigned yet — don't clobber a coach's pick or
            # a paid-tier webhook assignment.
            starter_program_name = None
            starter_access_code = None
            cur.execute("SELECT active_kiosk_program_id FROM users WHERE id = %s", (me,))
            row = cur.fetchone()
            current_prog = row[0] if row else None
            if not current_prog:
                # Pick the closest-matching starter from the goals (first match
                # wins); fall back to Beginner Adult for no match.
                matched_code = STARTER_FALLBACK_CODE
                for g in goals:
                    if g in GOAL_PROGRAM_CODES:
                        matched_code = GOAL_PROGRAM_CODES[g]
                        break
                cur.execute("SELECT id, program_name FROM workout_programs WHERE access_code = %s LIMIT 1", (matched_code,))
                p = cur.fetchone()
                if not p and matched_code != STARTER_FALLBACK_CODE:
                    # Matched code missing/inactive — don't leave them with no
                    # program; fall back to Beginner Adult.
                    matched_code = STARTER_FALLBACK_CODE
                    cur.execute("SELECT id, program_name FROM workout_programs WHERE access_code = %s LIMIT 1", (STARTER_FALLBACK_CODE,))
                    p = cur.fetchone()
                if p:
                    cur.execute("UPDATE users SET active_kiosk_program_id = %s WHERE id = %s", (p[0], me))
                    starter_program_name = p[1]
                    starter_access_code = matched_code
            # Pull the fields needed for the admin notification email
            cur.execute("""
                SELECT u.first_name, u.last_name, u.email, u.referral_code,
                       ref.first_name, ref.last_name, u.dob
                FROM users u
                LEFT JOIN users ref ON ref.id = u.referred_by_id
                WHERE u.id = %s
            """, (me,))
            r = cur.fetchone()
            db.commit()

        if r:
            referred_by = f"{r[4]} {r[5]}" if (r[4] or r[5]) else None
            try:
                notify_admin_new_signup(
                    first_name=r[0], last_name=r[1], email=r[2],
                    referral_code=r[3], referred_by=referred_by,
                    goals=goals, starter_program=starter_program_name,
                    is_update=is_update, previous_goals=previous_goals,
                    dob=r[6],
                )
            except Exception:
                pass  # Don't fail goal-submission if the admin email is flaky

        return jsonify({
            "ok": True,
            "goals": goals,
            "starter_program": starter_program_name,
            "starter_access_code": starter_access_code,
        })
    finally:
        db.close()


@auth_bp.route("/me", methods=["GET"])
@require_auth
def me():
    """Fresh user state — tier from latest active subscription + the
    starter program's access_code if one is assigned. The dashboard
    calls this on mount instead of trusting the stale localStorage
    snapshot from login (tier flips post-payment, login is pre-payment)."""
    user_id = request.current_user["user_id"]
    db = get_db()
    try:
        with db.cursor() as cur:
            cur.execute("""
                SELECT u.id, u.email, u.first_name, u.last_name, u.role, u.referral_code,
                       u.stripe_customer_id, u.active_kiosk_program_id,
                       wp.access_code AS program_access_code,
                       wp.program_name AS program_name,
                       s.tier AS sub_tier,
                       s.status AS sub_status,
                       u.goals,
                       u.created_at,
                       (SELECT COUNT(*) FROM workout_logs wl WHERE LOWER(wl.user_email) = LOWER(u.email)) AS workout_count
                FROM users u
                LEFT JOIN workout_programs wp ON wp.id = u.active_kiosk_program_id
                LEFT JOIN LATERAL (
                    SELECT tier, status FROM subscriptions
                    WHERE user_id = u.id AND status IN ('active','trialing','past_due')
                    ORDER BY current_period_start DESC LIMIT 1
                ) s ON TRUE
                WHERE u.id = %s
            """, (user_id,))
            row = cur.fetchone()
            if not row:
                return jsonify({"error": "Not found"}), 404
            return jsonify({
                "id":              str(row[0]),
                "email":           row[1],
                "first_name":      row[2],
                "last_name":       row[3],
                "role":            row[4],
                "referral_code":   row[5],
                "stripe_customer": row[6],
                "active_program_id":   str(row[7]) if row[7] else None,
                "active_access_code":  row[8],
                "active_program_name": row[9],
                "tier":          row[10],
                "subscription_status": row[11],
                "goals":         row[12] or [],
                "created_at":    row[13].isoformat() if row[13] else None,
                "workout_count": row[14] or 0,
            })
    finally:
        db.close()


@auth_bp.route("/login", methods=["POST"])
def login():
    data = request.json
    email = data.get("email", "").lower().strip()
    password = data.get("password", "")
    # "Remember me" → year-long token so coaches/admins on their own device
    # aren't logged out every 30 days. Unchecked keeps the shorter 30-day window.
    remember = bool(data.get("remember"))

    db = get_db()
    try:
        with db.cursor() as cur:
            cur.execute("""
                SELECT id, password_hash, role, first_name, referral_code
                FROM users WHERE email = %s AND is_active = TRUE
            """, (email,))
            row = cur.fetchone()

        if not row:
            return jsonify({"error": "Invalid credentials"}), 401

        user_id, password_hash, role, first_name, referral_code = row

        if not bcrypt.checkpw(password.encode(), password_hash.encode()):
            return jsonify({"error": "Invalid credentials"}), 401

        token = make_token(str(user_id), role, days=365 if remember else 30)
        return jsonify({
            "token": token,
            "user": {
                "id": str(user_id),
                "email": email,
                "first_name": first_name,
                "role": role,
                "referral_code": referral_code
            }
        })

    finally:
        db.close()


# ── Lightweight membership check ─────────────────────────────────────────────
# Public endpoint — given an email, says whether that person has an active
# Stripe subscription. The tracker uses this to decide whether the Dashboard
# button opens the real dashboard or an upsell modal. Email-existence leak
# matches the surface already exposed by /forgot-password.

@auth_bp.route("/check-member", methods=["POST"])
def check_member():
    data = request.json or {}
    email = (data.get("email") or "").lower().strip()
    if not email:
        return jsonify({"is_member": False})

    db = get_db()
    try:
        with db.cursor() as cur:
            cur.execute(
                "SELECT id, role FROM users WHERE LOWER(email) = %s LIMIT 1",
                (email,),
            )
            user_row = cur.fetchone()
            if not user_row:
                return jsonify({"is_member": False, "tier": None})
            role = user_row[1]
            if role in ("admin", "coach"):
                return jsonify({"is_member": True, "tier": role})

            # Most relevant active subscription tier (most recent if several).
            cur.execute(
                """
                SELECT tier FROM subscriptions
                WHERE user_id = %s AND status = 'active'
                ORDER BY created_at DESC
                LIMIT 1
                """,
                (user_row[0],),
            )
            sub = cur.fetchone()
            tier = sub[0] if sub else None
            # "Full" members (basic/coached/elite) get the real dashboard.
            # Tracker-only ($5.99) is paid but tracker-only — NOT a full
            # member, so the Dashboard button still shows the upsell that
            # nudges them up to a membership.
            is_member = tier in ("basic", "coached", "elite")
        return jsonify({"is_member": is_member, "tier": tier})
    finally:
        db.close()


# ── Password Reset ────────────────────────────────────────────────────────────
#
# /forgot-password — email-only. Always returns 200 so an attacker can't probe
# for valid emails. If the email IS valid we generate a 1-hour token, hash it,
# store the hash, and email the user a magic reset link.
#
# /reset-password  — accepts the raw token + new password. Hashes the token,
# looks it up, validates expiry + not-yet-used, sets the new password hash,
# marks the token used.

import hashlib
import secrets

PASSWORD_RESET_TTL_MIN = 60


def _hash_reset_token(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


@auth_bp.route("/forgot-password", methods=["POST"])
def forgot_password():
    from email_helper import send_password_reset_email
    data = request.json or {}
    email = (data.get("email") or "").lower().strip()
    if not email:
        return jsonify({"error": "Email required"}), 400

    db = get_db()
    try:
        with db.cursor() as cur:
            cur.execute(
                "SELECT id, first_name FROM users WHERE LOWER(email) = %s AND is_active = TRUE",
                (email,),
            )
            row = cur.fetchone()

        # IMPORTANT: always respond 200. Don't leak whether the email exists.
        if not row:
            return jsonify({"ok": True})

        user_id, first_name = row
        raw_token = secrets.token_urlsafe(32)
        token_hash = _hash_reset_token(raw_token)

        with db.cursor() as cur:
            cur.execute(
                """
                INSERT INTO password_resets (user_id, token_hash, expires_at)
                VALUES (%s, %s, NOW() + (%s || ' minutes')::interval)
                """,
                (user_id, token_hash, PASSWORD_RESET_TTL_MIN),
            )
            db.commit()

        try:
            send_password_reset_email(email, first_name or "there", raw_token)
        except Exception as e:
            # Don't fail the request because email blew up — log and move on.
            print(f"[forgot_password] email send failed: {e}")

        return jsonify({"ok": True})
    finally:
        db.close()


@auth_bp.route("/reset-password", methods=["POST"])
def reset_password():
    data = request.json or {}
    raw_token = (data.get("token") or "").strip()
    new_password = data.get("password") or ""

    if not raw_token or len(new_password) < 8:
        return jsonify({"error": "Token and a new password (8+ chars) are required"}), 400

    token_hash = _hash_reset_token(raw_token)
    new_hash = bcrypt.hashpw(new_password.encode(), bcrypt.gensalt()).decode()

    db = get_db()
    try:
        with db.cursor() as cur:
            cur.execute(
                """
                SELECT id, user_id
                FROM password_resets
                WHERE token_hash = %s AND used_at IS NULL AND expires_at > NOW()
                """,
                (token_hash,),
            )
            row = cur.fetchone()
        if not row:
            return jsonify({"error": "This reset link is invalid or has expired."}), 400
        reset_id, user_id = row

        with db.cursor() as cur:
            cur.execute(
                "UPDATE users SET password_hash = %s WHERE id = %s",
                (new_hash, user_id),
            )
            cur.execute(
                "UPDATE password_resets SET used_at = NOW() WHERE id = %s",
                (reset_id,),
            )
            db.commit()
        return jsonify({"ok": True})
    finally:
        db.close()


# ── Coach Application ─────────────────────────────────────────────────────────

@auth_bp.route("/apply-coach", methods=["POST"])
@require_auth
def apply_coach():
    """Submit a coach application. Must be a registered member first."""
    data = request.json
    user_id = request.current_user["user_id"]

    experience = (data.get("experience") or "").strip()
    certifications = (data.get("certifications") or "").strip()
    why_coach = (data.get("why_coach") or "").strip()
    specialties = data.get("specialties", [])
    years_training = data.get("years_training")

    if not experience or not why_coach:
        return jsonify({"error": "Please fill in your experience and why you want to coach."}), 400

    db = get_db()
    try:
        with db.cursor() as cur:
            # Check for existing application
            cur.execute("SELECT id, status FROM coach_applications WHERE user_id = %s ORDER BY created_at DESC LIMIT 1", (user_id,))
            existing = cur.fetchone()
            if existing:
                status = existing[1]
                if status == "pending":
                    return jsonify({"error": "You already have a pending application."}), 409
                if status == "approved":
                    return jsonify({"error": "You're already an approved coach!"}), 409

            app_id = str(uuid.uuid4())
            cur.execute("""
                INSERT INTO coach_applications (id, user_id, experience, certifications, why_coach, specialties, years_training)
                VALUES (%s, %s, %s, %s, %s, %s, %s)
            """, (app_id, user_id, experience, certifications, why_coach, specialties, years_training))

            # Get user info for email
            cur.execute("SELECT first_name, last_name, email FROM users WHERE id = %s", (user_id,))
            user_row = cur.fetchone()
            db.commit()

        # Notify Glen
        if user_row:
            try:
                notify_admin_coach_application(user_row[0], user_row[1], user_row[2], experience, why_coach)
            except:
                pass

        return jsonify({"message": "Application submitted! We'll review it and get back to you.", "application_id": app_id})

    finally:
        db.close()


@auth_bp.route("/application-status", methods=["GET"])
@require_auth
def application_status():
    """Check current user's coach application status."""
    user_id = request.current_user["user_id"]

    db = get_db()
    try:
        with db.cursor() as cur:
            cur.execute("""
                SELECT status, review_notes, created_at, reviewed_at
                FROM coach_applications WHERE user_id = %s
                ORDER BY created_at DESC LIMIT 1
            """, (user_id,))
            row = cur.fetchone()

        if not row:
            return jsonify({"status": "none"})

        return jsonify({
            "status": row[0],
            "review_notes": row[1],
            "applied_at": str(row[2]) if row[2] else None,
            "reviewed_at": str(row[3]) if row[3] else None,
        })

    finally:
        db.close()


# ═══════════════════════════════════════════════════════════════════════════════
# MAGIC LINK LOGIN — passwordless sign-in for tracker users
# ═══════════════════════════════════════════════════════════════════════════════
import secrets as _secrets

TRACKER_URL = os.environ.get("TRACKER_URL", "https://bestrongagain.netlify.app")
APP_URL = os.environ.get("APP_URL", "https://app.bestrongagain.com")

@auth_bp.route("/magic-link/request", methods=["POST", "OPTIONS"])
def magic_link_request():
    """Accept { email }, find or auto-create user, email them a 10-minute sign-in link."""
    if request.method == "OPTIONS":
        return "", 200
    data = request.get_json(silent=True) or {}
    email = (data.get("email") or "").strip().lower()
    if not email or "@" not in email or len(email) > 200:
        return jsonify({"error": "Valid email required"}), 400

    db = get_db()
    try:
        cur = db.cursor()
        cur.execute("SELECT id, first_name FROM users WHERE LOWER(email) = %s", (email,))
        row = cur.fetchone()
        if row:
            user_id, first_name = row[0], (row[1] or email.split("@")[0])
        else:
            # Auto-create minimal member — no password. They can set one later via register.
            first_name = email.split("@")[0][:40]
            referral_code = generate_referral_code(first_name)
            # Ensure referral code unique
            for _ in range(10):
                cur.execute("SELECT 1 FROM users WHERE referral_code = %s", (referral_code,))
                if not cur.fetchone():
                    break
                referral_code = generate_referral_code(first_name)
            # Blank password hash — user can set via reset/register flow later
            cur.execute("""
                INSERT INTO users (email, first_name, role, referral_code, password_hash, is_active)
                VALUES (%s, %s, 'member', %s, '', TRUE)
                RETURNING id
            """, (email, first_name, referral_code))
            user_id = cur.fetchone()[0]
            auto_friend_admin(cur, user_id)
            auto_accept_messaging_consent(cur, user_id)

        # dest=app → sign in to the member DASHBOARD (app.bestrongagain.com),
        # used by the "Email me a sign-in link" button. A casual client may not
        # open the email immediately, so give the dashboard link a 7-day window
        # (vs the 10-minute FriendChat/tracker link).
        dest = (data.get("dest") or "").strip().lower()
        token = _secrets.token_urlsafe(32)
        if dest == "app":
            expires = datetime.utcnow() + timedelta(days=7)
        else:
            expires = datetime.utcnow() + timedelta(minutes=10)
        cur.execute(
            "UPDATE users SET magic_token = %s, magic_expires_at = %s WHERE id = %s",
            (token, expires, user_id),
        )
        db.commit()

        if dest == "app":
            link = f"{APP_URL}/magic?token={token}"
            subject = "Sign in to your dashboard"
            html = f"""
              <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;max-width:520px;margin:0 auto;padding:24px;">
                <h2 style="color:#1a1a2e;margin:0 0 16px;">Open your dashboard 💪</h2>
                <p style="color:#444;line-height:1.5;font-size:15px;">Hi {first_name}, tap below to open your Be Strong Again dashboard — your coach's notes, sessions logged, and the gym's monthly challenge. No password needed.</p>
                <p style="margin:24px 0;"><a href="{link}" style="background:linear-gradient(135deg,#f59e0b,#d97706);color:#fff;padding:14px 28px;border-radius:10px;font-weight:800;font-size:16px;text-decoration:none;display:inline-block;">Open my dashboard</a></p>
                <p style="color:#888;font-size:12px;line-height:1.5;">Or paste this into your browser:<br><a href="{link}" style="color:#667eea;word-break:break-all;">{link}</a></p>
                <p style="color:#aaa;font-size:11px;margin-top:32px;">This link works for 7 days. If you didn't request this, you can ignore the email.</p>
              </div>
            """
        else:
            link = f"{TRACKER_URL}/magic?token={token}"
            subject = "Sign in to Be Strong Again"
            html = f"""
              <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;max-width:520px;margin:0 auto;padding:24px;">
                <h2 style="color:#1a1a2e;margin:0 0 16px;">Sign in to Be Strong Again</h2>
                <p style="color:#444;line-height:1.5;font-size:15px;">Hi {first_name}, tap the button below to sign in to the tracker and message your friends. The link expires in <strong>10 minutes</strong>.</p>
                <p style="margin:24px 0;"><a href="{link}" style="background:linear-gradient(135deg,#ff9a3c,#ffd200);color:#1a1a2e;padding:14px 28px;border-radius:10px;font-weight:800;font-size:16px;text-decoration:none;display:inline-block;">Sign in</a></p>
                <p style="color:#888;font-size:12px;line-height:1.5;">Or paste this into your browser:<br><a href="{link}" style="color:#667eea;word-break:break-all;">{link}</a></p>
                <p style="color:#aaa;font-size:11px;margin-top:32px;">If you didn't request this, you can ignore the email.</p>
              </div>
            """
        try:
            send_email(email, subject, html)
        except Exception as e:
            # Don't leak SMTP errors — but return a warning hint for debugging
            return jsonify({"success": False, "error": f"Couldn't send email ({e})"}), 500

        return jsonify({"success": True, "message": f"Check {email} for a sign-in link."})
    finally:
        db.close()


@auth_bp.route("/magic-link/consume", methods=["POST", "OPTIONS"])
def magic_link_consume():
    """Exchange a magic token for a JWT. One-shot — token invalidates on use."""
    if request.method == "OPTIONS":
        return "", 200
    data = request.get_json(silent=True) or {}
    token = (data.get("token") or "").strip()
    if not token or len(token) < 20:
        return jsonify({"error": "Invalid token"}), 400

    db = get_db()
    try:
        cur = db.cursor()
        cur.execute("""
            SELECT id, email, role, first_name, last_name, referral_code
            FROM users
            WHERE magic_token = %s AND magic_expires_at > NOW() AND is_active = TRUE
        """, (token,))
        row = cur.fetchone()
        if not row:
            return jsonify({"error": "Sign-in link expired or already used. Request a new one."}), 401
        user_id = str(row[0])
        # Invalidate token immediately (one-shot)
        cur.execute("UPDATE users SET magic_token = NULL, magic_expires_at = NULL WHERE id = %s", (row[0],))
        db.commit()
        # Members get a long session (≈1 year) so a casual client who signed in
        # via a magic link stays signed in and rarely needs a new one — like the
        # leaderboard. Coach/admin keep the default 30 days for tighter security.
        jwt_token = make_token(user_id, row[2], days=365 if row[2] == "member" else 30)
        return jsonify({
            "success": True,
            "token": jwt_token,
            "user": {
                "id": user_id,
                "email": row[1],
                "role": row[2],
                "first_name": row[3],
                "last_name": row[4],
                "referral_code": row[5],
            },
        })
    finally:
        db.close()
