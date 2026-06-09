"""
challenges.py — Self-reported challenge system.
Athletes submit results (time, distance, reps, weight, etc.)
Best score per athlete wins. Unlimited attempts.
"""
import os
from datetime import date

import psycopg2
from psycopg2.extras import RealDictCursor
from flask import Blueprint, request, jsonify
from auth import require_auth

challenges_bp = Blueprint("challenges", __name__)


def get_db():
    return psycopg2.connect(
        os.environ["DATABASE_URL"],
        cursor_factory=RealDictCursor,
    )


def _auto_status(start_date, end_date):
    today = date.today()
    if today < start_date:
        return "upcoming"
    if today > end_date:
        return "completed"
    return "active"


# ── Admin endpoints ──────────────────────────────────────────────────

@challenges_bp.route("/create", methods=["POST"])
@require_auth
def create_challenge():
    user = request.current_user
    if user.get("role") not in ("admin", "coach"):
        return jsonify({"error": "Admin/coach only"}), 403

    data = request.get_json(silent=True) or {}
    title = (data.get("title") or "").strip()
    description = (data.get("description") or "").strip()
    unit = (data.get("unit") or "reps").strip()
    lower_is_better = bool(data.get("lower_is_better", False))
    start_date = data.get("start_date")
    end_date = data.get("end_date")
    duration_weeks = data.get("duration_weeks")

    if not title or not start_date or not end_date:
        return jsonify({"error": "title, start_date, end_date required"}), 400

    try:
        sd = date.fromisoformat(start_date)
        ed = date.fromisoformat(end_date)
    except ValueError:
        return jsonify({"error": "Dates must be YYYY-MM-DD"}), 400
    if ed <= sd:
        return jsonify({"error": "end_date must be after start_date"}), 400

    status = _auto_status(sd, ed)

    db = get_db()
    try:
        cur = db.cursor()
        cur.execute("""
            INSERT INTO challenges (title, description, metric_type, unit, lower_is_better,
                                    start_date, end_date, duration_weeks, status, created_by)
            VALUES (%s, %s, 'custom', %s, %s, %s, %s, %s, %s, %s)
            RETURNING *
        """, (title, description, unit, lower_is_better, str(sd), str(ed),
              duration_weeks, status, user["user_id"]))
        row = cur.fetchone()
        db.commit()
        return jsonify({"success": True, "challenge": row})
    finally:
        db.close()


@challenges_bp.route("/<challenge_id>", methods=["PUT"])
@require_auth
def update_challenge(challenge_id):
    user = request.current_user
    if user.get("role") not in ("admin", "coach"):
        return jsonify({"error": "Admin/coach only"}), 403

    data = request.get_json(silent=True) or {}
    db = get_db()
    try:
        cur = db.cursor()
        cur.execute("SELECT * FROM challenges WHERE id = %s", (challenge_id,))
        ch = cur.fetchone()
        if not ch:
            return jsonify({"error": "Not found"}), 404

        title = (data.get("title") or ch["title"]).strip()
        description = (data.get("description") if "description" in data else ch["description"]) or ""
        unit = (data.get("unit") or ch["unit"]).strip()
        lower_is_better = data.get("lower_is_better", ch["lower_is_better"])
        start_date = data.get("start_date") or str(ch["start_date"])
        end_date = data.get("end_date") or str(ch["end_date"])
        duration_weeks = data.get("duration_weeks") if "duration_weeks" in data else ch.get("duration_weeks")

        sd = date.fromisoformat(start_date)
        ed = date.fromisoformat(end_date)
        status = _auto_status(sd, ed)

        cur.execute("""
            UPDATE challenges
            SET title = %s, description = %s, unit = %s, lower_is_better = %s,
                start_date = %s, end_date = %s, duration_weeks = %s, status = %s
            WHERE id = %s
            RETURNING *
        """, (title, description, unit, lower_is_better, str(sd), str(ed),
              duration_weeks, status, challenge_id))
        row = cur.fetchone()
        db.commit()
        return jsonify({"success": True, "challenge": row})
    finally:
        db.close()


@challenges_bp.route("/<challenge_id>", methods=["DELETE"])
@require_auth
def delete_challenge(challenge_id):
    user = request.current_user
    if user.get("role") not in ("admin", "coach"):
        return jsonify({"error": "Admin/coach only"}), 403

    db = get_db()
    try:
        cur = db.cursor()
        cur.execute("DELETE FROM challenges WHERE id = %s RETURNING id", (challenge_id,))
        row = cur.fetchone()
        db.commit()
        if not row:
            return jsonify({"error": "Not found"}), 404
        return jsonify({"success": True})
    finally:
        db.close()


@challenges_bp.route("/admin/list", methods=["GET"])
@require_auth
def admin_list():
    user = request.current_user
    if user.get("role") not in ("admin", "coach"):
        return jsonify({"error": "Admin/coach only"}), 403

    db = get_db()
    try:
        cur = db.cursor()
        cur.execute("""
            SELECT c.*,
                   (SELECT COUNT(DISTINCT user_id) FROM challenge_submissions WHERE challenge_id = c.id) AS participant_count
            FROM challenges c
            ORDER BY c.start_date DESC
        """)
        rows = cur.fetchall()
        for row in rows:
            row["status"] = _auto_status(row["start_date"], row["end_date"])
        return jsonify({"success": True, "challenges": rows})
    finally:
        db.close()


# ── Member endpoints ─────────────────────────────────────────────────

@challenges_bp.route("/active", methods=["GET"])
@require_auth
def active_challenge():
    user_id = request.current_user["user_id"]

    db = get_db()
    try:
        cur = db.cursor()
        cur.execute("SELECT email FROM users WHERE id = %s", (user_id,))
        u = cur.fetchone()
        if not u:
            return jsonify({"error": "User not found"}), 404
        user_email = u["email"].lower()

        today = date.today()
        cur.execute("""
            SELECT * FROM challenges
            WHERE start_date <= %s AND end_date >= %s
            ORDER BY start_date
            LIMIT 1
        """, (str(today), str(today)))
        challenge = cur.fetchone()

        if not challenge:
            cur.execute("""
                SELECT * FROM challenges
                WHERE start_date > %s
                ORDER BY start_date
                LIMIT 1
            """, (str(today),))
            upcoming = cur.fetchone()
            return jsonify({"success": True, "active": None, "upcoming": upcoming})

        lower = challenge["lower_is_better"]
        order = "ASC" if lower else "DESC"

        cur.execute(f"""
            SELECT DISTINCT ON (cs.user_id)
                   cs.user_id, cs.user_email, cs.value, u.first_name
            FROM challenge_submissions cs
            JOIN users u ON u.id = cs.user_id
            WHERE cs.challenge_id = %s
            ORDER BY cs.user_id, cs.value {'ASC' if lower else 'DESC'}
        """, (challenge["id"],))
        bests = cur.fetchall()
        bests.sort(key=lambda r: float(r["value"]), reverse=not lower)

        my_best = next((r for r in bests if r["user_email"].lower() == user_email), None)
        my_rank = None
        if my_best:
            my_rank = next(i + 1 for i, r in enumerate(bests) if r["user_id"] == my_best["user_id"])

        days_left = (challenge["end_date"] - today).days

        return jsonify({
            "success": True,
            "active": {
                "id": str(challenge["id"]),
                "title": challenge["title"],
                "description": challenge["description"],
                "unit": challenge["unit"],
                "lower_is_better": challenge["lower_is_better"],
                "start_date": str(challenge["start_date"]),
                "end_date": str(challenge["end_date"]),
                "days_left": days_left,
                "standings": [
                    {
                        "rank": i + 1,
                        "first_name": r["first_name"],
                        "score": float(r["value"]),
                        "is_me": r["user_email"].lower() == user_email,
                    }
                    for i, r in enumerate(bests[:10])
                ],
                "my_rank": my_rank,
                "my_score": float(my_best["value"]) if my_best else None,
                "total_participants": len(bests),
            },
            "upcoming": None,
        })
    finally:
        db.close()


@challenges_bp.route("/<challenge_id>/submit", methods=["POST"])
@require_auth
def submit_result(challenge_id):
    user_id = request.current_user["user_id"]
    data = request.get_json(silent=True) or {}
    value = data.get("value")
    notes = (data.get("notes") or "").strip()

    if value is None:
        return jsonify({"error": "value required"}), 400
    try:
        value = float(value)
    except (TypeError, ValueError):
        return jsonify({"error": "value must be a number"}), 400

    db = get_db()
    try:
        cur = db.cursor()

        cur.execute("SELECT email, grace_period_ends_at FROM users WHERE id = %s", (user_id,))
        u = cur.fetchone()
        if not u:
            return jsonify({"error": "User not found"}), 404

        cur.execute(
            "SELECT 1 FROM subscriptions WHERE user_id = %s AND status = 'active' LIMIT 1",
            (user_id,),
        )
        has_sub = cur.fetchone() is not None
        in_grace = False
        if u.get("grace_period_ends_at"):
            from datetime import datetime, timezone
            now = datetime.now(timezone.utc)
            grace_end = u["grace_period_ends_at"]
            if hasattr(grace_end, 'tzinfo') and grace_end.tzinfo is None:
                grace_end = grace_end.replace(tzinfo=timezone.utc)
            in_grace = now < grace_end
        is_coach = request.current_user.get("role") in ("coach", "admin")
        if not has_sub and not in_grace and not is_coach:
            return jsonify({
                "error": "Active subscription required to participate in challenges",
                "subscribe_url": "https://app.bestrongagain.com/register/GLENM7NUS?tier=basic",
            }), 403

        cur.execute("SELECT * FROM challenges WHERE id = %s", (challenge_id,))
        challenge = cur.fetchone()
        if not challenge:
            return jsonify({"error": "Challenge not found"}), 404

        today = date.today()
        if today < challenge["start_date"] or today > challenge["end_date"]:
            return jsonify({"error": "Challenge is not currently active"}), 400

        cur.execute("""
            INSERT INTO challenge_submissions (challenge_id, user_id, user_email, value, notes)
            VALUES (%s, %s, %s, %s, %s)
            RETURNING id, value, submitted_at
        """, (challenge_id, user_id, u["email"].lower(), value, notes))
        sub = cur.fetchone()
        db.commit()

        return jsonify({"success": True, "submission": sub})
    finally:
        db.close()


@challenges_bp.route("/<challenge_id>/standings", methods=["GET"])
@require_auth
def standings(challenge_id):
    db = get_db()
    try:
        cur = db.cursor()
        cur.execute("SELECT * FROM challenges WHERE id = %s", (challenge_id,))
        challenge = cur.fetchone()
        if not challenge:
            return jsonify({"error": "Not found"}), 404

        lower = challenge["lower_is_better"]

        cur.execute(f"""
            SELECT DISTINCT ON (cs.user_id)
                   cs.user_id, cs.user_email, cs.value, u.first_name, u.last_name
            FROM challenge_submissions cs
            JOIN users u ON u.id = cs.user_id
            WHERE cs.challenge_id = %s
            ORDER BY cs.user_id, cs.value {'ASC' if lower else 'DESC'}
        """, (challenge_id,))
        bests = cur.fetchall()
        bests.sort(key=lambda r: float(r["value"]), reverse=not lower)

        return jsonify({
            "success": True,
            "challenge": {
                "id": str(challenge["id"]),
                "title": challenge["title"],
                "unit": challenge["unit"],
                "lower_is_better": challenge["lower_is_better"],
            },
            "standings": [
                {
                    "rank": i + 1,
                    "first_name": r["first_name"],
                    "last_name": (r["last_name"] or "")[0] + "." if r.get("last_name") else "",
                    "score": float(r["value"]),
                }
                for i, r in enumerate(bests)
            ],
        })
    finally:
        db.close()


# ── Public: tracker fetches active challenge without JWT ──────────────

@challenges_bp.route("/all-public", methods=["GET"])
def all_public():
    """Returns all challenges (active + completed) with standings for the
    public landing page carousel. Most recent first."""
    db = get_db()
    try:
        cur = db.cursor()
        cur.execute("""
            SELECT * FROM challenges
            WHERE start_date <= CURRENT_DATE
            ORDER BY start_date DESC
        """)
        challenges = cur.fetchall()

        results = []
        for ch in challenges:
            lower = ch["lower_is_better"]
            cur.execute(f"""
                SELECT DISTINCT ON (cs.user_id)
                       cs.user_id, cs.user_email, cs.value, u.first_name
                FROM challenge_submissions cs
                JOIN users u ON u.id = cs.user_id
                WHERE cs.challenge_id = %s
                ORDER BY cs.user_id, cs.value {'ASC' if lower else 'DESC'}
            """, (ch["id"],))
            bests = cur.fetchall()
            bests.sort(key=lambda r: float(r["value"]), reverse=not lower)

            days_left = max(0, (ch["end_date"] - date.today()).days)
            status = _auto_status(ch["start_date"], ch["end_date"])

            results.append({
                "id": str(ch["id"]),
                "title": ch["title"],
                "description": ch["description"],
                "unit": ch["unit"],
                "lower_is_better": ch["lower_is_better"],
                "start_date": str(ch["start_date"]),
                "end_date": str(ch["end_date"]),
                "status": status,
                "days_left": days_left if status == "active" else None,
                "standings": [
                    {"rank": i + 1, "first_name": r["first_name"], "score": float(r["value"])}
                    for i, r in enumerate(bests[:10])
                ],
                "total_participants": len(bests),
            })

        return jsonify({"success": True, "challenges": results})
    finally:
        db.close()


@challenges_bp.route("/active-public", methods=["GET"])
def active_public():
    """Tracker calls this with ?email= to show the challenge card.
    No JWT needed (tracker uses email+code auth)."""
    email = (request.args.get("email") or "").lower().strip()

    db = get_db()
    try:
        cur = db.cursor()
        today = date.today()
        cur.execute("""
            SELECT * FROM challenges
            WHERE start_date <= %s AND end_date >= %s
            ORDER BY start_date LIMIT 1
        """, (str(today), str(today)))
        challenge = cur.fetchone()
        if not challenge:
            return jsonify({"success": True, "active": None})

        lower = challenge["lower_is_better"]

        cur.execute(f"""
            SELECT DISTINCT ON (cs.user_id)
                   cs.user_id, cs.user_email, cs.value, u.first_name
            FROM challenge_submissions cs
            JOIN users u ON u.id = cs.user_id
            WHERE cs.challenge_id = %s
            ORDER BY cs.user_id, cs.value {'ASC' if lower else 'DESC'}
        """, (challenge["id"],))
        bests = cur.fetchall()
        bests.sort(key=lambda r: float(r["value"]), reverse=not lower)

        my_best = next((r for r in bests if r["user_email"].lower() == email), None) if email else None
        my_rank = None
        if my_best:
            my_rank = next(i + 1 for i, r in enumerate(bests) if r["user_id"] == my_best["user_id"])

        days_left = (challenge["end_date"] - today).days

        return jsonify({
            "success": True,
            "active": {
                "id": str(challenge["id"]),
                "title": challenge["title"],
                "description": challenge["description"],
                "unit": challenge["unit"],
                "lower_is_better": challenge["lower_is_better"],
                "days_left": days_left,
                "standings": [
                    {"rank": i + 1, "first_name": r["first_name"], "score": float(r["value"])}
                    for i, r in enumerate(bests[:5])
                ],
                "my_rank": my_rank,
                "my_score": float(my_best["value"]) if my_best else None,
                "total_participants": len(bests),
            },
        })
    finally:
        db.close()


@challenges_bp.route("/submit-public", methods=["POST"])
def submit_public():
    """Tracker submits challenge results without JWT (uses email identity)."""
    data = request.get_json(silent=True) or {}
    email = (data.get("email") or "").lower().strip()
    challenge_id = data.get("challenge_id")
    value = data.get("value")
    notes = (data.get("notes") or "").strip()

    if not email or not challenge_id or value is None:
        return jsonify({"error": "email, challenge_id, value required"}), 400
    try:
        value = float(value)
    except (TypeError, ValueError):
        return jsonify({"error": "value must be a number"}), 400

    db = get_db()
    try:
        cur = db.cursor()
        cur.execute("SELECT id FROM users WHERE LOWER(email) = %s", (email,))
        u = cur.fetchone()
        if not u:
            return jsonify({"error": "User not found"}), 404

        cur.execute("SELECT * FROM challenges WHERE id = %s", (challenge_id,))
        challenge = cur.fetchone()
        if not challenge:
            return jsonify({"error": "Challenge not found"}), 404

        today = date.today()
        if today < challenge["start_date"] or today > challenge["end_date"]:
            return jsonify({"error": "Challenge is not currently active"}), 400

        cur.execute("""
            INSERT INTO challenge_submissions (challenge_id, user_id, user_email, value, notes)
            VALUES (%s, %s, %s, %s, %s)
            RETURNING id, value, submitted_at
        """, (challenge_id, u["id"], email, value, notes))
        sub = cur.fetchone()
        db.commit()

        return jsonify({"success": True, "submission": sub})
    finally:
        db.close()
