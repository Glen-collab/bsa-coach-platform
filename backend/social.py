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

from datetime import datetime, timezone
from flask import Blueprint, request, jsonify

# Sentinel used to sort friends with no message history to the bottom
# without tripping Python's TypeError on comparing None to a datetime.
_EPOCH = datetime(1970, 1, 1, tzinfo=timezone.utc)
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


@social_bp.route("/friends/search-by-name", methods=["GET"])
@require_auth
def friends_search_by_name():
    """Typeahead search by first or last name. Returns up to 10 matches
    with the caller's current friendship state for each (none /
    pending / accepted / declined / blocked) so the UI shows the right
    button: Add, Requested, Accept, or Friends. Powers the
    Instagram/Facebook-style "Add a friend" flow that replaces the old
    "type their exact email" input."""
    q = (request.args.get("q") or "").strip()
    if len(q) < 2:
        return jsonify({"matches": []})
    me = request.current_user["user_id"]
    db = get_db()
    try:
        cur = db.cursor()
        like = f"%{q}%"
        cur.execute("""
            SELECT u.id, u.first_name, u.last_name,
                   f.id            AS friendship_id,
                   f.status        AS friendship_status,
                   f.requester_id  AS friendship_requester
            FROM users u
            LEFT JOIN user_friendships f
              ON (f.requester_id = u.id AND f.recipient_id = %s)
              OR (f.recipient_id = u.id AND f.requester_id = %s)
            WHERE u.id <> %s
              AND u.role IN ('member', 'coach', 'admin')
              AND (LOWER(u.first_name) LIKE LOWER(%s) OR LOWER(u.last_name) LIKE LOWER(%s))
            ORDER BY u.first_name, u.last_name
            LIMIT 10
        """, (me, me, me, like, like))
        rows = cur.fetchall()
        for r in rows:
            r["waiting_on_you"] = (
                r.get("friendship_status") == "pending"
                and str(r.get("friendship_requester") or "") != str(me)
            )
            r.pop("friendship_requester", None)
        return jsonify({"matches": rows})
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
        # Accepted friends (either side). DISTINCT ON (u.id) collapses the
        # case where both directions of the pair exist as separate rows
        # (broadcast used to insert (me, rid) AND (rid, me), so each friend
        # appeared twice in the list).
        cur.execute("""
            SELECT DISTINCT ON (u.id)
                   f.id AS friendship_id, f.status, f.accepted_at,
                   u.id, u.first_name, u.last_name, u.email
            FROM user_friendships f
            JOIN users u ON u.id = CASE
                WHEN f.requester_id = %s THEN f.recipient_id
                ELSE f.requester_id
            END
            WHERE (f.requester_id = %s OR f.recipient_id = %s)
              AND f.status = 'accepted'
            ORDER BY u.id, f.accepted_at NULLS LAST
        """, (me, me, me))
        friends = cur.fetchall()
        friends.sort(key=lambda r: (r.get("first_name") or "").lower())
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

        # Last-message preview per friend so the friend list reads like
        # an Instagram/Facebook DM inbox: "Steve Smith — Hey buddy what's
        # up?" instead of bare names with no context for who said what.
        # Picks the most-recent message in either direction.
        last_by = {}
        if friend_ids:
            cur.execute("""
                SELECT DISTINCT ON (other_id)
                       other_id,
                       body,
                       sent_at,
                       from_user_id = %s AS from_me,
                       is_broadcast
                FROM (
                    SELECT
                        CASE WHEN from_user_id = %s THEN to_user_id ELSE from_user_id END AS other_id,
                        body, sent_at, from_user_id, is_broadcast
                    FROM user_messages
                    WHERE (from_user_id = %s AND to_user_id = ANY(%s::uuid[]))
                       OR (to_user_id   = %s AND from_user_id = ANY(%s::uuid[]))
                ) sub
                ORDER BY other_id, sent_at DESC
            """, (me, me, me, friend_ids, me, friend_ids))
            for r in cur.fetchall():
                last_by[str(r["other_id"])] = {
                    "preview": (r["body"] or "")[:120],
                    "sent_at": r["sent_at"],
                    "from_me": r["from_me"],
                    "is_broadcast": r["is_broadcast"],
                }

        # Latest program name per friend — surfaced on the inbox row as
        # "Name (Program)" bait so the user can see what each friend is
        # training without opening the thread. Pulled from each friend's
        # most-recent workout_logs row (which stores program_name).
        prog_by = {}
        emails_lc = [(f.get("email") or "").lower() for f in friends if f.get("email")]
        if emails_lc:
            cur.execute("""
                SELECT DISTINCT ON (LOWER(user_email))
                       LOWER(user_email) AS email_lc, program_name
                FROM workout_logs
                WHERE LOWER(user_email) = ANY(%s::text[])
                ORDER BY LOWER(user_email), workout_date DESC, id DESC
            """, (emails_lc,))
            prog_by_email = {r["email_lc"]: r["program_name"] for r in cur.fetchall()}
            for f in friends:
                e = (f.get("email") or "").lower()
                if e and prog_by_email.get(e):
                    prog_by[str(f["id"])] = prog_by_email[e]

        for f in friends:
            f["unread"] = unread_by.get(str(f["id"]), 0)
            f["last_message"] = last_by.get(str(f["id"]))
            f["program_name"] = prog_by.get(str(f["id"]))
        # Show friends with the freshest message at the top — recent
        # conversations first, alphabetical for friends with no history.
        # Python sort is stable, so a name-first sort followed by a
        # recency sort puts conversations in DESC time order and leaves
        # the rest alphabetical underneath.
        friends.sort(key=lambda r: (r.get("first_name") or "").lower())
        friends.sort(
            key=lambda r: (r.get("last_message") or {}).get("sent_at") or _EPOCH,
            reverse=True,
        )
        return jsonify({"friends": friends, "incoming": incoming})
    finally:
        db.close()


# ── Messages ─────────────────────────────────────────────────────────
@social_bp.route("/messages/unread-count", methods=["GET"])
@require_auth
def unread_count():
    """For the red-dot badge. Returns unread messages, pending incoming
    friend requests, and the total (sum). The chat bubble shows `total`
    so a friend request shows up the same way an unread DM does."""
    me = request.current_user["user_id"]
    db = get_db()
    try:
        cur = db.cursor()
        cur.execute(
            "SELECT COUNT(*) AS n FROM user_messages WHERE to_user_id = %s AND read_at IS NULL",
            (me,),
        )
        unread = cur.fetchone()["n"]
        cur.execute(
            "SELECT COUNT(*) AS n FROM user_friendships WHERE recipient_id = %s AND status = 'pending'",
            (me,),
        )
        pending = cur.fetchone()["n"]
        return jsonify({
            "unread": unread,
            "pending_requests": pending,
            "total": unread + pending,
        })
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


# ═══════════════════════════════════════════════════════════════════════════════
# COACH BROADCAST — send one message to all of a coach's clients at once.
# Audience = union of (referred members) + (tracker users on coach's programs
# who have an account). Each recipient gets an auto-accepted friendship with
# the coach so they can reply in-thread.
# ═══════════════════════════════════════════════════════════════════════════════
import uuid as _uuid


def _coach_client_ids(cur, coach_id, coach_email, tier=None):
    """Return a set of user UUIDs that count as this coach's clients.
    Includes every direct referral (members + coaches in their immediate
    downline) + tracker users on the coach's programs.

    tier: optional. When set (e.g. 'tracker' for the $5.99 crew), the result is
    narrowed to clients whose most relevant active subscription is that tier —
    lets the coach text just that group."""
    ids = set()
    # 1. Direct referrals — members AND coaches (immediate downline)
    cur.execute(
        "SELECT id FROM users WHERE referred_by_id = %s AND is_active = TRUE AND role IN ('member','coach')",
        (coach_id,),
    )
    for r in cur.fetchall():
        ids.add(str(r["id"]))

    # 2. Workout tracker users on this coach's programs (by user_email)
    if coach_email:
        cur.execute(
            """
            SELECT DISTINCT u.id
            FROM users u
            WHERE u.is_active = TRUE AND u.id != %s
              AND LOWER(u.email) IN (
                SELECT DISTINCT LOWER(up.user_email)
                FROM workout_user_position up
                JOIN workout_programs p ON up.access_code = p.access_code
                WHERE LOWER(p.user_email) = LOWER(%s)
                   OR LOWER(p.optional_trainer_email) = LOWER(%s)
            )
            """,
            (coach_id, coach_email, coach_email),
        )
        for r in cur.fetchall():
            ids.add(str(r["id"]))

    # Optional tier narrowing (e.g. only the $5.99 'tracker' crew).
    if tier and ids:
        cur.execute(
            "SELECT DISTINCT user_id FROM subscriptions "
            "WHERE status = 'active' AND tier = %s AND user_id = ANY(%s::uuid[])",
            (tier, list(ids)),
        )
        keep = {str(r["user_id"]) for r in cur.fetchall()}
        ids = ids & keep
    return ids


def _audience_tier(req):
    """Map the request's 'audience' param to a tier filter. 'tracker' -> the
    $5.99 crew; anything else (or 'all') -> no filter."""
    aud = (req.args.get("audience") if req.method == "GET"
           else (req.get_json(silent=True) or {}).get("audience")) or "all"
    return "tracker" if aud == "tracker" else None


@social_bp.route("/broadcast/audience", methods=["GET"])
@require_auth
def broadcast_audience():
    """Preview: how many clients would this coach reach right now?"""
    me = request.current_user["user_id"]
    db = get_db()
    try:
        cur = db.cursor()
        cur.execute("SELECT email, role FROM users WHERE id = %s", (me,))
        row = cur.fetchone()
        if not row or row["role"] not in ("coach", "admin"):
            return jsonify({"count": 0, "error": "Coaches only"}), 403
        ids = _coach_client_ids(cur, me, row["email"], tier=_audience_tier(request))
        return jsonify({"count": len(ids)})
    finally:
        db.close()


@social_bp.route("/broadcast", methods=["POST"])
@require_auth
def broadcast_send():
    """Body: { body: "message text" }
    Delivers to every client the coach has; auto-accepts friendship so they can reply."""
    me = request.current_user["user_id"]
    data = request.get_json(silent=True) or {}
    body = (data.get("body") or "").strip()
    if not body:
        return jsonify({"error": "Message body required"}), 400
    if len(body) > 2000:
        return jsonify({"error": "Message too long (max 2000 chars)"}), 400

    db = get_db()
    try:
        cur = db.cursor()
        cur.execute("SELECT email, role FROM users WHERE id = %s", (me,))
        row = cur.fetchone()
        if not row or row["role"] not in ("coach", "admin"):
            return jsonify({"error": "Coaches only"}), 403

        recipient_ids = _coach_client_ids(cur, me, row["email"], tier=_audience_tier(request))
        if not recipient_ids:
            return jsonify({"success": True, "sent": 0, "message": "No clients with accounts yet."})

        batch_id = str(_uuid.uuid4())
        sent = 0
        for rid in recipient_ids:
            # Auto-accepted friendship so the recipient can reply later
            cur.execute(
                """
                INSERT INTO user_friendships (requester_id, recipient_id, status, accepted_at)
                VALUES (%s, %s, 'accepted', NOW())
                ON CONFLICT (requester_id, recipient_id) DO UPDATE SET
                    status = CASE WHEN user_friendships.status IN ('declined','blocked') THEN user_friendships.status ELSE 'accepted' END,
                    accepted_at = COALESCE(user_friendships.accepted_at, NOW()),
                    updated_at = NOW()
                """,
                (me, rid),
            )
            # Reverse-direction row used to be inserted here so the list
            # query found the pair either way, but /friends/list's WHERE
            # already handles "requester_id = me OR recipient_id = me".
            # Inserting the reverse just produced duplicates in the UI.
            # Insert the message itself
            cur.execute(
                """
                INSERT INTO user_messages (from_user_id, to_user_id, body, is_broadcast, broadcast_batch_id)
                VALUES (%s, %s, %s, TRUE, %s)
                """,
                (me, rid, body, batch_id),
            )
            sent += 1
        db.commit()
        return jsonify({"success": True, "sent": sent, "batch_id": batch_id})
    finally:
        db.close()


# ── Friend stats (sneak preview) ──────────────────────────────────────────────
# Returns aggregated workout volume for an accepted friend — TODAY + last 7
# days. Lightweight competitive social signal ("are they working harder than
# me?") without exposing exercise-level detail (which is too granular for a
# member-to-member surface). Auth: must be accepted-friend in both directions.

@social_bp.route("/friend-stats/<friend_user_id>", methods=["GET"])
@require_auth
def friend_stats(friend_user_id):
    me = request.current_user["user_id"]
    if str(me) == str(friend_user_id):
        return jsonify({"error": "Can't peek at your own stats this way"}), 400

    db = get_db()
    try:
        cur = db.cursor()
        # Friendship gate
        cur.execute(
            """
            SELECT 1 FROM user_friendships
            WHERE status = 'accepted'
              AND ((requester_id = %s AND recipient_id = %s)
                OR (requester_id = %s AND recipient_id = %s))
            LIMIT 1
            """,
            (me, friend_user_id, friend_user_id, me),
        )
        if not cur.fetchone():
            return jsonify({"error": "Not friends"}), 403

        cur.execute("SELECT email, first_name FROM users WHERE id = %s", (friend_user_id,))
        row = cur.fetchone()
        if not row:
            return jsonify({"error": "User not found"}), 404
        friend_email = row["email"]
        first_name   = row["first_name"]

        def aggregate(where_clause):
            cur.execute(
                f"""
                SELECT COUNT(*)::int                                              AS sessions,
                       COALESCE(SUM((volume_stats->>'tonnage')::numeric), 0)::int        AS tonnage,
                       COALESCE(SUM((volume_stats->>'est_calories')::numeric), 0)::int   AS calories,
                       COALESCE(SUM((volume_stats->>'cardio_minutes')::numeric), 0)::int AS cardio_min,
                       COALESCE(SUM((volume_stats->>'core_crunches')::numeric), 0)::int  AS core_reps,
                       MAX(created_at)                                                   AS last_logged_at
                FROM workout_logs
                WHERE LOWER(user_email) = LOWER(%s) AND {where_clause}
                """,
                (friend_email,),
            )
            return cur.fetchone()

        today = aggregate("workout_date = CURRENT_DATE")
        week  = aggregate("workout_date >= CURRENT_DATE - INTERVAL '7 days'")

        # Most recently-logged bodyweight from the tracker's weight tile —
        # surfaces as a single "latest weight" line on the friend's sneak
        # peek. Optional: returns null if friend never logs weight.
        cur.execute(
            """
            SELECT body_weight_lbs, workout_date
            FROM workout_logs
            WHERE LOWER(user_email) = LOWER(%s) AND body_weight_lbs IS NOT NULL
            ORDER BY workout_date DESC, created_at DESC
            LIMIT 1
            """,
            (friend_email,),
        )
        bw_row = cur.fetchone()
        latest_weight = None
        if bw_row and bw_row.get("body_weight_lbs") is not None:
            latest_weight = {
                "weight_lbs": float(bw_row["body_weight_lbs"]),
                "logged_on":  bw_row["workout_date"].isoformat() if bw_row["workout_date"] else None,
            }

        def shape(row_):
            return {
                "sessions":   row_["sessions"],
                "tonnage":    row_["tonnage"],
                "calories":   row_["calories"],
                "cardio_min": row_["cardio_min"],
                "core_reps":  row_["core_reps"],
                "last_logged_at": row_["last_logged_at"].isoformat() if row_["last_logged_at"] else None,
            }

        return jsonify({
            "first_name": first_name,
            "today": shape(today),
            "week":  shape(week),
            "latest_weight": latest_weight,
        })
    finally:
        db.close()
