"""
admin.py - Master admin routes (Glen only)
"""

from flask import Blueprint, request, jsonify
import psycopg2
import os
from email_helper import notify_coach_approved, notify_coach_denied

admin_bp = Blueprint("admin", __name__)


def get_db():
    return psycopg2.connect(os.environ.get("DATABASE_URL"))


@admin_bp.route("/overview", methods=["GET"])
def platform_overview():
    db = get_db()
    try:
        with db.cursor() as cur:
            cur.execute("""
                SELECT
                    COALESCE(SUM(amount_cents), 0),
                    COUNT(*),
                    COUNT(*) FILTER (WHERE tier = 'basic'),
                    COUNT(*) FILTER (WHERE tier = 'coached'),
                    COUNT(*) FILTER (WHERE tier = 'elite')
                FROM subscriptions WHERE status = 'active'
            """)
            rev = cur.fetchone()

            cur.execute("SELECT COUNT(*) FROM users WHERE role IN ('coach', 'admin') AND is_active = TRUE")
            total_coaches = cur.fetchone()[0]

            cur.execute("SELECT COUNT(*) FROM users WHERE role = 'member' AND is_active = TRUE")
            total_members = cur.fetchone()[0]

            cur.execute("SELECT COUNT(*) FROM users WHERE role = 'member' AND referred_by_id IS NULL AND is_active = TRUE")
            unattached_members = cur.fetchone()[0]

            cur.execute("SELECT COUNT(*) FROM videos WHERE status = 'pending'")
            pending_videos = cur.fetchone()[0]

            cur.execute("""
                SELECT COALESCE(SUM(commission_amount_cents), 0)
                FROM commissions
                WHERE status = 'paid' AND DATE_TRUNC('month', paid_at) = DATE_TRUNC('month', NOW())
            """)
            monthly_payouts = cur.fetchone()[0]

            # Pending coach applications
            cur.execute("SELECT COUNT(*) FROM coach_applications WHERE status = 'pending'")
            pending_coaches = cur.fetchone()[0]

        return jsonify({
            "mrr": rev[0] / 100,
            "active_subscriptions": rev[1],
            "tier_breakdown": {"basic": rev[2], "coached": rev[3], "elite": rev[4]},
            "total_coaches": total_coaches,
            "total_members": total_members,
            "unattached_members": unattached_members,
            "pending_videos": pending_videos,
            "pending_coach_applications": pending_coaches,
            "monthly_payouts": monthly_payouts / 100
        })
    finally:
        db.close()


# ── Coach Applications ────────────────────────────────────────────────────────

@admin_bp.route("/coach-applications", methods=["GET"])
def list_coach_applications():
    """All pending coach applications for review."""
    status_filter = request.args.get("status", "pending")
    db = get_db()
    try:
        with db.cursor() as cur:
            cur.execute("""
                SELECT ca.id, ca.experience, ca.certifications, ca.why_coach,
                       ca.specialties, ca.years_training, ca.status, ca.created_at,
                       ca.review_notes, ca.reviewed_at,
                       u.id, u.first_name, u.last_name, u.email
                FROM coach_applications ca
                JOIN users u ON u.id = ca.user_id
                WHERE ca.status = %s
                ORDER BY ca.created_at ASC
            """, (status_filter,))
            rows = cur.fetchall()

        return jsonify({
            "applications": [
                {
                    "id": str(r[0]),
                    "experience": r[1],
                    "certifications": r[2],
                    "why_coach": r[3],
                    "specialties": r[4] or [],
                    "years_training": r[5],
                    "status": r[6],
                    "applied_at": str(r[7]) if r[7] else None,
                    "review_notes": r[8],
                    "reviewed_at": str(r[9]) if r[9] else None,
                    "user_id": str(r[10]),
                    "first_name": r[11],
                    "last_name": r[12],
                    "email": r[13],
                }
                for r in rows
            ]
        })
    finally:
        db.close()


@admin_bp.route("/coach-applications/<app_id>/approve", methods=["POST"])
def approve_coach(app_id):
    """Approve a coach application — promotes user to coach role."""
    data = request.json or {}
    notes = data.get("notes", "")

    db = get_db()
    try:
        with db.cursor() as cur:
            # Get the user_id from the application
            cur.execute("SELECT user_id FROM coach_applications WHERE id = %s", (app_id,))
            row = cur.fetchone()
            if not row:
                return jsonify({"error": "Application not found"}), 404

            user_id = row[0]

            # Update application status
            cur.execute("""
                UPDATE coach_applications
                SET status = 'approved', review_notes = %s, reviewed_at = NOW()
                WHERE id = %s
            """, (notes, app_id))

            # Promote user to coach
            cur.execute("UPDATE users SET role = 'coach' WHERE id = %s", (user_id,))

            # Get user info for email
            cur.execute("SELECT email, first_name, referral_code FROM users WHERE id = %s", (user_id,))
            user_info = cur.fetchone()

            db.commit()

        # Send approval email
        if user_info:
            try:
                notify_coach_approved(user_info[0], user_info[1], user_info[2])
            except:
                pass

        return jsonify({"success": True, "message": "Coach approved and promoted."})
    finally:
        db.close()


@admin_bp.route("/coach-applications/<app_id>/deny", methods=["POST"])
def deny_coach(app_id):
    """Deny a coach application."""
    data = request.json or {}
    notes = data.get("notes", "Didn't meet requirements at this time.")

    db = get_db()
    try:
        with db.cursor() as cur:
            cur.execute("SELECT user_id FROM coach_applications WHERE id = %s", (app_id,))
            app_row = cur.fetchone()

            cur.execute("""
                UPDATE coach_applications
                SET status = 'denied', review_notes = %s, reviewed_at = NOW()
                WHERE id = %s
            """, (notes, app_id))

            # Get user info for email
            user_info = None
            if app_row:
                cur.execute("SELECT email, first_name FROM users WHERE id = %s", (app_row[0],))
                user_info = cur.fetchone()

            db.commit()

        if user_info:
            try:
                notify_coach_denied(user_info[0], user_info[1], notes)
            except:
                pass

        return jsonify({"success": True, "message": "Application denied."})
    finally:
        db.close()


# ── Members List (unattached — no coach assigned) ─────────────────────────────

@admin_bp.route("/members/list", methods=["GET"])
def list_members():
    """Members who signed up but aren't under a coach. The dispatch queue."""
    db = get_db()
    try:
        with db.cursor() as cur:
            cur.execute("""
                SELECT
                    u.id, u.first_name, u.last_name, u.email, u.role,
                    u.referral_code, u.created_at,
                    s.tier, s.status as sub_status
                FROM users u
                LEFT JOIN subscriptions s ON s.user_id = u.id AND s.status = 'active'
                WHERE u.is_active = TRUE
                  AND u.role = 'member'
                  AND u.referred_by_id IS NULL
                ORDER BY u.created_at DESC
            """)
            rows = cur.fetchall()

        return jsonify({
            "members": [
                {
                    "id": str(r[0]),
                    "first_name": r[1],
                    "last_name": r[2],
                    "email": r[3],
                    "role": r[4],
                    "referral_code": r[5],
                    "joined": str(r[6]) if r[6] else None,
                    "tier": r[7],
                    "subscription_status": r[8],
                }
                for r in rows
            ]
        })
    finally:
        db.close()


@admin_bp.route("/members/deactivate", methods=["POST"])
def deactivate_member():
    """Move a member to inactive — they won't show up anymore but data is preserved."""
    data = request.json or {}
    member_id = data.get("member_id")
    if not member_id:
        return jsonify({"error": "member_id required"}), 400
    db = get_db()
    try:
        with db.cursor() as cur:
            cur.execute("UPDATE users SET is_active = FALSE WHERE id = %s", (member_id,))
            db.commit()
        return jsonify({"success": True, "message": "Member deactivated"})
    finally:
        db.close()


@admin_bp.route("/members/delete", methods=["POST"])
def delete_member():
    """Permanently delete a member."""
    data = request.json or {}
    member_id = data.get("member_id")
    if not member_id:
        return jsonify({"error": "member_id required"}), 400
    db = get_db()
    try:
        with db.cursor() as cur:
            cur.execute("DELETE FROM subscriptions WHERE user_id = %s", (member_id,))
            cur.execute("DELETE FROM commissions WHERE source_user_id = %s OR earner_id = %s", (member_id, member_id))
            cur.execute("DELETE FROM coach_applications WHERE user_id = %s", (member_id,))
            cur.execute("DELETE FROM users WHERE id = %s", (member_id,))
            db.commit()
        return jsonify({"success": True, "message": "Member deleted"})
    finally:
        db.close()


@admin_bp.route("/members/assign", methods=["POST"])
def assign_member_to_coach():
    """Assign an unattached member to a coach."""
    data = request.json or {}
    member_id = data.get("member_id")
    coach_id = data.get("coach_id")

    if not member_id or not coach_id:
        return jsonify({"error": "member_id and coach_id required"}), 400

    db = get_db()
    try:
        with db.cursor() as cur:
            cur.execute("UPDATE users SET referred_by_id = %s WHERE id = %s", (coach_id, member_id))
            db.commit()
        return jsonify({"success": True, "message": "Member assigned to coach"})
    finally:
        db.close()


# ── Coaches List ──────────────────────────────────────────────────────────────

@admin_bp.route("/coaches/list", methods=["GET"])
def list_coaches():
    """All coaches with their clients nested underneath."""
    db = get_db()
    try:
        with db.cursor() as cur:
            # Get all coaches
            cur.execute("""
                SELECT u.id, u.first_name, u.last_name, u.email,
                       u.stripe_onboarded, u.referral_code,
                       ref.first_name as referred_by_name
                FROM users u
                LEFT JOIN users ref ON ref.id = u.referred_by_id
                WHERE u.role IN ('coach', 'admin') AND u.is_active = TRUE
                ORDER BY u.created_at
            """)
            coach_rows = cur.fetchall()

            coaches = []
            for cr in coach_rows:
                coach_id = str(cr[0])

                # Get clients under this coach
                cur.execute("""
                    SELECT u.id, u.first_name, u.last_name, u.email, u.created_at,
                           s.tier, s.status as sub_status, s.amount_cents
                    FROM users u
                    LEFT JOIN subscriptions s ON s.user_id = u.id AND s.status = 'active'
                    WHERE u.referred_by_id = %s AND u.role = 'member' AND u.is_active = TRUE
                    ORDER BY u.created_at DESC
                """, (coach_id,))
                client_rows = cur.fetchall()

                clients = []
                total_revenue = 0
                for cl in client_rows:
                    amt = cl[7] or 0
                    total_revenue += amt
                    clients.append({
                        "id": str(cl[0]),
                        "first_name": cl[1],
                        "last_name": cl[2],
                        "email": cl[3],
                        "joined": str(cl[4]) if cl[4] else None,
                        "tier": cl[5],
                        "sub_status": cl[6],
                        "monthly": amt / 100,
                    })

                coaches.append({
                    "id": coach_id,
                    "first_name": cr[1],
                    "last_name": cr[2],
                    "email": cr[3],
                    "stripe_onboarded": cr[4],
                    "referral_code": cr[5],
                    "referred_by": cr[6],
                    "client_count": len(clients),
                    "revenue": total_revenue,
                    "clients": clients,
                })

        return jsonify({"coaches": coaches})
    finally:
        db.close()


# ── Video Approvals ───────────────────────────────────────────────────────────

@admin_bp.route("/videos/pending", methods=["GET"])
def pending_videos():
    db = get_db()
    try:
        with db.cursor() as cur:
            cur.execute("""
                SELECT v.id, v.title, v.description, v.duration_seconds,
                       v.created_at, u.first_name, u.last_name
                FROM videos v
                JOIN users u ON u.id = v.uploaded_by_id
                WHERE v.status = 'pending'
                ORDER BY v.created_at ASC
            """)
            rows = cur.fetchall()

        return jsonify({
            "videos": [
                {
                    "id": str(r[0]), "title": r[1], "description": r[2],
                    "duration_seconds": r[3], "submitted_at": str(r[4]),
                    "uploaded_by": f"{r[5]} {r[6]}"
                }
                for r in rows
            ]
        })
    finally:
        db.close()


@admin_bp.route("/videos/<video_id>/approve", methods=["POST"])
def approve_video(video_id):
    db = get_db()
    try:
        with db.cursor() as cur:
            cur.execute("UPDATE videos SET status = 'approved', approved_at = NOW() WHERE id = %s", (video_id,))
            db.commit()
        return jsonify({"success": True})
    finally:
        db.close()


@admin_bp.route("/videos/<video_id>/reject", methods=["POST"])
def reject_video(video_id):
    db = get_db()
    try:
        with db.cursor() as cur:
            cur.execute("UPDATE videos SET status = 'rejected' WHERE id = %s", (video_id,))
            db.commit()
        return jsonify({"success": True})
    finally:
        db.close()
