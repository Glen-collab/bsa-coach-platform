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
            cur.execute("""
                INSERT INTO coach_devices (coach_id, device_serial, display_name, active_program_id)
                VALUES (%s, %s, %s, %s)
                ON CONFLICT (coach_id, device_serial) DO UPDATE
                  SET last_seen_at = NOW()
                RETURNING id, display_name, active_program_id, layout
            """, (pi_id, device_serial, default_name, coach["active_kiosk_program_id"]))
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
                   d.layout, d.last_seen_at, d.created_at,
                   wp.access_code, wp.program_name
            FROM coach_devices d
            LEFT JOIN workout_programs wp ON wp.id = d.active_program_id
            WHERE d.coach_id = %s
            ORDER BY d.last_seen_at DESC
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

        cur.execute("""
            UPDATE coach_devices SET active_program_id = %s
            WHERE id = %s AND coach_id = %s
            RETURNING id, active_program_id
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

_ALLOWED_COMMANDS = {"shutdown", "reboot", "reload"}


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


@kiosk_bp.route("/shutdown", methods=["POST", "OPTIONS"])
@require_auth
def queue_shutdown():
    """Coach queues a graceful shutdown for their own Pi kiosk(s)."""
    if request.method == "OPTIONS":
        return "", 200
    code = _coach_code_for(request.current_user)
    if not code:
        return jsonify({"success": False, "message": "No coach code on your account"}), 400
    return _queue_kiosk_command(code, "shutdown")


@kiosk_bp.route("/pi-reboot", methods=["POST", "OPTIONS"])
@require_auth
def queue_pi_reboot():
    """Coach reboots their Pi kiosk remotely.
    Named pi-reboot to avoid collision with any future /reboot endpoint
    meant for something else."""
    if request.method == "OPTIONS":
        return "", 200
    code = _coach_code_for(request.current_user)
    if not code:
        return jsonify({"success": False, "message": "No coach code on your account"}), 400
    return _queue_kiosk_command(code, "reboot")


def _queue_kiosk_command(coach_code, command):
    if command not in _ALLOWED_COMMANDS:
        return jsonify({"success": False, "message": "unknown command"}), 400
    db = get_db()
    try:
        cur = db.cursor()
        cur.execute(
            """INSERT INTO kiosk_commands (coach_code, command)
               VALUES (%s, %s) RETURNING id, created_at, expires_at""",
            (coach_code, command),
        )
        row = cur.fetchone()
        db.commit()
        return jsonify({
            "success": True,
            "id": row["id"],
            "command": command,
            "expires_at": str(row["expires_at"]),
        })
    finally:
        db.close()


@kiosk_bp.route("/commands", methods=["GET"])
def poll_commands():
    """Pi polls here with ?coach_code=<its referral_code>. Returns
    pending (unacked, unexpired) commands.

    Unauthenticated on purpose — the Pi has no user session and would
    be painful to bootstrap JWTs onto. The coach_code acts as a shared
    secret: it was placed in /home/pi/bsa-config at captive-portal
    onboarding and only the Pi and the coach know it. Worst case a
    leaked code would let an attacker send 'shutdown' / 'reboot' to
    *that coach's* Pi — disruptive but not catastrophic."""
    coach_code = (request.args.get("coach_code") or "").strip().upper()
    if not coach_code:
        return jsonify({"commands": []})
    db = get_db()
    try:
        cur = db.cursor()
        cur.execute(
            """SELECT id, command
               FROM kiosk_commands
               WHERE coach_code = %s
                 AND executed_at IS NULL
                 AND expires_at > NOW()
               ORDER BY created_at ASC
               LIMIT 5""",
            (coach_code,),
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
