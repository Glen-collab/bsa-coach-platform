"""
members.py — member-facing dashboard endpoints.

The MemberDashboard pulls tier-gated training data + the AI summary
archive the coach has explicitly pushed via the trainer dashboard.

Tier gating happens here, not on the client, so a curious member who
inspects the network tab still can't see Coached/Elite content.
"""

from flask import Blueprint, request, jsonify
from psycopg2.extras import RealDictCursor
import psycopg2
import os

from auth import require_auth

members_bp = Blueprint("members", __name__)


def get_db():
    return psycopg2.connect(os.environ.get("DATABASE_URL"), cursor_factory=RealDictCursor)


# Tier → what they can see on their dashboard.
# 'basic'    — tonnage trend only
# 'coached'  — tonnage + calories + monthly summaries
# 'elite'    — tonnage + calories + cardio + weight + weekly + monthly summaries
TIER_RANK = {"basic": 1, "coached": 2, "elite": 3}


def _tier_of(user_row) -> str:
    t = (user_row or {}).get("active_tier") or "free"
    return t if t in TIER_RANK else "free"


@members_bp.route("/dashboard", methods=["GET"])
@require_auth
def member_dashboard():
    user_id = request.current_user["user_id"]
    db = get_db()
    try:
        cur = db.cursor()

        # User + active tier (most-recent active subscription wins).
        cur.execute(
            """
            SELECT u.id, u.email, u.first_name,
                   (SELECT tier FROM subscriptions
                    WHERE user_id = u.id
                    ORDER BY (CASE WHEN status = 'active' THEN 0 ELSE 1 END), created_at DESC
                    LIMIT 1) AS active_tier,
                   (SELECT status FROM subscriptions
                    WHERE user_id = u.id
                    ORDER BY (CASE WHEN status = 'active' THEN 0 ELSE 1 END), created_at DESC
                    LIMIT 1) AS active_status
            FROM users u
            WHERE u.id = %s
            """,
            (user_id,),
        )
        u = cur.fetchone()
        if not u:
            return jsonify({"error": "User not found"}), 404

        tier = _tier_of(u)
        email = u["email"]

        # Aggregate workout_logs into weekly buckets (last 12 weeks). One row
        # per ISO-week with sum of tonnage / calories / cardio_minutes / sessions.
        cur.execute(
            """
            SELECT
              DATE_TRUNC('week', workout_date)::date                           AS week_start,
              COUNT(*)::int                                                    AS sessions,
              COALESCE(SUM((volume_stats->>'tonnage')::numeric), 0)::int       AS tonnage,
              COALESCE(SUM((volume_stats->>'est_calories')::numeric), 0)::int  AS calories,
              COALESCE(SUM((volume_stats->>'cardio_minutes')::numeric), 0)::int AS cardio_min
            FROM workout_logs
            WHERE LOWER(user_email) = LOWER(%s)
              AND workout_date >= CURRENT_DATE - INTERVAL '12 weeks'
            GROUP BY week_start
            ORDER BY week_start ASC
            """,
            (email,),
        )
        weeks = [dict(r, week_start=r["week_start"].isoformat()) for r in cur.fetchall()]

        # Daily bodyweight series (last 90 days, drops null values)
        cur.execute(
            """
            SELECT workout_date::text AS date,
                   AVG(body_weight_lbs)::numeric(5,1) AS body_weight_lbs
            FROM workout_logs
            WHERE LOWER(user_email) = LOWER(%s)
              AND body_weight_lbs IS NOT NULL
              AND workout_date >= CURRENT_DATE - INTERVAL '90 days'
            GROUP BY workout_date
            ORDER BY workout_date ASC
            """,
            (email,),
        )
        weight_series = [{"date": r["date"], "weight": float(r["body_weight_lbs"])} for r in cur.fetchall()]

        # Lifetime totals
        cur.execute(
            """
            SELECT
              COUNT(*)::int                                                    AS sessions,
              COALESCE(SUM((volume_stats->>'tonnage')::numeric), 0)::int       AS tonnage,
              COALESCE(SUM((volume_stats->>'est_calories')::numeric), 0)::int  AS calories,
              COALESCE(SUM((volume_stats->>'cardio_minutes')::numeric), 0)::int AS cardio_min
            FROM workout_logs
            WHERE LOWER(user_email) = LOWER(%s)
            """,
            (email,),
        )
        lifetime = cur.fetchone() or {"sessions": 0, "tonnage": 0, "calories": 0, "cardio_min": 0}

        # Tier-gate the payload — only return fields they're allowed to see.
        # All tiers see sessions + tonnage. Calories unlocks at coached.
        # Cardio + weight + summaries unlock at elite. Locked sections still
        # return a marker so the client can render the upgrade tease.
        rank = TIER_RANK.get(tier, 0)

        def gated(min_tier_rank, payload, lock_tease):
            if rank >= min_tier_rank:
                return {"unlocked": True, **payload}
            return {"unlocked": False, "tease": lock_tease}

        return jsonify({
            "user": {"first_name": u["first_name"], "email": email},
            "tier": tier,
            "tier_status": u.get("active_status"),
            "lifetime": {
                "sessions": lifetime["sessions"],
                "tonnage":  lifetime["tonnage"],
            },
            "tonnage_chart": [{"week_start": w["week_start"], "tonnage": w["tonnage"], "sessions": w["sessions"]} for w in weeks],
            "calories_chart": gated(
                TIER_RANK["coached"],
                {"data": [{"week_start": w["week_start"], "calories": w["calories"]} for w in weeks]},
                "Calorie burn — unlock with Coached",
            ),
            "cardio_chart": gated(
                TIER_RANK["elite"],
                {"data": [{"week_start": w["week_start"], "cardio_min": w["cardio_min"]} for w in weeks]},
                "Cardio time tracking — unlock with Elite",
            ),
            "weight_chart": {"data": weight_series},  # all tiers — personal history
        })
    finally:
        db.close()


@members_bp.route("/coach-summaries", methods=["GET"])
@require_auth
def coach_summaries():
    """Tier-gated archive of AI-generated coach summaries the coach has
    shared to this member's dashboard. Coached → monthly only.
    Elite → weekly + monthly."""
    user_id = request.current_user["user_id"]
    db = get_db()
    try:
        cur = db.cursor()
        cur.execute(
            """
            SELECT (SELECT tier FROM subscriptions
                    WHERE user_id = %s
                    ORDER BY (CASE WHEN status = 'active' THEN 0 ELSE 1 END), created_at DESC
                    LIMIT 1) AS active_tier
            """,
            (user_id,),
        )
        row = cur.fetchone()
        tier = (row.get("active_tier") if row else None) or "free"
        rank = TIER_RANK.get(tier, 0)

        if rank < TIER_RANK["coached"]:
            return jsonify({
                "tier": tier,
                "unlocked": False,
                "tease": "Personalized coach summaries — unlock with Coached",
                "summaries": [],
            })

        # Coached: monthly only. Elite: both.
        if rank >= TIER_RANK["elite"]:
            periods = ("weekly", "monthly")
        else:
            periods = ("monthly",)

        cur.execute(
            """
            SELECT id, period, body, created_at
            FROM coach_summaries
            WHERE user_id = %s AND period = ANY(%s)
            ORDER BY created_at DESC
            LIMIT 50
            """,
            (user_id, list(periods)),
        )
        summaries = [
            {
                "id": str(r["id"]),
                "period": r["period"],
                "body": r["body"],
                "created_at": r["created_at"].isoformat(),
            }
            for r in cur.fetchall()
        ]
        return jsonify({"tier": tier, "unlocked": True, "summaries": summaries})
    finally:
        db.close()
