"""
kiosk.py — Gym TV kiosk management.

Flow:
  1. Coach flags some of their programs with show_on_kiosk=TRUE.
  2. Coach's tile view (/gym-tv on the frontend) lists those programs.
  3. Coach taps a tile → active_kiosk_program_id on users row is set.
  4. Pi kiosk polls /api/kiosk/tv-config?pi=<coach_id> every minute.
  5. When the access_code in the response changes, the Pi reloads /tv/static with
     the new code.

Public endpoint (no auth) for Pi polling: GET /api/kiosk/tv-config
Authenticated coach endpoints for managing the kiosk lineup.
"""

from flask import Blueprint, request, jsonify
from psycopg2.extras import RealDictCursor
import psycopg2
import os

from auth import require_auth

kiosk_bp = Blueprint("kiosk", __name__)


def get_db():
    return psycopg2.connect(os.environ.get("DATABASE_URL"), cursor_factory=RealDictCursor)


# ── Coach: list their programs with kiosk flag ────────────────────────
@kiosk_bp.route("/my-programs", methods=["GET"])
@require_auth
def list_my_programs():
    """Returns all programs owned by this coach with show_on_kiosk + active flag."""
    user_id = request.current_user["user_id"]
    db = get_db()
    try:
        cur = db.cursor()
        # Get coach's email so we can match workout_programs.optional_trainer_email
        cur.execute("SELECT email, active_kiosk_program_id FROM users WHERE id = %s", (user_id,))
        u = cur.fetchone()
        if not u:
            return jsonify({"error": "User not found"}), 404
        coach_email = u["email"]
        active_id = u["active_kiosk_program_id"]

        # A program "belongs to" the coach if either user_email (legacy — coach built
        # for themselves) or optional_trainer_email (coach built for a client) matches.
        cur.execute("""
            SELECT id, access_code, program_name, program_nickname,
                   show_on_kiosk, created_at, updated_at
            FROM workout_programs
            WHERE (optional_trainer_email = %s OR user_email = %s)
              AND is_active = TRUE
            ORDER BY updated_at DESC
        """, (coach_email, coach_email))
        programs = cur.fetchall()
        for p in programs:
            p["is_active_kiosk"] = (p["id"] == active_id)
        return jsonify({"programs": programs, "active_kiosk_program_id": active_id})
    finally:
        db.close()


# ── Coach: toggle show_on_kiosk for a program ─────────────────────────
@kiosk_bp.route("/toggle-kiosk", methods=["POST"])
@require_auth
def toggle_kiosk():
    """Body: { program_id, show_on_kiosk: true|false }"""
    user_id = request.current_user["user_id"]
    data = request.get_json(silent=True) or {}
    program_id = data.get("program_id")
    show = bool(data.get("show_on_kiosk"))
    if not program_id:
        return jsonify({"error": "program_id required"}), 400

    db = get_db()
    try:
        cur = db.cursor()
        # Verify ownership — coach can only toggle their own programs
        cur.execute("SELECT email FROM users WHERE id = %s", (user_id,))
        u = cur.fetchone()
        if not u:
            return jsonify({"error": "User not found"}), 404
        cur.execute("""
            UPDATE workout_programs
            SET show_on_kiosk = %s, updated_at = NOW()
            WHERE id = %s AND (optional_trainer_email = %s OR user_email = %s)
            RETURNING id, show_on_kiosk
        """, (show, program_id, u["email"], u["email"]))
        row = cur.fetchone()
        db.commit()
        if not row:
            return jsonify({"error": "Program not found or not owned by you"}), 404
        return jsonify({"success": True, "program": row})
    finally:
        db.close()


# ── Coach: set active kiosk program (what the TV currently shows) ─────
@kiosk_bp.route("/set-active", methods=["POST"])
@require_auth
def set_active():
    """Body: { program_id } — set what the coach's TV(s) display. Pass null to clear."""
    user_id = request.current_user["user_id"]
    data = request.get_json(silent=True) or {}
    program_id = data.get("program_id")  # can be null to clear

    db = get_db()
    try:
        cur = db.cursor()
        if program_id is not None:
            # Verify ownership
            cur.execute("SELECT email FROM users WHERE id = %s", (user_id,))
            u = cur.fetchone()
            if not u:
                return jsonify({"error": "User not found"}), 404
            cur.execute(
                "SELECT id FROM workout_programs WHERE id = %s AND (optional_trainer_email = %s OR user_email = %s)",
                (program_id, u["email"], u["email"]),
            )
            if not cur.fetchone():
                return jsonify({"error": "Program not found or not owned by you"}), 404

        cur.execute("""
            UPDATE users SET active_kiosk_program_id = %s, updated_at = NOW()
            WHERE id = %s
            RETURNING active_kiosk_program_id
        """, (program_id, user_id))
        row = cur.fetchone()
        db.commit()
        return jsonify({"success": True, "active_kiosk_program_id": row["active_kiosk_program_id"]})
    finally:
        db.close()


# ── Public: Pi polls this endpoint to know what to display ────────────
@kiosk_bp.route("/tv-config", methods=["GET"])
def tv_config():
    """
    GET /api/kiosk/tv-config?pi=<coach_user_id>

    Returns the current active program's access_code + metadata for this coach.
    Public — no auth needed so the Pi doesn't have to manage JWTs.
    """
    pi_id = (request.args.get("pi") or "").strip()
    if not pi_id:
        return jsonify({"error": "pi (coach user id) required"}), 400
    db = get_db()
    try:
        cur = db.cursor()
        cur.execute("""
            SELECT u.id AS coach_id, u.first_name, u.last_name, u.referral_code,
                   u.active_kiosk_program_id,
                   wp.access_code, wp.program_name, wp.program_nickname
            FROM users u
            LEFT JOIN workout_programs wp ON wp.id = u.active_kiosk_program_id
            WHERE u.id = %s
        """, (pi_id,))
        row = cur.fetchone()
        if not row:
            return jsonify({"error": "Coach not found"}), 404
        return jsonify({
            "coach": {
                "first_name": row["first_name"],
                "last_name": row["last_name"],
                "referral_code": row["referral_code"],
            },
            "active": {
                "program_id": row["active_kiosk_program_id"],
                "access_code": row["access_code"],
                "program_name": row["program_name"],
                "program_nickname": row["program_nickname"],
            } if row["access_code"] else None,
        })
    finally:
        db.close()
