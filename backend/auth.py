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


def make_token(user_id: str, role: str) -> str:
    return jwt.encode({
        "user_id": user_id,
        "role": role,
        "exp": datetime.utcnow() + timedelta(days=30)
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

            cur.execute("""
                INSERT INTO users (
                    id, email, password_hash, first_name, last_name,
                    role, referred_by_id, referral_code
                ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
            """, (
                user_id, email, password_hash, first_name, last_name,
                role, referred_by_id, my_referral_code
            ))
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
            # Always notify Glen
            notify_admin_new_signup(first_name, last_name, email, my_referral_code, referred_by_name)
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
        return jsonify({"error": "Email already registered"}), 409
    finally:
        db.close()


@auth_bp.route("/login", methods=["POST"])
def login():
    data = request.json
    email = data.get("email", "").lower().strip()
    password = data.get("password", "")

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

        token = make_token(str(user_id), role)
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
