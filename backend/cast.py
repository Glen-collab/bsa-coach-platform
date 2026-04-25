"""
cast.py — "Cast to TV" pairing endpoints.

Flow:
  1. TV browser opens /cast → frontend POSTs /api/cast/register → gets a fresh 4-digit pair_code.
  2. Phone (tracker) opens cast modal, user types the pair_code they see on their TV.
     Phone POSTs /api/cast/push with its current workout session (access_code, week, day, etc).
  3. TV polls GET /api/cast/poll/<pair_code> every 2s. Once phone has pushed, TV
     receives the session payload and redraws into the full workout view.

Sessions live 15 minutes. Each register() prunes expired rows.
"""

import os
import random
import json
import psycopg2
from psycopg2.extras import RealDictCursor
from flask import Blueprint, request, jsonify

cast_bp = Blueprint("cast", __name__)

def get_db():
    return psycopg2.connect(os.environ["DATABASE_URL"], cursor_factory=RealDictCursor)


def _new_pair_code(cur):
    """Generate a 4-digit code that isn't currently active. Retry a few times."""
    for _ in range(20):
        code = f"{random.randint(0, 9999):04d}"
        cur.execute(
            "SELECT 1 FROM cast_sessions WHERE pair_code = %s AND expires_at > NOW()",
            (code,),
        )
        if not cur.fetchone():
            return code
    return None


@cast_bp.route("/register", methods=["POST", "OPTIONS"])
def register():
    """TV hits this on page load. Returns a fresh pair_code.
    No body needed. Also prunes expired sessions."""
    if request.method == "OPTIONS":
        return "", 200
    db = get_db()
    try:
        cur = db.cursor()
        # Prune expired (keeps the table small)
        cur.execute("DELETE FROM cast_sessions WHERE expires_at < NOW()")
        code = _new_pair_code(cur)
        if not code:
            db.rollback()
            return jsonify({"success": False, "message": "No free pair code — try again"}), 500
        cur.execute(
            "INSERT INTO cast_sessions (pair_code) VALUES (%s) RETURNING id, expires_at",
            (code,),
        )
        row = cur.fetchone()
        db.commit()
        return jsonify({
            "success": True,
            "pair_code": code,
            "session_id": row["id"],
            "expires_at": str(row["expires_at"]),
        })
    finally:
        db.close()


@cast_bp.route("/poll/<pair_code>", methods=["GET", "OPTIONS"])
def poll(pair_code):
    """TV polls. Returns bound: true + session payload once phone has pushed.
    Always includes scroll_frac so the TV can mirror the phone's scroll."""
    if request.method == "OPTIONS":
        return "", 200
    pair_code = (pair_code or "").strip()
    if not pair_code.isdigit() or len(pair_code) != 4:
        return jsonify({"bound": False, "error": "invalid code"}), 400
    db = get_db()
    try:
        cur = db.cursor()
        cur.execute(
            """SELECT access_code, user_email, user_name, week, day, main_maxes, program_data,
                      bound_at, scroll_frac, scroll_updated_at, playing_exercise,
                      nav_index, nav_updated_at, nav_direction, layout
               FROM cast_sessions
               WHERE pair_code = %s AND expires_at > NOW()
               ORDER BY created_at DESC LIMIT 1""",
            (pair_code,),
        )
        row = cur.fetchone()
        if not row:
            return jsonify({"bound": False, "expired": True})
        if not row["bound_at"]:
            return jsonify({"bound": False})
        # Resolve the owning coach's brand so the TV (especially the two-day
        # whiteboard) can wear the gym's logo/colors. Cheap: indexed lookup
        # on workout_programs.access_code, then one join to users.
        brand = _resolve_brand(cur, row["access_code"])
        return jsonify({
            "bound": True,
            "access_code": row["access_code"],
            "user_email": row["user_email"],
            "user_name": row["user_name"],
            "week": row["week"],
            "day": row["day"],
            "main_maxes": row["main_maxes"],
            "program_data": row["program_data"],
            "scroll_frac": float(row["scroll_frac"] or 0.0),
            "scroll_updated_at": str(row["scroll_updated_at"]) if row["scroll_updated_at"] else None,
            "playing_exercise": row.get("playing_exercise"),
            "nav_index": row.get("nav_index"),
            "nav_updated_at": str(row["nav_updated_at"]) if row.get("nav_updated_at") else None,
            "nav_direction": row.get("nav_direction"),
            "layout": row.get("layout") or "one_day",
            "brand": brand,
        })
    finally:
        db.close()


def _resolve_brand(cur, access_code):
    """Given a cast session's access_code, find the owning coach (via
    workout_programs.optional_trainer_email, falling back to user_email
    for legacy coach-built-for-themselves programs) and return that
    coach's brand settings. Returns a plain dict the TV can consume;
    all-None if the program or brand aren't set."""
    if not access_code:
        return None
    cur.execute(
        """SELECT u.brand_logo_data, u.brand_primary, u.brand_accent, u.brand_gym_name
             FROM workout_programs wp
             LEFT JOIN users u
               ON LOWER(u.email) = LOWER(COALESCE(wp.optional_trainer_email, wp.user_email))
            WHERE wp.access_code = %s
            ORDER BY wp.updated_at DESC LIMIT 1""",
        (access_code,),
    )
    row = cur.fetchone()
    if not row:
        return None
    # If all brand fields are null/empty, return None so the TV can tell
    # "no branding set" vs "branding cleared".
    if not any([row.get("brand_logo_data"), row.get("brand_primary"),
                row.get("brand_accent"), row.get("brand_gym_name")]):
        return None
    return {
        "logo_data":  row.get("brand_logo_data"),
        "primary":    row.get("brand_primary"),
        "accent":     row.get("brand_accent"),
        "gym_name":   row.get("brand_gym_name"),
    }


@cast_bp.route("/scroll", methods=["POST", "OPTIONS"])
def update_scroll():
    """Phone pushes scroll position (as 0..1 fraction of scrollable height).
    Body: { pair_code, scroll_frac }"""
    if request.method == "OPTIONS":
        return "", 200
    data = request.get_json(silent=True) or {}
    pair_code = (data.get("pair_code") or "").strip()
    frac = data.get("scroll_frac")
    try:
        frac = max(0.0, min(1.0, float(frac)))
    except (TypeError, ValueError):
        return jsonify({"success": False, "message": "scroll_frac must be a number"}), 400
    if not pair_code.isdigit() or len(pair_code) != 4:
        return jsonify({"success": False, "message": "invalid pair_code"}), 400
    db = get_db()
    try:
        cur = db.cursor()
        cur.execute(
            "UPDATE cast_sessions SET scroll_frac = %s, scroll_updated_at = NOW() WHERE pair_code = %s AND expires_at > NOW() AND bound_at IS NOT NULL",
            (frac, pair_code),
        )
        updated = cur.rowcount
        db.commit()
        return jsonify({"success": updated > 0})
    finally:
        db.close()


@cast_bp.route("/play", methods=["POST", "OPTIONS"])
def set_playing_exercise():
    """Phone tells the TV which exercise video to show full-screen.
    Body: { pair_code, exercise }  — pass exercise=null to return to the list."""
    if request.method == "OPTIONS":
        return "", 200
    data = request.get_json(silent=True) or {}
    pair_code = (data.get("pair_code") or "").strip()
    if not pair_code.isdigit() or len(pair_code) != 4:
        return jsonify({"success": False, "message": "invalid pair_code"}), 400
    exercise = data.get("exercise")   # dict or None
    db = get_db()
    try:
        cur = db.cursor()
        # Also extend the session while actively casting so it doesn't expire mid-use.
        cur.execute(
            """UPDATE cast_sessions
                 SET playing_exercise = %s, expires_at = GREATEST(expires_at, NOW() + INTERVAL '1 hour')
               WHERE pair_code = %s AND expires_at > NOW() AND bound_at IS NOT NULL""",
            (json.dumps(exercise) if exercise else None, pair_code),
        )
        updated = cur.rowcount
        db.commit()
        return jsonify({"success": updated > 0})
    finally:
        db.close()


@cast_bp.route("/nav", methods=["POST", "OPTIONS"])
def nav():
    """Phone uses ▲▼ arrows to advance the currently-highlighted exercise on TV.
    Body: { pair_code, direction: 'next'|'prev' } or { pair_code, index: N }
    TV polls nav_index and scrolls that exercise card into view (centered)."""
    if request.method == "OPTIONS":
        return "", 200
    data = request.get_json(silent=True) or {}
    pair_code = (data.get("pair_code") or "").strip()
    if not pair_code.isdigit() or len(pair_code) != 4:
        return jsonify({"success": False, "message": "invalid pair_code"}), 400
    direction = (data.get("direction") or "").strip()
    index = data.get("index")
    db = get_db()
    try:
        cur = db.cursor()
        if direction in ("next", "prev"):
            delta = 1 if direction == "next" else -1
            cur.execute(
                """UPDATE cast_sessions
                     SET nav_index = GREATEST(0, COALESCE(nav_index, 0) + %s),
                         nav_direction = %s,
                         nav_updated_at = NOW(),
                         expires_at = GREATEST(expires_at, NOW() + INTERVAL '1 hour')
                   WHERE pair_code = %s AND expires_at > NOW() AND bound_at IS NOT NULL
                   RETURNING nav_index""",
                (delta, direction, pair_code),
            )
        else:
            try:
                idx = max(0, int(index))
            except (TypeError, ValueError):
                return jsonify({"success": False, "message": "direction or index required"}), 400
            cur.execute(
                """UPDATE cast_sessions
                     SET nav_index = %s,
                         nav_updated_at = NOW(),
                         expires_at = GREATEST(expires_at, NOW() + INTERVAL '1 hour')
                   WHERE pair_code = %s AND expires_at > NOW() AND bound_at IS NOT NULL
                   RETURNING nav_index""",
                (idx, pair_code),
            )
        row = cur.fetchone()
        db.commit()
        if not row:
            return jsonify({"success": False, "message": "session not found"}), 404
        return jsonify({"success": True, "nav_index": row["nav_index"]})
    finally:
        db.close()


@cast_bp.route("/layout", methods=["POST", "OPTIONS"])
def set_layout():
    """Phone flips the TV layout mid-cast without re-pairing.
    Body: { pair_code, layout: 'one_day' | 'two_day' }"""
    if request.method == "OPTIONS":
        return "", 200
    data = request.get_json(silent=True) or {}
    pair_code = (data.get("pair_code") or "").strip()
    layout = (data.get("layout") or "").strip()
    if not pair_code.isdigit() or len(pair_code) != 4:
        return jsonify({"success": False, "message": "invalid pair_code"}), 400
    if layout not in ("one_day", "two_day"):
        return jsonify({"success": False, "message": "layout must be one_day or two_day"}), 400
    db = get_db()
    try:
        cur = db.cursor()
        # Also extend the session while the coach is actively flipping.
        cur.execute(
            """UPDATE cast_sessions
                 SET layout = %s,
                     expires_at = GREATEST(expires_at, NOW() + INTERVAL '1 hour')
               WHERE pair_code = %s AND expires_at > NOW() AND bound_at IS NOT NULL""",
            (layout, pair_code),
        )
        updated = cur.rowcount
        db.commit()
        return jsonify({"success": updated > 0, "layout": layout})
    finally:
        db.close()


@cast_bp.route("/stop", methods=["POST", "OPTIONS"])
def stop():
    """Phone ends a cast session early. Body: { pair_code }
    Sets expires_at to NOW so the TV's next poll sees 'expired' and can reset."""
    if request.method == "OPTIONS":
        return "", 200
    data = request.get_json(silent=True) or {}
    pair_code = (data.get("pair_code") or "").strip()
    if not pair_code.isdigit() or len(pair_code) != 4:
        return jsonify({"success": False, "message": "invalid pair_code"}), 400
    db = get_db()
    try:
        cur = db.cursor()
        cur.execute("UPDATE cast_sessions SET expires_at = NOW() WHERE pair_code = %s", (pair_code,))
        db.commit()
        return jsonify({"success": True})
    finally:
        db.close()


@cast_bp.route("/push", methods=["POST", "OPTIONS"])
def push():
    """Phone binds a workout session to a pair_code.
    Body: { pair_code, access_code, user_email, user_name, week, day, main_maxes, program_data? }"""
    if request.method == "OPTIONS":
        return "", 200
    data = request.get_json(silent=True) or {}
    pair_code = (data.get("pair_code") or "").strip()
    if not pair_code.isdigit() or len(pair_code) != 4:
        return jsonify({"success": False, "message": "4-digit pair code required"}), 400

    db = get_db()
    try:
        cur = db.cursor()
        cur.execute(
            "SELECT id FROM cast_sessions WHERE pair_code = %s AND expires_at > NOW() AND bound_at IS NULL ORDER BY created_at DESC LIMIT 1",
            (pair_code,),
        )
        row = cur.fetchone()
        if not row:
            return jsonify({"success": False, "message": "Code not found or already used. Refresh your TV to get a fresh code."}), 404
        layout = (data.get("layout") or "one_day").strip()
        if layout not in ("one_day", "two_day"):
            layout = "one_day"
        cur.execute(
            """UPDATE cast_sessions SET
                 access_code = %s,
                 user_email = %s,
                 user_name = %s,
                 week = %s,
                 day = %s,
                 main_maxes = %s,
                 program_data = %s,
                 layout = %s,
                 bound_at = NOW(),
                 expires_at = NOW() + INTERVAL '4 hours'
               WHERE id = %s""",
            (
                (data.get("access_code") or "").strip() or None,
                (data.get("user_email") or "").strip() or None,
                (data.get("user_name") or "").strip() or None,
                data.get("week") or None,
                data.get("day") or None,
                json.dumps(data.get("main_maxes") or {}),
                json.dumps(data.get("program_data") or None) if data.get("program_data") else None,
                layout,
                row["id"],
            ),
        )
        db.commit()
        return jsonify({"success": True})
    finally:
        db.close()
