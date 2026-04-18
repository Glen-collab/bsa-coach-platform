"""
media.py — Coach video/audio upload endpoints.

Routes (all under /api/media via blueprint registration in app.py):
  POST  /upload-url       — mint Cloudflare Direct Creator Upload URL (auth)
  POST  /register         — record completed upload in trainer_media (auth)
  GET   /my-uploads       — list this coach's uploads (auth)
  POST  /delete           — soft-delete an upload (status='removed') (auth)
  GET   /admin/all        — admin "All Coach Uploads" feed (auth + admin role)
  POST  /admin/feature    — toggle featured_global on a row (auth + admin role)
  POST  /admin/flag       — set status='flagged' (auth + admin role)
"""

from flask import Blueprint, request, jsonify
from psycopg2.extras import RealDictCursor
from functools import wraps
import psycopg2
import requests
import os

from auth import require_auth

media_bp = Blueprint("media", __name__)


def get_db():
    return psycopg2.connect(os.environ.get("DATABASE_URL"), cursor_factory=RealDictCursor)


def require_admin(f):
    """Decorator: must be authenticated AND role='admin'."""
    @wraps(f)
    def decorated(*args, **kwargs):
        user = getattr(request, "current_user", None)
        if not user or user.get("role") != "admin":
            return jsonify({"error": "Admin access required"}), 403
        return f(*args, **kwargs)
    return decorated


# ── 1. Mint Cloudflare Direct Creator Upload URL ───────────────────────
@media_bp.route("/upload-url", methods=["POST"])
@require_auth
def mint_upload_url():
    """
    Body: { "media_type": "video", "max_duration_seconds": 600 }

    Returns: { "uploadURL": "<one-time URL>", "uid": "<future cloudflare uid>" }

    Browser PUTs the file bytes to uploadURL. After upload, browser calls
    /api/media/register with the uid + exercise metadata.
    """
    data = request.get_json(silent=True) or {}
    media_type = data.get("media_type", "video")

    if media_type != "video":
        # Audio (R2) path will land here in a follow-up; not wired yet.
        return jsonify({"error": "Only video uploads supported in this version"}), 400

    account_id = os.environ.get("CLOUDFLARE_ACCOUNT_ID")
    token = os.environ.get("CLOUDFLARE_API_TOKEN")
    if not account_id or not token:
        return jsonify({"error": "Cloudflare not configured on server"}), 500

    max_dur = int(data.get("max_duration_seconds", 600))  # 10-min cap
    cf_resp = requests.post(
        f"https://api.cloudflare.com/client/v4/accounts/{account_id}/stream/direct_upload",
        headers={"Authorization": f"Bearer {token}"},
        json={"maxDurationSeconds": max_dur},
        timeout=15,
    )
    if cf_resp.status_code != 200:
        return jsonify({
            "error": "Cloudflare rejected upload-url request",
            "status": cf_resp.status_code,
            "details": cf_resp.text[:300],
        }), 502

    cf = cf_resp.json()
    if not cf.get("success"):
        return jsonify({"error": "Cloudflare API error", "details": cf.get("errors")}), 502

    return jsonify({
        "uploadURL": cf["result"]["uploadURL"],
        "uid": cf["result"]["uid"],
    })


# ── 2. Register a completed upload in trainer_media ────────────────────
@media_bp.route("/register", methods=["POST"])
@require_auth
def register_upload():
    """
    Body: {
      exercise_name, category, subcategory, source_library,
      media_type, cloudflare_uid (or storage_key for audio),
      duration_seconds (optional)
    }

    Inserts or updates (re-upload replaces) the trainer_media row for this trainer.
    UNIQUE (trainer_id, exercise_name, media_type) drives the upsert.
    """
    user = request.current_user
    trainer_id = user["user_id"]
    data = request.get_json(silent=True) or {}

    required = ["exercise_name", "media_type", "source_library"]
    for k in required:
        if not data.get(k):
            return jsonify({"error": f"Missing field: {k}"}), 400

    media_type = data["media_type"]
    if media_type not in ("video", "audio"):
        return jsonify({"error": "media_type must be 'video' or 'audio'"}), 400

    cloudflare_uid = data.get("cloudflare_uid") if media_type == "video" else None
    storage_key = data.get("storage_key") if media_type == "audio" else None
    if media_type == "video" and not cloudflare_uid:
        return jsonify({"error": "video uploads require cloudflare_uid"}), 400
    if media_type == "audio" and not storage_key:
        return jsonify({"error": "audio uploads require storage_key"}), 400

    db = get_db()
    try:
        cur = db.cursor()
        cur.execute("""
            INSERT INTO trainer_media
              (trainer_id, exercise_name, category, source_library, media_type,
               cloudflare_uid, storage_key, duration_seconds)
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
            ON CONFLICT (trainer_id, exercise_name, media_type) DO UPDATE SET
              category = EXCLUDED.category,
              source_library = EXCLUDED.source_library,
              cloudflare_uid = EXCLUDED.cloudflare_uid,
              storage_key = EXCLUDED.storage_key,
              duration_seconds = EXCLUDED.duration_seconds,
              status = 'live',
              uploaded_at = NOW()
            RETURNING id, exercise_name, media_type, cloudflare_uid, storage_key,
                      status, uploaded_at;
        """, (
            trainer_id,
            data["exercise_name"],
            data.get("category"),
            data["source_library"],
            media_type,
            cloudflare_uid,
            storage_key,
            data.get("duration_seconds"),
        ))
        row = cur.fetchone()
        db.commit()
        return jsonify({"success": True, "media": row})
    except Exception as e:
        db.rollback()
        return jsonify({"error": str(e)}), 500
    finally:
        db.close()


# ── 3. Coach's own uploads ─────────────────────────────────────────────
@media_bp.route("/my-uploads", methods=["GET"])
@require_auth
def my_uploads():
    user = request.current_user
    trainer_id = user["user_id"]
    db = get_db()
    try:
        cur = db.cursor()
        cur.execute("""
            SELECT id, exercise_name, category, source_library, media_type,
                   cloudflare_uid, storage_key, duration_seconds, status,
                   featured_global, uploaded_at
            FROM trainer_media
            WHERE trainer_id = %s AND status != 'removed'
            ORDER BY uploaded_at DESC
        """, (trainer_id,))
        rows = cur.fetchall()
        return jsonify({"uploads": rows, "count": len(rows)})
    finally:
        db.close()


# ── 4. Soft-delete ─────────────────────────────────────────────────────
@media_bp.route("/delete", methods=["POST"])
@require_auth
def soft_delete():
    """Body: { exercise_name, media_type }. Sets status='removed'."""
    user = request.current_user
    trainer_id = user["user_id"]
    data = request.get_json(silent=True) or {}
    name = data.get("exercise_name")
    mtype = data.get("media_type")
    if not name or not mtype:
        return jsonify({"error": "exercise_name and media_type required"}), 400
    db = get_db()
    try:
        cur = db.cursor()
        cur.execute("""
            UPDATE trainer_media
            SET status = 'removed'
            WHERE trainer_id = %s AND exercise_name = %s AND media_type = %s
            RETURNING id;
        """, (trainer_id, name, mtype))
        row = cur.fetchone()
        db.commit()
        if not row:
            return jsonify({"error": "Not found"}), 404
        return jsonify({"success": True, "id": row["id"]})
    finally:
        db.close()


# ── 5. Admin feed ──────────────────────────────────────────────────────
@media_bp.route("/admin/all", methods=["GET"])
@require_auth
@require_admin
def admin_all_uploads():
    """Query params: ?status=live|flagged|removed (optional), ?coach=<uuid> (optional)."""
    status = request.args.get("status")
    coach = request.args.get("coach")
    db = get_db()
    try:
        cur = db.cursor()
        sql = """
            SELECT m.id, m.trainer_id, u.first_name, u.last_name, u.email,
                   m.exercise_name, m.category, m.source_library, m.media_type,
                   m.cloudflare_uid, m.storage_key, m.status, m.featured_global,
                   m.uploaded_at
            FROM trainer_media m
            JOIN users u ON u.id = m.trainer_id
            WHERE 1=1
        """
        params = []
        if status:
            sql += " AND m.status = %s"
            params.append(status)
        if coach:
            sql += " AND m.trainer_id = %s"
            params.append(coach)
        sql += " ORDER BY m.uploaded_at DESC LIMIT 500"
        cur.execute(sql, params)
        rows = cur.fetchall()
        return jsonify({"uploads": rows, "count": len(rows)})
    finally:
        db.close()


# ── 6. Admin feature toggle ────────────────────────────────────────────
@media_bp.route("/admin/feature", methods=["POST"])
@require_auth
@require_admin
def admin_feature():
    """Body: { id, featured_global: true|false }."""
    data = request.get_json(silent=True) or {}
    media_id = data.get("id")
    feat = bool(data.get("featured_global"))
    if not media_id:
        return jsonify({"error": "id required"}), 400
    db = get_db()
    try:
        cur = db.cursor()
        cur.execute(
            "UPDATE trainer_media SET featured_global = %s WHERE id = %s RETURNING id, featured_global;",
            (feat, media_id),
        )
        row = cur.fetchone()
        db.commit()
        if not row:
            return jsonify({"error": "Not found"}), 404
        return jsonify({"success": True, "id": row["id"], "featured_global": row["featured_global"]})
    finally:
        db.close()


# ── 7a. Public: per-user video overrides for the workout tracker ──────
@media_bp.route("/tracker-overrides", methods=["POST"])
def tracker_overrides():
    """
    Unauthenticated — the workout tracker uses access codes, not JWT.

    Body: { "email": "<client email>" }

    Returns: { "overrides": { "<exercise_name>": "<iframe URL>", ... } }

    Logic:
      1. Find the user by email in users table → get referred_by_id (coach).
      2. If they have a coach, fetch that coach's live videos → base layer.
      3. Merge featured_global live videos on top (but coach's version wins).
      4. If no coach match at all, return featured_global only.
      5. If user is unknown (trial code, not signed up), return featured_global only.
    """
    data = request.get_json(silent=True) or {}
    email = (data.get("email") or "").strip().lower()
    overrides = {}

    db = get_db()
    try:
        cur = db.cursor()

        def add_rows_for_trainer(trainer_id):
            cur.execute("""
                SELECT exercise_name, cloudflare_uid
                FROM trainer_media
                WHERE trainer_id = %s AND status = 'live' AND media_type = 'video'
                  AND cloudflare_uid IS NOT NULL
            """, (trainer_id,))
            for r in cur.fetchall():
                overrides[r["exercise_name"]] = f"https://iframe.videodelivery.net/{r['cloudflare_uid']}"

        # Layer 1 (lowest priority): featured_global — visible to everyone
        cur.execute("""
            SELECT exercise_name, cloudflare_uid
            FROM trainer_media
            WHERE featured_global = TRUE AND status = 'live' AND media_type = 'video'
              AND cloudflare_uid IS NOT NULL
        """)
        for row in cur.fetchall():
            overrides[row["exercise_name"]] = f"https://iframe.videodelivery.net/{row['cloudflare_uid']}"

        user_id = None
        coach_id = None
        if email:
            cur.execute(
                "SELECT id, referred_by_id FROM users WHERE LOWER(email) = %s LIMIT 1",
                (email,),
            )
            row = cur.fetchone()
            if row:
                user_id = row["id"]
                coach_id = row["referred_by_id"]

        # Layer 2: their coach's videos (overwrites featured)
        if coach_id:
            add_rows_for_trainer(coach_id)

        # Layer 3 (highest priority): the user's OWN uploads.
        # Handles the case where the viewer is themselves a coach/admin —
        # they see their own library when using the tracker.
        if user_id:
            add_rows_for_trainer(user_id)

        return jsonify({
            "overrides": overrides,
            "count": len(overrides),
            "has_coach": bool(coach_id),
            "user_has_own_uploads": bool(user_id),
        })
    finally:
        db.close()


# ── 7b. Admin: list every video in the Cloudflare Stream account ──────
@media_bp.route("/admin/cloudflare-list", methods=["GET"])
@require_auth
@require_admin
def admin_cloudflare_list():
    """
    Proxies Cloudflare Stream's list endpoint so admin can browse every
    video (not just the ones tracked in trainer_media). Useful for verifying
    UIDs and seeing what's been uploaded outside of the coach UI.
    Optional query params: ?search=<name>&limit=200
    """
    account_id = os.environ.get("CLOUDFLARE_ACCOUNT_ID")
    token = os.environ.get("CLOUDFLARE_API_TOKEN")
    if not account_id or not token:
        return jsonify({"error": "Cloudflare not configured on server"}), 500

    search = request.args.get("search", "").strip()
    limit = min(int(request.args.get("limit", 200)), 1000)

    params = {"asc": "false"}
    if search:
        params["search"] = search

    try:
        cf_resp = requests.get(
            f"https://api.cloudflare.com/client/v4/accounts/{account_id}/stream",
            headers={"Authorization": f"Bearer {token}"},
            params=params,
            timeout=20,
        )
    except requests.RequestException as e:
        return jsonify({"error": "Cloudflare request failed", "details": str(e)}), 502

    if cf_resp.status_code != 200:
        return jsonify({
            "error": "Cloudflare list failed",
            "status": cf_resp.status_code,
            "details": cf_resp.text[:300],
        }), 502

    data = cf_resp.json()
    if not data.get("success"):
        return jsonify({"error": "Cloudflare API error", "details": data.get("errors")}), 502

    videos = []
    for v in (data.get("result") or [])[:limit]:
        meta = v.get("meta") or {}
        videos.append({
            "uid": v.get("uid"),
            "name": meta.get("name") or v.get("uid"),
            "thumbnail": v.get("thumbnail"),
            "duration": v.get("duration"),
            "size": v.get("size"),
            "status_state": (v.get("status") or {}).get("state"),
            "created": v.get("created"),
            "preview": v.get("preview"),
            "watch_url": f"https://watch.cloudflarestream.com/{v.get('uid')}",
        })

    return jsonify({"videos": videos, "count": len(videos)})


# ── 8. Admin flag ──────────────────────────────────────────────────────
@media_bp.route("/admin/flag", methods=["POST"])
@require_auth
@require_admin
def admin_flag():
    """Body: { id, status: 'flagged'|'live'|'removed' }."""
    data = request.get_json(silent=True) or {}
    media_id = data.get("id")
    status = data.get("status")
    if not media_id or status not in ("flagged", "live", "removed"):
        return jsonify({"error": "id + valid status required"}), 400
    db = get_db()
    try:
        cur = db.cursor()
        cur.execute(
            "UPDATE trainer_media SET status = %s WHERE id = %s RETURNING id, status;",
            (status, media_id),
        )
        row = cur.fetchone()
        db.commit()
        if not row:
            return jsonify({"error": "Not found"}), 404
        return jsonify({"success": True, "id": row["id"], "status": row["status"]})
    finally:
        db.close()
