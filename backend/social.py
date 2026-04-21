"""
social.py — friend-only direct messaging for the workout tracker.

Flow:
  1. User enters a friend's email → POST /friends/request  (creates row, status=pending)
  2. Friend opens app, sees pending request → POST /friends/accept (→ accepted)
  3. Either friend POSTs /messages/send, other sees it on next poll
  4. Frontend polls /messages/unread-count every 30s for the red-dot badge

Tracker (PWA) doesn't have JWTs — it authenticates by email + access code. For
messaging we need a proper identity, so friends/messaging endpoints require a
JWT from the coach platform. Tracker users who want messaging must sign up on
app.bestrongagain.com (most already do via the coach referral flow).
"""

from flask import Blueprint, request, jsonify
from psycopg2.extras import RealDictCursor
import psycopg2
import os

from auth import require_auth

social_bp = Blueprint("social", __name__)


def get_db():
    return psycopg2.connect(os.environ.get("DATABASE_URL"), cursor_factory=RealDictCursor)


def _consent_required(user_id, db):
    """Return True if user still needs to accept the messaging disclosure."""
    cur = db.cursor()
    cur.execute("SELECT messaging_consent_at FROM users WHERE id = %s", (user_id,))
    row = cur.fetchone()
    return not (row and row["messaging_consent_at"])


# ── Consent ───────────────────────────────────────────────────────────
@social_bp.route("/consent/status", methods=["GET"])
@require_auth
def consent_status():
    """Returns whether the user has accepted the messaging disclosure."""
    user_id = request.current_user["user_id"]
    db = get_db()
    try:
        cur = db.cursor()
        cur.execute("SELECT messaging_consent_at FROM users WHERE id = %s", (user_id,))
        row = cur.fetchone() or {}
        return jsonify({
            "accepted": bool(row.get("messaging_consent_at")),
            "accepted_at": row.get("messaging_consent_at"),
        })
    finally:
        db.close()


@social_bp.route("/consent/accept", methods=["POST"])
@require_auth
def consent_accept():
    user_id = request.current_user["user_id"]
    db = get_db()
    try:
        cur = db.cursor()
        cur.execute(
            "UPDATE users SET messaging_consent_at = NOW() WHERE id = %s RETURNING messaging_consent_at",
            (user_id,),
        )
        row = cur.fetchone()
        db.commit()
        return jsonify({"success": True, "accepted_at": row["messaging_consent_at"]})
    finally:
        db.close()


# ── Friend search / request / accept / list ──────────────────────────
@social_bp.route("/friends/search", methods=["GET"])
@require_auth
def friends_search():
    """Find a user by email so you can send them a friend request."""
    email = (request.args.get("email") or "").strip().lower()
    if "@" not in email:
        return jsonify({"error": "Valid email required"}), 400
    me = request.current_user["user_id"]
    db = get_db()
    try:
        cur = db.cursor()
        cur.execute(
            "SELECT id, first_name, last_name, email FROM users WHERE LOWER(email) = %s AND id <> %s",
            (email, me),
        )
        row = cur.fetchone()
        if not row:
            return jsonify({"found": False})
        return jsonify({"found": True, "user": row})
    finally:
        db.close()


@social_bp.route("/friends/request", methods=["POST"])
@require_auth
def friends_request():
    """Body: { user_id: <friend's uuid> }  OR  { email: 'x@y.com' }."""
    me = request.current_user["user_id"]
    data = request.get_json(silent=True) or {}
    target_id = data.get("user_id")
    target_email = (data.get("email") or "").strip().lower()
    db = get_db()
    try:
        cur = db.cursor()
        if _consent_required(me, db):
            return jsonify({"error": "Messaging consent required first", "code": "consent_required"}), 403
        # Resolve by email if ID not provided
        if not target_id and target_email:
            cur.execute("SELECT id FROM users WHERE LOWER(email) = %s", (target_email,))
            row = cur.fetchone()
            if not row:
                return jsonify({"error": "No account with that email"}), 404
            target_id = row["id"]
        if not target_id:
            return jsonify({"error": "user_id or email required"}), 400
        if str(target_id) == str(me):
            return jsonify({"error": "Can't friend yourself"}), 400

        # Check existing
        cur.execute("""
            SELECT id, status, requester_id FROM user_friendships
            WHERE (requester_id = %s AND recipient_id = %s)
               OR (requester_id = %s AND recipient_id = %s)
        """, (me, target_id, target_id, me))
        existing = cur.fetchone()
        if existing:
            return jsonify({
                "success": True,
                "already_exists": True,
                "status": existing["status"],
                "waiting_on_you": str(existing["requester_id"]) != str(me) and existing["status"] == "pending",
            })

        cur.execute("""
            INSERT INTO user_friendships (requester_id, recipient_id)
            VALUES (%s, %s)
            RETURNING id, status, requested_at
        """, (me, target_id))
        row = cur.fetchone()
        db.commit()
        return jsonify({"success": True, "friendship": row})
    finally:
        db.close()


@social_bp.route("/friends/respond", methods=["POST"])
@require_auth
def friends_respond():
    """Body: { friendship_id, action: 'accept'|'decline'|'block' }"""
    me = request.current_user["user_id"]
    data = request.get_json(silent=True) or {}
    fid = data.get("friendship_id")
    action = data.get("action")
    if not fid or action not in ("accept", "decline", "block"):
        return jsonify({"error": "friendship_id + valid action required"}), 400
    new_status = {"accept": "accepted", "decline": "declined", "block": "blocked"}[action]
    db = get_db()
    try:
        cur = db.cursor()
        cur.execute("""
            UPDATE user_friendships
            SET status = %s,
                accepted_at = CASE WHEN %s = 'accepted' THEN NOW() ELSE accepted_at END,
                updated_at = NOW()
            WHERE id = %s AND recipient_id = %s AND status = 'pending'
            RETURNING id, status
        """, (new_status, new_status, fid, me))
        row = cur.fetchone()
        db.commit()
        if not row:
            return jsonify({"error": "Request not found or not addressed to you"}), 404
        return jsonify({"success": True, "friendship": row})
    finally:
        db.close()


@social_bp.route("/friends/list", methods=["GET"])
@require_auth
def friends_list():
    """Returns accepted friends + incoming pending requests."""
    me = request.current_user["user_id"]
    db = get_db()
    try:
        cur = db.cursor()
        # Accepted friends (either side)
        cur.execute("""
            SELECT f.id AS friendship_id, f.status, f.accepted_at,
                   u.id, u.first_name, u.last_name, u.email
            FROM user_friendships f
            JOIN users u ON u.id = CASE
                WHEN f.requester_id = %s THEN f.recipient_id
                ELSE f.requester_id
            END
            WHERE (f.requester_id = %s OR f.recipient_id = %s)
              AND f.status = 'accepted'
            ORDER BY u.first_name
        """, (me, me, me))
        friends = cur.fetchall()
        # Incoming pending requests
        cur.execute("""
            SELECT f.id AS friendship_id, f.requested_at,
                   u.id, u.first_name, u.last_name, u.email
            FROM user_friendships f
            JOIN users u ON u.id = f.requester_id
            WHERE f.recipient_id = %s AND f.status = 'pending'
            ORDER BY f.requested_at DESC
        """, (me,))
        incoming = cur.fetchall()
        # Unread count per friend (from_user grouped)
        friend_ids = [str(f["id"]) for f in friends]
        unread_by = {}
        if friend_ids:
            cur.execute("""
                SELECT from_user_id, COUNT(*) AS n FROM user_messages
                WHERE to_user_id = %s AND read_at IS NULL
                  AND from_user_id = ANY(%s::uuid[])
                GROUP BY from_user_id
            """, (me, friend_ids))
            for r in cur.fetchall():
                unread_by[str(r["from_user_id"])] = r["n"]
        for f in friends:
            f["unread"] = unread_by.get(str(f["id"]), 0)
        return jsonify({"friends": friends, "incoming": incoming})
    finally:
        db.close()


# ── Messages ─────────────────────────────────────────────────────────
@social_bp.route("/messages/unread-count", methods=["GET"])
@require_auth
def unread_count():
    """For the red-dot badge. Returns total unread messages TO me."""
    me = request.current_user["user_id"]
    db = get_db()
    try:
        cur = db.cursor()
        cur.execute("SELECT COUNT(*) AS n FROM user_messages WHERE to_user_id = %s AND read_at IS NULL", (me,))
        return jsonify({"unread": cur.fetchone()["n"]})
    finally:
        db.close()


def _are_friends(me, other, cur):
    cur.execute("""
        SELECT 1 FROM user_friendships
        WHERE status = 'accepted'
          AND ((requester_id = %s AND recipient_id = %s)
               OR (requester_id = %s AND recipient_id = %s))
    """, (me, other, other, me))
    return cur.fetchone() is not None


@social_bp.route("/messages/send", methods=["POST"])
@require_auth
def messages_send():
    """Body: { to_user_id, body }"""
    me = request.current_user["user_id"]
    data = request.get_json(silent=True) or {}
    to = data.get("to_user_id")
    body = (data.get("body") or "").strip()
    if not to or not body:
        return jsonify({"error": "to_user_id + body required"}), 400
    if len(body) > 2000:
        return jsonify({"error": "Message too long (max 2000 chars)"}), 400
    db = get_db()
    try:
        cur = db.cursor()
        if _consent_required(me, db):
            return jsonify({"error": "Messaging consent required first", "code": "consent_required"}), 403
        if not _are_friends(me, to, cur):
            return jsonify({"error": "You can only message accepted friends"}), 403
        cur.execute("""
            INSERT INTO user_messages (from_user_id, to_user_id, body)
            VALUES (%s, %s, %s)
            RETURNING id, from_user_id, to_user_id, body, sent_at, read_at
        """, (me, to, body))
        row = cur.fetchone()
        db.commit()
        return jsonify({"success": True, "message": row})
    finally:
        db.close()


@social_bp.route("/messages/thread/<friend_id>", methods=["GET"])
@require_auth
def messages_thread(friend_id):
    """
    Returns the chronological thread between me and a specific friend.
    Query params: ?since=<iso timestamp> to get only newer messages (polling optimization).
    """
    me = request.current_user["user_id"]
    since = request.args.get("since")
    db = get_db()
    try:
        cur = db.cursor()
        if not _are_friends(me, friend_id, cur):
            return jsonify({"error": "Not friends with this user"}), 403
        if since:
            cur.execute("""
                SELECT id, from_user_id, to_user_id, body, sent_at, read_at
                FROM user_messages
                WHERE ((from_user_id = %s AND to_user_id = %s)
                    OR (from_user_id = %s AND to_user_id = %s))
                  AND sent_at > %s::timestamptz
                ORDER BY sent_at ASC
                LIMIT 200
            """, (me, friend_id, friend_id, me, since))
        else:
            cur.execute("""
                SELECT id, from_user_id, to_user_id, body, sent_at, read_at
                FROM user_messages
                WHERE (from_user_id = %s AND to_user_id = %s)
                   OR (from_user_id = %s AND to_user_id = %s)
                ORDER BY sent_at ASC
                LIMIT 200
            """, (me, friend_id, friend_id, me))
        messages = cur.fetchall()
        return jsonify({"messages": messages, "count": len(messages)})
    finally:
        db.close()


@social_bp.route("/messages/mark-read", methods=["POST"])
@require_auth
def messages_mark_read():
    """Body: { friend_id } — marks all messages from this friend to me as read."""
    me = request.current_user["user_id"]
    data = request.get_json(silent=True) or {}
    friend_id = data.get("friend_id")
    if not friend_id:
        return jsonify({"error": "friend_id required"}), 400
    db = get_db()
    try:
        cur = db.cursor()
        cur.execute("""
            UPDATE user_messages SET read_at = NOW()
            WHERE to_user_id = %s AND from_user_id = %s AND read_at IS NULL
        """, (me, friend_id))
        db.commit()
        return jsonify({"success": True, "marked_read": cur.rowcount})
    finally:
        db.close()


# ── Admin: message oversight ─────────────────────────────────────────
from functools import wraps

def require_admin(f):
    @wraps(f)
    def decorated(*args, **kwargs):
        user = getattr(request, "current_user", None)
        if not user or user.get("role") != "admin":
            return jsonify({"error": "Admin access required"}), 403
        return f(*args, **kwargs)
    return decorated


@social_bp.route("/admin/messages", methods=["GET"])
@require_auth
@require_admin
def admin_recent_messages():
    """Admin oversight view: recent messages across all users.
    Query params: ?limit=200&user_id=<uuid>"""
    limit = min(int(request.args.get("limit", 200)), 1000)
    filter_user = request.args.get("user_id")
    db = get_db()
    try:
        cur = db.cursor()
        if filter_user:
            cur.execute("""
                SELECT m.id, m.body, m.sent_at, m.read_at,
                       m.from_user_id, uf.first_name AS from_first, uf.last_name AS from_last, uf.email AS from_email,
                       m.to_user_id,   ut.first_name AS to_first,   ut.last_name AS to_last,   ut.email AS to_email
                FROM user_messages m
                JOIN users uf ON uf.id = m.from_user_id
                JOIN users ut ON ut.id = m.to_user_id
                WHERE m.from_user_id = %s OR m.to_user_id = %s
                ORDER BY m.sent_at DESC LIMIT %s
            """, (filter_user, filter_user, limit))
        else:
            cur.execute("""
                SELECT m.id, m.body, m.sent_at, m.read_at,
                       m.from_user_id, uf.first_name AS from_first, uf.last_name AS from_last, uf.email AS from_email,
                       m.to_user_id,   ut.first_name AS to_first,   ut.last_name AS to_last,   ut.email AS to_email
                FROM user_messages m
                JOIN users uf ON uf.id = m.from_user_id
                JOIN users ut ON ut.id = m.to_user_id
                ORDER BY m.sent_at DESC LIMIT %s
            """, (limit,))
        rows = cur.fetchall()
        return jsonify({"messages": rows, "count": len(rows)})
    finally:
        db.close()
