"""
coaches.py - Coach dashboard API routes
"""

from flask import Blueprint, request, jsonify
from psycopg2.extras import RealDictCursor
import psycopg2
import os

coaches_bp = Blueprint("coaches", __name__)


def get_db():
    return psycopg2.connect(os.environ.get("DATABASE_URL"), cursor_factory=RealDictCursor)


@coaches_bp.route("/dashboard/<coach_id>", methods=["GET"])
def coach_dashboard(coach_id):
    """Full dashboard data for a coach — clients, earnings, recruits, workout data."""
    db = get_db()
    try:
        cur = db.cursor()

        # Get coach info
        cur.execute("SELECT email, first_name, referral_code FROM users WHERE id = %s", (coach_id,))
        coach = cur.fetchone()
        if not coach:
            return jsonify({"error": "Coach not found"}), 404

        coach_email = coach["email"]
        referral_code = coach["referral_code"]

        # Clients who signed up via this coach's referral code
        cur.execute("""
            SELECT u.id, u.first_name, u.last_name, u.email, u.created_at,
                   s.tier, s.status as sub_status, s.amount_cents
            FROM users u
            LEFT JOIN subscriptions s ON s.user_id = u.id AND s.status = 'active'
            WHERE u.referred_by_id = %s AND u.role = 'member'
            ORDER BY u.created_at DESC
        """, (coach_id,))
        platform_clients = cur.fetchall()

        # Also get workout tracking data for these clients
        client_emails = [c["email"] for c in platform_clients]

        # Get workout data for referred clients
        workout_clients = []
        if client_emails:
            placeholders = ','.join(['%s'] * len(client_emails))
            cur.execute(f"""
                SELECT up.user_email, up.user_name, up.access_code, up.current_week, up.current_day,
                       up.one_rm_bench, up.one_rm_squat, up.one_rm_deadlift, up.one_rm_clean,
                       p.program_name,
                       (SELECT COUNT(*) FROM workout_logs wl WHERE wl.access_code = up.access_code AND wl.user_email = up.user_email) as workout_count,
                       (SELECT MAX(workout_date) FROM workout_logs wl WHERE wl.access_code = up.access_code AND wl.user_email = up.user_email) as last_workout
                FROM workout_user_position up
                LEFT JOIN workout_programs p ON up.access_code = p.access_code
                WHERE up.user_email IN ({placeholders})
                ORDER BY up.user_email
            """, client_emails)
            workout_clients = cur.fetchall()

        # Merge platform + workout data
        clients = []
        for pc in platform_clients:
            # Find matching workout data
            workouts = [w for w in workout_clients if w["user_email"] == pc["email"]]
            client = {
                "id": str(pc["id"]),
                "first_name": pc["first_name"],
                "last_name": pc["last_name"],
                "email": pc["email"],
                "joined": str(pc["created_at"]) if pc["created_at"] else None,
                "tier": pc["tier"],
                "sub_status": pc["sub_status"],
                "monthly_value": (pc["amount_cents"] or 0) / 100,
                "programs": [{
                    "access_code": w["access_code"],
                    "program_name": w["program_name"],
                    "current_week": w["current_week"],
                    "current_day": w["current_day"],
                    "workout_count": w["workout_count"],
                    "last_workout": str(w["last_workout"]) if w["last_workout"] else None,
                } for w in workouts],
            }
            clients.append(client)

        # Earnings summary
        cur.execute("""
            SELECT
                COALESCE(SUM(commission_amount_cents) FILTER (WHERE status = 'paid'), 0) as total_paid,
                COALESCE(SUM(commission_amount_cents) FILTER (WHERE status = 'pending'), 0) as total_pending,
                COUNT(*) FILTER (WHERE status = 'paid') as total_transactions
            FROM commissions
            WHERE earner_id = %s
        """, (coach_id,))
        earnings_row = cur.fetchone()
        earnings = {
            "total_paid": earnings_row["total_paid"] / 100,
            "total_pending": earnings_row["total_pending"] / 100,
            "total_transactions": earnings_row["total_transactions"] or 0,
        }

        # Direct recruits (coaches they recruited)
        cur.execute("""
            SELECT u.id, u.first_name, u.last_name, u.email, u.referral_code,
                   (SELECT COUNT(*) FROM users c WHERE c.referred_by_id = u.id AND c.role = 'member') as client_count
            FROM users u
            WHERE u.referred_by_id = %s AND u.role = 'coach' AND u.is_active = TRUE
        """, (coach_id,))
        recruits = [
            {
                "id": str(r["id"]),
                "first_name": r["first_name"],
                "last_name": r["last_name"],
                "email": r["email"],
                "referral_code": r["referral_code"],
                "client_count": r["client_count"],
            }
            for r in cur.fetchall()
        ]

        return jsonify({
            "clients": clients,
            "earnings": earnings,
            "recruits": recruits,
            "referral_code": referral_code,
            "referral_link": f"https://app.bestrongagain.com/register/{referral_code}",
            "total_clients": len(clients),
        })

    finally:
        db.close()


@coaches_bp.route("/workout-clients/<coach_id>", methods=["GET"])
def coach_workout_clients(coach_id):
    """Get workout tracking data for a coach's clients — for the trainer dashboard view.
    Combines: clients referred via coach platform + clients on programs created by this coach's email."""
    db = get_db()
    try:
        cur = db.cursor()

        # Get coach's email
        cur.execute("SELECT email FROM users WHERE id = %s", (coach_id,))
        coach_row = cur.fetchone()
        coach_email = coach_row["email"] if coach_row else None

        # Source 1: Emails of clients referred by this coach on the platform
        cur.execute("""
            SELECT email FROM users
            WHERE referred_by_id = %s AND is_active = TRUE
        """, (coach_id,))
        referred_emails = set(r["email"] for r in cur.fetchall())

        # Source 2: Emails of clients on programs this coach created (by trainer email)
        program_emails = set()
        if coach_email:
            cur.execute("""
                SELECT DISTINCT up.user_email
                FROM workout_user_position up
                JOIN workout_programs p ON up.access_code = p.access_code
                WHERE LOWER(p.user_email) = %s OR LOWER(p.optional_trainer_email) = %s
            """, (coach_email.lower(), coach_email.lower()))
            program_emails = set(r["user_email"] for r in cur.fetchall())

        # Combine and deduplicate — exclude the coach's own email
        client_emails = list((referred_emails | program_emails) - {coach_email})

        if not client_emails:
            return jsonify({"success": True, "data": []})

        # Get their workout positions (same format as get-clients.php)
        placeholders = ','.join(['%s'] * len(client_emails))
        cur.execute(f"""
            SELECT up.*,
                   p.program_name,
                   (SELECT COUNT(*) FROM workout_logs wl WHERE wl.access_code = up.access_code AND wl.user_email = up.user_email) as workout_count,
                   (SELECT MAX(workout_date) FROM workout_logs wl WHERE wl.access_code = up.access_code AND wl.user_email = up.user_email) as last_workout
            FROM workout_user_position up
            LEFT JOIN workout_programs p ON up.access_code = p.access_code
            WHERE up.user_email IN ({placeholders})
            ORDER BY up.updated_at DESC
        """, client_emails)
        rows = cur.fetchall()

        clients = []
        for r in rows:
            clients.append({
                "user_email": r["user_email"],
                "email": r["user_email"],
                "user_name": r.get("user_name", ""),
                "name": r.get("user_name", ""),
                "access_code": r["access_code"],
                "accessCode": r["access_code"],
                "program_name": r.get("program_name", ""),
                "programName": r.get("program_name", ""),
                "current_week": r.get("current_week", 1),
                "currentWeek": r.get("current_week", 1),
                "current_day": r.get("current_day", 1),
                "currentDay": r.get("current_day", 1),
                "workout_count": r.get("workout_count", 0),
                "workoutCount": r.get("workout_count", 0),
                "last_workout": str(r["last_workout"]) if r.get("last_workout") else None,
                "lastWorkout": str(r["last_workout"]) if r.get("last_workout") else None,
                "one_rm_bench": float(r.get("one_rm_bench") or 0),
                "oneRmBench": float(r.get("one_rm_bench") or 0),
                "one_rm_squat": float(r.get("one_rm_squat") or 0),
                "oneRmSquat": float(r.get("one_rm_squat") or 0),
                "one_rm_deadlift": float(r.get("one_rm_deadlift") or 0),
                "oneRmDeadlift": float(r.get("one_rm_deadlift") or 0),
                "one_rm_clean": float(r.get("one_rm_clean") or 0),
                "oneRmClean": float(r.get("one_rm_clean") or 0),
            })

        return jsonify({"success": True, "data": clients})

    finally:
        db.close()


@coaches_bp.route("/tree/<coach_id>", methods=["GET"])
def coach_tree(coach_id):
    """Visualize the coach's downline tree — one level only (referral bonus level)."""
    db = get_db()
    try:
        cur = db.cursor()
        cur.execute("""
            SELECT u.id, u.first_name, u.last_name, u.referral_code,
                   (SELECT COUNT(*) FROM users c WHERE c.referred_by_id = u.id AND c.role = 'member') as client_count
            FROM users u
            WHERE u.referred_by_id = %s AND u.role = 'coach' AND u.is_active = TRUE
        """, (coach_id,))
        rows = cur.fetchall()

        tree = [
            {
                "id": str(r["id"]),
                "first_name": r["first_name"],
                "last_name": r["last_name"],
                "referral_code": r["referral_code"],
                "client_count": r["client_count"],
                "commission_rate": "10%",
            }
            for r in rows
        ]

        return jsonify({"tree": tree})

    finally:
        db.close()


@coaches_bp.route("/earnings/history/<coach_id>", methods=["GET"])
def earnings_history(coach_id):
    """Monthly earnings breakdown for a coach."""
    db = get_db()
    try:
        cur = db.cursor()
        cur.execute("""
            SELECT
                DATE_TRUNC('month', created_at) as month,
                SUM(commission_amount_cents) as total_cents,
                COUNT(*) as transaction_count
            FROM commissions
            WHERE earner_id = %s AND status = 'paid'
            GROUP BY month
            ORDER BY month DESC
            LIMIT 12
        """, (coach_id,))
        rows = cur.fetchall()

        return jsonify({
            "history": [
                {
                    "month": str(r["month"])[:7],
                    "total": r["total_cents"] / 100,
                    "transactions": r["transaction_count"],
                }
                for r in rows
            ]
        })

    finally:
        db.close()
