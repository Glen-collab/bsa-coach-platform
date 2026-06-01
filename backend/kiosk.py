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
import secrets
from datetime import datetime, timedelta

from auth import require_auth

kiosk_bp = Blueprint("kiosk", __name__)

# Where a 1-on-1 client's magic-link welcome lands them (their read-only
# member dashboard), as opposed to TRACKER_URL which is the workout tracker.
APP_URL = os.environ.get("APP_URL", "https://app.bestrongagain.com")


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
    GET /api/kiosk/tv-config?pi=<coach_user_id>&device=<cpu_serial>

    Returns the current active program's access_code + metadata for this device.

    - If ?device= is provided, the Pi auto-registers itself in coach_devices
      on first call and returns per-device active_program.
    - If ?device= is NOT provided (legacy single-TV coaches), falls back to
      users.active_kiosk_program_id.

    Public — no auth needed so the Pi doesn't have to manage JWTs.
    """
    pi_id = (request.args.get("pi") or "").strip()
    coach_code = (request.args.get("coach") or request.args.get("code") or "").strip().upper()
    device_serial = (request.args.get("device") or "").strip()
    available_systems = (request.args.get("systems") or "").strip()
    if not pi_id and not coach_code:
        return jsonify({"error": "pi (user id) or coach (referral code) required"}), 400

    db = get_db()
    try:
        cur = db.cursor()
        # Resolve coach by UUID (legacy) or referral_code (universal SD).
        # Referral code lookup takes priority for the new captive-portal flow.
        if coach_code:
            cur.execute("""
                SELECT id, first_name, last_name, referral_code, active_kiosk_program_id,
                       brand_logo_data, brand_primary, brand_accent, brand_gym_name
                FROM users WHERE UPPER(referral_code) = %s AND role IN ('coach','admin')
            """, (coach_code,))
        else:
            cur.execute("""
                SELECT id, first_name, last_name, referral_code, active_kiosk_program_id,
                       brand_logo_data, brand_primary, brand_accent, brand_gym_name
                FROM users WHERE id = %s
            """, (pi_id,))
        coach = cur.fetchone()
        if not coach:
            return jsonify({"error": "Coach not found"}), 404
        # Use the authoritative UUID going forward (device registration uses it)
        pi_id = str(coach["id"])

        active_program_id = None
        device_row = None

        if device_serial:
            # Auto-register or update last_seen
            short = device_serial[-4:].upper() if len(device_serial) >= 4 else device_serial
            default_name = f"New device ({short})"
            systems_update = available_systems if available_systems else None
            cur.execute("""
                INSERT INTO coach_devices (coach_id, device_serial, display_name, active_program_id, available_systems)
                VALUES (%s, %s, %s, %s, COALESCE(%s, 'nes,snes'))
                ON CONFLICT (coach_id, device_serial) DO UPDATE
                  SET last_seen_at = NOW(),
                      available_systems = COALESCE(%s, coach_devices.available_systems)
                RETURNING id, display_name, active_program_id, layout,
                          view_week, view_start_day,
                          display_mode, display_metric_id,
                          display_gender, display_group, display_year,
                          available_systems
            """, (pi_id, device_serial, default_name, coach["active_kiosk_program_id"],
                  systems_update, systems_update))
            device_row = cur.fetchone()
            db.commit()
            active_program_id = device_row["active_program_id"]
        else:
            # Legacy: fall back to coach-level active program
            active_program_id = coach["active_kiosk_program_id"]

        program = None
        if active_program_id:
            cur.execute("""
                SELECT id, access_code, program_name, program_nickname
                FROM workout_programs WHERE id = %s
            """, (active_program_id,))
            program = cur.fetchone()

        return jsonify({
            "coach": {
                "first_name": coach["first_name"],
                "last_name": coach["last_name"],
                "referral_code": coach["referral_code"],
            },
            "brand": {
                "logo_data": coach["brand_logo_data"],
                "primary":   coach["brand_primary"],
                "accent":    coach["brand_accent"],
                "gym_name":  coach["brand_gym_name"],
            },
            "device": {
                "id": device_row["id"] if device_row else None,
                "display_name": device_row["display_name"] if device_row else None,
                "layout": device_row["layout"] if device_row else "two_day",
                # Phone-as-remote view state. TV reads these every poll and
                # adopts whatever the coach set from the GymTV dashboard page.
                "view": {
                    "week":      device_row["view_week"]      if device_row else 1,
                    "start_day": device_row["view_start_day"] if device_row else 1,
                },
                # Display-mode toggle so any one Pi can swap between the
                # workout TV view and the youth-leaderboard scoreboard
                # without affecting other TVs in the gym. TV side renders
                # an iframe of leaderboard.bestrongagain.com/tv?... when
                # mode == 'leaderboard'.
                "display": {
                    "mode":      device_row["display_mode"]      if device_row else "workout",
                    "metric_id": device_row["display_metric_id"] if device_row else None,
                    "gender":    device_row["display_gender"]    if device_row else None,
                    "group":     device_row["display_group"]     if device_row else None,
                    "year":      device_row["display_year"]      if device_row else None,
                },
                "available_systems": device_row["available_systems"] if device_row else "nes,snes",
            } if device_row else None,
            "active": {
                "program_id": program["id"],
                "access_code": program["access_code"],
                "program_name": program["program_name"],
                "program_nickname": program["program_nickname"],
            } if program else None,
        })
    finally:
        db.close()


# ── Coach: list registered devices ────────────────────────────────────
@kiosk_bp.route("/my-devices", methods=["GET"])
@require_auth
def my_devices():
    """Returns all Pi devices registered to this coach."""
    user_id = request.current_user["user_id"]
    db = get_db()
    try:
        cur = db.cursor()
        cur.execute("""
            SELECT d.id, d.device_serial, d.display_name, d.active_program_id,
                   d.layout, d.view_week, d.view_start_day,
                   d.display_mode, d.display_metric_id,
                   d.display_gender, d.display_group, d.display_year,
                   d.available_systems,
                   d.last_seen_at, d.created_at,
                   wp.access_code, wp.program_name
            FROM coach_devices d
            LEFT JOIN workout_programs wp ON wp.id = d.active_program_id
            WHERE d.coach_id = %s
            ORDER BY d.display_name ASC, d.created_at ASC
        """, (user_id,))
        devices = cur.fetchall()
        return jsonify({"devices": devices, "count": len(devices)})
    finally:
        db.close()


# ── Coach: rename a device ───────────────────────────────────────────
@kiosk_bp.route("/device/rename", methods=["POST"])
@require_auth
def rename_device():
    """Body: { device_id, display_name }"""
    user_id = request.current_user["user_id"]
    data = request.get_json(silent=True) or {}
    device_id = data.get("device_id")
    new_name = (data.get("display_name") or "").strip()
    if not device_id or not new_name:
        return jsonify({"error": "device_id + display_name required"}), 400

    db = get_db()
    try:
        cur = db.cursor()
        cur.execute("""
            UPDATE coach_devices SET display_name = %s
            WHERE id = %s AND coach_id = %s
            RETURNING id, display_name
        """, (new_name[:80], device_id, user_id))
        row = cur.fetchone()
        db.commit()
        if not row:
            return jsonify({"error": "Device not found"}), 404
        return jsonify({"success": True, "device": row})
    finally:
        db.close()


# ── Coach: set active program for a specific device ───────────────────
@kiosk_bp.route("/device/set-active", methods=["POST"])
@require_auth
def device_set_active():
    """Body: { device_id, program_id } — program_id null to clear."""
    user_id = request.current_user["user_id"]
    data = request.get_json(silent=True) or {}
    device_id = data.get("device_id")
    program_id = data.get("program_id")
    if not device_id:
        return jsonify({"error": "device_id required"}), 400

    db = get_db()
    try:
        cur = db.cursor()
        # Verify device ownership
        cur.execute("SELECT id FROM coach_devices WHERE id = %s AND coach_id = %s", (device_id, user_id))
        if not cur.fetchone():
            return jsonify({"error": "Device not found"}), 404
        # Verify program ownership if set
        if program_id is not None:
            cur.execute("SELECT email FROM users WHERE id = %s", (user_id,))
            u = cur.fetchone()
            cur.execute(
                "SELECT id FROM workout_programs WHERE id = %s AND (optional_trainer_email = %s OR user_email = %s)",
                (program_id, u["email"], u["email"]),
            )
            if not cur.fetchone():
                return jsonify({"error": "Program not owned by you"}), 404

        # Reset view state + flip out of leaderboard mode on every program
        # switch. Picking a workout means "show me this workout on the TV";
        # if the TV was on the leaderboard scoreboard from an earlier test
        # day, the program tile click implies "go back to workout mode."
        # Saves the coach a second tap (tap program → tap Workouts toggle).
        cur.execute("""
            UPDATE coach_devices
            SET active_program_id  = %s,
                view_week          = 1,
                view_start_day     = 1,
                display_mode       = 'workout',
                display_metric_id  = NULL
            WHERE id = %s AND coach_id = %s
            RETURNING id, active_program_id, view_week, view_start_day,
                      display_mode, display_metric_id
        """, (program_id, device_id, user_id))
        row = cur.fetchone()
        db.commit()
        return jsonify({"success": True, "device": row})
    finally:
        db.close()


# ── Coach: change a device's TV layout ────────────────────────────────
@kiosk_bp.route("/device/set-layout", methods=["POST"])
@require_auth
def device_set_layout():
    """
    Body: { device_id, layout: 'two_day' | 'wod' | 'wod_scaled' }
      - two_day: Day 1 + Day 2 side-by-side (default — personal trainer style)
      - wod: single fullwidth column — pure CrossFit WOD
      - wod_scaled: 2 columns rebadged 'Rx / WOD' + 'Scaled' (regression pairing)
    """
    user_id = request.current_user["user_id"]
    data = request.get_json(silent=True) or {}
    device_id = data.get("device_id")
    layout = (data.get("layout") or "").strip()
    if not device_id or layout not in ("two_day", "wod", "wod_scaled"):
        return jsonify({"error": "device_id + valid layout required"}), 400
    db = get_db()
    try:
        cur = db.cursor()
        cur.execute("""
            UPDATE coach_devices SET layout = %s
            WHERE id = %s AND coach_id = %s
            RETURNING id, layout
        """, (layout, device_id, user_id))
        row = cur.fetchone()
        db.commit()
        if not row:
            return jsonify({"error": "Device not found"}), 404
        return jsonify({"success": True, "device": row})
    finally:
        db.close()


# ── Public: list members under a coach (gym tablet kiosk picker) ──────
@kiosk_bp.route("/members", methods=["GET"])
def kiosk_members():
    """
    GET /api/kiosk/members?coach=<referral_code>

    Returns the list of members signed up under this coach so a gym
    tablet (kiosk mode in the workout tracker) can render a member-picker
    dropdown. Each member then logs their workout against their own data
    row without needing to type credentials.

    Public (no auth) — gated by coach referral code. The list contains:
      - id           : numeric user id
      - display_name : "LastName, F." for somewhat-private gym display
      - email        : the email the member uses to log workouts
      - first_name   : raw, in case the tracker wants a fuller fallback

    Acceptable trust model for V1: the tablet is supervised by the coach
    at the gym; anyone with the (semi-public) referral code learns names
    of members under that coach but not workout history or credentials.
    """
    coach_code = (request.args.get("coach") or "").strip().upper()
    if not coach_code:
        return jsonify({"error": "coach (referral_code) required"}), 400
    db = get_db()
    try:
        cur = db.cursor()
        cur.execute(
            "SELECT id FROM users WHERE UPPER(referral_code) = %s AND role IN ('coach','admin')",
            (coach_code,),
        )
        coach = cur.fetchone()
        if not coach:
            return jsonify({"error": "Coach not found"}), 404
        cur.execute("""
            SELECT id, first_name, last_name, email
            FROM users
            WHERE referred_by_id = %s
              AND role = 'member'
              AND is_active = TRUE
              AND email IS NOT NULL
            ORDER BY LOWER(COALESCE(last_name, '')), LOWER(COALESCE(first_name, ''))
        """, (coach["id"],))
        rows = cur.fetchall()
        members = []
        for r in rows:
            ln = (r["last_name"] or "").strip()
            fn = (r["first_name"] or "").strip()
            initial = (fn[:1] + ".") if fn else ""
            display = f"{ln}, {initial}".strip(", ").strip() if ln else (fn or r["email"])
            members.append({
                "id":           r["id"],
                "display_name": display,
                "email":        r["email"],
                "first_name":   fn,
            })
        return jsonify({"members": members, "count": len(members)})
    finally:
        db.close()


# ── Coach: 1-on-1 client roster (returning clients) ───────────────────
@kiosk_bp.route("/coach-clients", methods=["GET"])
def coach_clients():
    """
    GET /api/kiosk/coach-clients?coach=<referral_code>

    Powers the tracker's 1-on-1 picker. Returns clients who already have a
    saved position under one of this coach's programs, so the trainer taps a
    name and resumes that client's OWN program at their current week/day.
    Public, gated by coach referral code (same trust model as /members).
    """
    coach_code = (request.args.get("coach") or "").strip().upper()
    if not coach_code:
        return jsonify({"error": "coach (referral_code) required"}), 400
    db = get_db()
    try:
        cur = db.cursor()
        cur.execute(
            "SELECT email FROM users WHERE UPPER(referral_code) = %s AND role IN ('coach','admin')",
            (coach_code,),
        )
        coach = cur.fetchone()
        if not coach:
            return jsonify({"error": "Coach not found"}), 404
        coach_email = (coach["email"] or "").lower()
        # One row per client (their most recent position across this coach's
        # programs) so 1-on-1 resumes where the client left off. Join users so
        # the display name comes from the canonical record, not whatever the
        # tracker happened to stamp on the position ("User" / blank).
        cur.execute("""
            SELECT DISTINCT ON (LOWER(pos.user_email))
                   pos.user_email, pos.user_name, pos.access_code,
                   pos.current_week, pos.current_day,
                   u.first_name, u.last_name
            FROM workout_user_position pos
            JOIN workout_programs wp ON wp.access_code = pos.access_code
            LEFT JOIN users u ON LOWER(u.email) = LOWER(pos.user_email)
            WHERE wp.is_active = TRUE
              AND (LOWER(wp.created_by) = %s OR LOWER(wp.optional_trainer_email) = %s)
              AND pos.user_email NOT IN ('tv-display@bestrongagain.com', 'kiosk@bestrongagain.com')
            ORDER BY LOWER(pos.user_email), pos.updated_at DESC
        """, (coach_email, coach_email))
        rows = cur.fetchall()
        clients = []
        for r in rows:
            full = f"{(r.get('first_name') or '').strip()} {(r.get('last_name') or '').strip()}".strip()
            pos_name = (r["user_name"] or "").strip()
            if pos_name.lower() == "user":   # tracker's placeholder, not a real name
                pos_name = ""
            clients.append({
                "name":        full or pos_name or r["user_email"],
                "email":       r["user_email"],
                "access_code": r["access_code"],
                "week":        r["current_week"],
                "day":         r["current_day"],
            })
        clients.sort(key=lambda c: c["name"].lower())
        return jsonify({"clients": clients, "count": len(clients)})
    finally:
        db.close()


# ── Coach: programs list (for pairing a brand-new 1-on-1 client) ──────
@kiosk_bp.route("/coach-programs", methods=["GET"])
def coach_programs_public():
    """
    GET /api/kiosk/coach-programs?coach=<referral_code>

    Lists this coach's programs so the 1-on-1 picker can pair a NEW client:
    pick a program + enter name/email -> load, which creates that client's
    position and surfaces them in /coach-clients thereafter. Public, gated by
    coach referral code.
    """
    coach_code = (request.args.get("coach") or "").strip().upper()
    if not coach_code:
        return jsonify({"error": "coach (referral_code) required"}), 400
    db = get_db()
    try:
        cur = db.cursor()
        cur.execute(
            "SELECT email FROM users WHERE UPPER(referral_code) = %s AND role IN ('coach','admin')",
            (coach_code,),
        )
        coach = cur.fetchone()
        if not coach:
            return jsonify({"error": "Coach not found"}), 404
        coach_email = (coach["email"] or "").lower()
        cur.execute("""
            SELECT access_code, program_name, program_nickname
            FROM workout_programs
            WHERE is_active = TRUE
              AND (LOWER(created_by) = %s OR LOWER(optional_trainer_email) = %s OR LOWER(user_email) = %s)
            ORDER BY updated_at DESC
        """, (coach_email, coach_email, coach_email))
        rows = cur.fetchall()
        programs = [{
            "access_code": r["access_code"],
            "name": (r["program_nickname"] or r["program_name"] or r["access_code"]),
        } for r in rows]
        return jsonify({"programs": programs, "count": len(programs)})
    finally:
        db.close()


# ── Coach: invite a 1-on-1 client to their dashboard (magic-link welcome) ──
@kiosk_bp.route("/invite-client", methods=["POST", "OPTIONS"])
def invite_client():
    """
    POST /api/kiosk/invite-client   Body: { coach: <referral_code>, email, name }

    Fired when a coach pairs a NEW 1-on-1 client in the tracker. Finds or
    auto-creates the client as a member under this coach, then emails them a
    one-tap magic-link welcome so they can open their read-only member
    dashboard (coach notes, sessions logged, monthly challenge) — no password,
    no app purchase. The link lands on APP_URL/magic, which consumes the token
    and drops them on /member. Public, gated by coach referral code.
    """
    if request.method == "OPTIONS":
        return "", 200
    from auth import generate_referral_code
    from email_helper import send_email

    data = request.get_json(silent=True) or {}
    coach_code = (data.get("coach") or "").strip().upper()
    email = (data.get("email") or "").strip().lower()
    name = (data.get("name") or "").strip()
    if not coach_code:
        return jsonify({"error": "coach required"}), 400
    if not email or "@" not in email or len(email) > 200:
        return jsonify({"error": "Valid client email required"}), 400

    parts = name.split()
    first_name = (parts[0] if parts else email.split("@")[0])[:40]
    last_name = " ".join(parts[1:])[:60] if len(parts) > 1 else ""

    db = get_db()
    try:
        cur = db.cursor()
        cur.execute(
            "SELECT id, first_name FROM users WHERE UPPER(referral_code) = %s AND role IN ('coach','admin')",
            (coach_code,),
        )
        coach = cur.fetchone()
        if not coach:
            return jsonify({"error": "Coach not found"}), 404
        coach_id = coach["id"]
        coach_name = (coach["first_name"] or "Your trainer")

        cur.execute("SELECT id FROM users WHERE LOWER(email) = %s", (email,))
        row = cur.fetchone()
        if row:
            user_id = row["id"]
            # Backfill name only if missing — never clobber an existing one.
            if name:
                cur.execute("""
                    UPDATE users
                    SET first_name = COALESCE(NULLIF(first_name, ''), %s),
                        last_name  = COALESCE(NULLIF(last_name, ''),  %s)
                    WHERE id = %s
                """, (first_name, last_name, user_id))
        else:
            referral_code = generate_referral_code(first_name)
            for _ in range(10):
                cur.execute("SELECT 1 FROM users WHERE referral_code = %s", (referral_code,))
                if not cur.fetchone():
                    break
                referral_code = generate_referral_code(first_name)
            cur.execute("""
                INSERT INTO users (email, first_name, last_name, role, referral_code,
                                   password_hash, is_active, referred_by_id)
                VALUES (%s, %s, %s, 'member', %s, '', TRUE, %s)
                RETURNING id
            """, (email, first_name, last_name, referral_code, coach_id))
            user_id = cur.fetchone()["id"]

        token = secrets.token_urlsafe(32)
        expires = datetime.utcnow() + timedelta(days=7)  # welcome link valid a week
        cur.execute(
            "UPDATE users SET magic_token = %s, magic_expires_at = %s WHERE id = %s",
            (token, expires, user_id),
        )
        db.commit()

        link = f"{APP_URL}/magic?token={token}"
        html = f"""
          <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;max-width:520px;margin:0 auto;padding:24px;">
            <h2 style="color:#1a1a2e;margin:0 0 16px;">Your dashboard is ready 💪</h2>
            <p style="color:#444;line-height:1.5;font-size:15px;">Hi {first_name}, {coach_name} set up your Be Strong Again dashboard. Tap below to open it — you'll see your coach's notes, the sessions you've logged together, and the gym's monthly challenge. No password needed.</p>
            <p style="margin:24px 0;"><a href="{link}" style="background:linear-gradient(135deg,#f59e0b,#d97706);color:#fff;padding:14px 28px;border-radius:10px;font-weight:800;font-size:16px;text-decoration:none;display:inline-block;">Open my dashboard</a></p>
            <p style="color:#888;font-size:12px;line-height:1.5;">Or paste this into your browser:<br><a href="{link}" style="color:#667eea;word-break:break-all;">{link}</a></p>
            <p style="color:#aaa;font-size:11px;margin-top:32px;">This link works for 7 days. You can always come back and sign in with your email.</p>
          </div>
        """
        try:
            send_email(email, f"{coach_name} set up your Be Strong Again dashboard", html)
        except Exception as e:
            return jsonify({"success": False, "error": f"Couldn't send email ({e})"}), 500

        return jsonify({"success": True, "message": f"Welcome email sent to {email}."})
    finally:
        db.close()


# ── Coach: drive what's on the TV (phone-as-remote) ───────────────────
@kiosk_bp.route("/device/set-view", methods=["POST"])
@require_auth
def device_set_view():
    """
    Body: { device_id, week, start_day }
      - week:      1-based program week index
      - start_day: 1-based starting day index (the layout decides how many
                   days are visible from there — two_day shows day & day+1)

    The Pi's TV view (TVStatic.jsx) polls /tv-config every 60s and adopts
    whatever the dashboard set. Lets a coach pick a workout from their
    phone instead of using a Flirc remote / gamepad on the TV.
    """
    user_id = request.current_user["user_id"]
    data = request.get_json(silent=True) or {}
    device_id = data.get("device_id")
    try:
        week = int(data.get("week"))
        start_day = int(data.get("start_day"))
    except (TypeError, ValueError):
        return jsonify({"error": "week + start_day must be integers"}), 400
    if not device_id or week < 1 or start_day < 1:
        return jsonify({"error": "device_id + valid week (>=1) + start_day (>=1) required"}), 400
    db = get_db()
    try:
        cur = db.cursor()
        cur.execute("""
            UPDATE coach_devices
            SET view_week = %s, view_start_day = %s
            WHERE id = %s AND coach_id = %s
            RETURNING id, view_week, view_start_day
        """, (week, start_day, device_id, user_id))
        row = cur.fetchone()
        db.commit()
        if not row:
            return jsonify({"error": "Device not found"}), 404
        return jsonify({"success": True, "device": row})
    finally:
        db.close()


# ── Coach: flip a device between workout view and leaderboard view ────
@kiosk_bp.route("/device/set-display", methods=["POST"])
@require_auth
def device_set_display():
    """
    Body: {
      device_id,
      mode:      'workout' | 'leaderboard',
      metric_id: int | null,   (only meaningful when mode='leaderboard')
      gender:    'M' | 'F' | null,
      group:     str | null
    }

    The Pi's TVStatic polls /tv-config every 60s and on the next tick
    after a flip, it either renders the workout (mode='workout') or
    drops in a fullscreen iframe of leaderboard.bestrongagain.com/tv
    pre-locked to the chosen metric/gender/group (mode='leaderboard').

    For game_nes / game_snes, the kiosk agent (separate process from
    the Chromium kiosk that renders TVStatic) sees the mode change and
    execs the mode-switcher script — kills the workout Chromium,
    launches RetroArch with the requested core. Flipping back to
    'workout' kills RetroArch and respawns the workout Chromium.
    """
    user_id = request.current_user["user_id"]
    data = request.get_json(silent=True) or {}
    device_id = data.get("device_id")
    mode = (data.get("mode") or "").strip()
    if not device_id or mode not in ("workout", "leaderboard", "game_nes", "game_snes", "game_n64", "game_gba"):
        return jsonify({"error": "device_id + valid mode required"}), 400

    metric_id = data.get("metric_id")
    if metric_id is not None:
        try: metric_id = int(metric_id)
        except (TypeError, ValueError): metric_id = None
    gender = data.get("gender")
    # 'A' = "all" — show everyone in one combined list on the TV. NULL =
    # auto-rotate between Boys and Girls (the default).
    if gender not in (None, "M", "F", "A"):
        return jsonify({"error": "gender must be M, F, A, or null"}), 400
    group = data.get("group") or None
    # Year filter: 4-digit string ('2026') or NULL for all-time. Lets the
    # TV switch between current-year-only records and all-time best.
    year = data.get("year") or None
    if year is not None:
        year = str(year).strip()
        if not (len(year) == 4 and year.isdigit()):
            return jsonify({"error": "year must be a 4-digit string or null"}), 400

    db = get_db()
    try:
        cur = db.cursor()
        cur.execute("""
            UPDATE coach_devices
            SET display_mode      = %s,
                display_metric_id = %s,
                display_gender    = %s,
                display_group     = %s,
                display_year      = %s
            WHERE id = %s AND coach_id = %s
            RETURNING id, display_mode, display_metric_id,
                      display_gender, display_group, display_year
        """, (mode, metric_id, gender, group, year, device_id, user_id))
        row = cur.fetchone()
        db.commit()
        if not row:
            return jsonify({"error": "Device not found"}), 404
        return jsonify({"success": True, "device": row})
    finally:
        db.close()


# ── Public: Pi self-exits game mode via gamepad/touch on the arcade ───
@kiosk_bp.route("/exit-game-mode", methods=["POST"])
def exit_game_mode():
    """
    Body: { coach: <referral_code>, device: <cpu_serial> }
    Public — no auth, called by the arcade Flask on the Pi when the
    user picks the on-screen "Back to Workouts" tile. The Pi has no
    JWT, so the same anonymous (coach_code, device_serial) identity
    used in tv-config also keys this write.

    Limited blast radius: this only transitions display_mode from a
    game_* value back to 'workout'. It refuses to change leaderboard
    or workout state. A bad actor who knew a coach's referral code and
    device serial could force a Pi out of arcade mode, nothing more.
    """
    data = request.get_json(silent=True) or {}
    coach_code = (data.get("coach") or "").strip().upper()
    device_serial = (data.get("device") or "").strip()
    if not coach_code or not device_serial:
        return jsonify({"error": "coach + device required"}), 400

    db = get_db()
    try:
        cur = db.cursor()
        cur.execute(
            "SELECT id FROM users WHERE UPPER(referral_code) = %s AND role IN ('coach','admin')",
            (coach_code,),
        )
        coach = cur.fetchone()
        if not coach:
            return jsonify({"error": "Coach not found"}), 404

        # Only flip out of game_* modes — refuse to touch workout/leaderboard
        # so this endpoint can't be abused to override admin choices.
        cur.execute("""
            UPDATE coach_devices
            SET display_mode = 'workout'
            WHERE coach_id = %s AND device_serial = %s
              AND display_mode LIKE 'game_%'
            RETURNING id, display_mode
        """, (coach["id"], device_serial))
        row = cur.fetchone()
        db.commit()
        if not row:
            # Either device not found, or not currently in game mode —
            # treat both as a no-op success. The Pi-side script will
            # still exec locally regardless.
            return jsonify({"success": True, "noop": True})
        return jsonify({"success": True, "device": row})
    finally:
        db.close()


# ── Coach: delete a device (e.g. Pi was retired or moved) ─────────────
@kiosk_bp.route("/device/delete", methods=["POST"])
@require_auth
def delete_device():
    """Body: { device_id }"""
    user_id = request.current_user["user_id"]
    data = request.get_json(silent=True) or {}
    device_id = data.get("device_id")
    if not device_id:
        return jsonify({"error": "device_id required"}), 400

    db = get_db()
    try:
        cur = db.cursor()
        cur.execute(
            "DELETE FROM coach_devices WHERE id = %s AND coach_id = %s RETURNING id",
            (device_id, user_id),
        )
        row = cur.fetchone()
        db.commit()
        if not row:
            return jsonify({"error": "Device not found"}), 404
        return jsonify({"success": True, "deleted_id": row["id"]})
    finally:
        db.close()


# ─────────────────────────────────────────────────────────────────────
# Phone-to-Pi command queue
#
# Lets the coach (from their phone/dashboard) send "shutdown" or
# "reboot" to their Pi without SSH. Pi runs bsa-kiosk-agent.py which
# polls GET /commands every ~10s and executes pending commands,
# then POSTs /commands/<id>/ack so the same command isn't re-run.
#
# Each command auto-expires after 5 minutes — a Pi that was offline
# won't wake up and halt itself from an hours-old request.
# ─────────────────────────────────────────────────────────────────────

_ALLOWED_COMMANDS = {"shutdown", "reboot", "reload", "quit_game"}


def _coach_code_for(user):
    """Coach's referral_code is the Pi-side shared secret stored in
    /home/pi/bsa-config by the captive-portal setup. We look it up in
    the DB (JWT payload only carries user_id + role + exp)."""
    user_id = user.get("user_id")
    if not user_id:
        return None
    db = get_db()
    try:
        cur = db.cursor()
        cur.execute("SELECT referral_code FROM users WHERE id = %s", (user_id,))
        row = cur.fetchone()
    finally:
        db.close()
    if not row or not row.get("referral_code"):
        return None
    return row["referral_code"].strip().upper()


def _device_serial_from_request():
    """Optional device_serial out of the request body — present when the coach
    targeted a specific Pi from the dashboard, absent (NULL) when broadcasting
    to all of their devices."""
    data = request.get_json(silent=True) or {}
    serial = (data.get("device_serial") or "").strip()
    return serial or None


@kiosk_bp.route("/shutdown", methods=["POST", "OPTIONS"])
@require_auth
def queue_shutdown():
    """Coach queues a graceful shutdown.
    Body { device_serial: "..." } targets one Pi; omit for all coach's Pis."""
    if request.method == "OPTIONS":
        return "", 200
    code = _coach_code_for(request.current_user)
    if not code:
        return jsonify({"success": False, "message": "No coach code on your account"}), 400
    return _queue_kiosk_command(code, "shutdown", _device_serial_from_request())


@kiosk_bp.route("/pi-reboot", methods=["POST", "OPTIONS"])
@require_auth
def queue_pi_reboot():
    """Coach reboots a Pi kiosk remotely.
    Body { device_serial: "..." } targets one Pi; omit for all coach's Pis."""
    if request.method == "OPTIONS":
        return "", 200
    code = _coach_code_for(request.current_user)
    if not code:
        return jsonify({"success": False, "message": "No coach code on your account"}), 400
    return _queue_kiosk_command(code, "reboot", _device_serial_from_request())


@kiosk_bp.route("/pi-quit-game", methods=["POST", "OPTIONS"])
@require_auth
def queue_pi_quit_game():
    """Kill the currently running RetroArch game on the coach's Pi
    without leaving arcade mode — drops the TV back to the game picker
    so the user can choose a different game. The Pi agent translates
    this into a POST to http://localhost:8088/api/quit.
    Body { device_serial: "..." } targets one Pi; omit for all coach's Pis."""
    if request.method == "OPTIONS":
        return "", 200
    code = _coach_code_for(request.current_user)
    if not code:
        return jsonify({"success": False, "message": "No coach code on your account"}), 400
    return _queue_kiosk_command(code, "quit_game", _device_serial_from_request())


def _queue_kiosk_command(coach_code, command, device_serial=None):
    if command not in _ALLOWED_COMMANDS:
        return jsonify({"success": False, "message": "unknown command"}), 400
    db = get_db()
    try:
        cur = db.cursor()
        cur.execute(
            """INSERT INTO kiosk_commands (coach_code, command, device_serial)
               VALUES (%s, %s, %s) RETURNING id, created_at, expires_at""",
            (coach_code, command, device_serial),
        )
        row = cur.fetchone()
        db.commit()
        return jsonify({
            "success": True,
            "id": row["id"],
            "command": command,
            "device_serial": device_serial,
            "expires_at": str(row["expires_at"]),
        })
    finally:
        db.close()


@kiosk_bp.route("/commands", methods=["GET"])
def poll_commands():
    """Pi polls here with ?coach_code=<its referral_code>&device=<serial>.
    Returns pending (unacked, unexpired) commands targeted at this device
    or broadcast to the whole coach (device_serial IS NULL).

    Unauthenticated on purpose — the Pi has no user session and would
    be painful to bootstrap JWTs onto. The coach_code acts as a shared
    secret: it was placed in /home/pi/bsa-config at captive-portal
    onboarding and only the Pi and the coach know it. Worst case a
    leaked code would let an attacker send 'shutdown' / 'reboot' to
    *that coach's* Pi(s) — disruptive but not catastrophic.

    `device` is also optional for backwards compat with older Pi agents
    that pre-date per-device targeting; those just receive broadcasts."""
    coach_code = (request.args.get("coach_code") or "").strip().upper()
    if not coach_code:
        return jsonify({"commands": []})
    device_serial = (request.args.get("device") or "").strip() or None
    db = get_db()
    try:
        cur = db.cursor()
        cur.execute(
            """SELECT id, command, device_serial
               FROM kiosk_commands
               WHERE coach_code = %s
                 AND executed_at IS NULL
                 AND expires_at > NOW()
                 AND (device_serial IS NULL OR device_serial = %s)
               ORDER BY created_at ASC
               LIMIT 5""",
            (coach_code, device_serial),
        )
        rows = cur.fetchall()
        return jsonify({"commands": [dict(r) for r in rows]})
    finally:
        db.close()


@kiosk_bp.route("/commands/<int:cmd_id>/ack", methods=["POST", "OPTIONS"])
def ack_command(cmd_id):
    """Pi calls this once it's started executing the command so the
    queue doesn't keep re-serving it."""
    if request.method == "OPTIONS":
        return "", 200
    db = get_db()
    try:
        cur = db.cursor()
        cur.execute(
            "UPDATE kiosk_commands SET executed_at = NOW() WHERE id = %s AND executed_at IS NULL",
            (cmd_id,),
        )
        db.commit()
        return jsonify({"success": cur.rowcount > 0})
    finally:
        db.close()
