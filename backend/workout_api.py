"""
workout_api.py — Flask routes that replace the Bluehost PHP API
Covers: load-program, log-workout, submit-questionnaire, submit-completion,
        get-weekly-stats, load-user-override, save-user-override, delete-user-override,
        save-program, update-program, list-programs, get-travel-workouts,
        save-travel-workout, delete-travel-workout, get-clients, get-client-details,
        get-dashboard-stats, delete-client
"""

from flask import Blueprint, request, jsonify
import psycopg2
from psycopg2.extras import RealDictCursor
import json
import os
import smtplib
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
from datetime import datetime
import random
import string

workout_bp = Blueprint("workout", __name__)

TRAINER_EMAIL = "wisco.barbell@gmail.com"


def get_db():
    return psycopg2.connect(os.environ["DATABASE_URL"], cursor_factory=RealDictCursor)


def gen_access_code():
    return ''.join(random.choices(string.digits, k=4))


def _lookup_name(email, cur):
    """Try to find user's name from the coach platform users table."""
    try:
        cur.execute("SELECT first_name FROM users WHERE email = %s LIMIT 1", (email,))
        row = cur.fetchone()
        return row["first_name"] if row else ""
    except:
        return ""


def send_email(to, subject, html_body, reply_to=None):
    """Send email via SMTP. Falls back silently on failure."""
    try:
        gmail_user = os.environ.get("GMAIL_USER", TRAINER_EMAIL)
        gmail_pass = os.environ.get("GMAIL_APP_PASSWORD", "")
        if not gmail_pass:
            return False

        msg = MIMEMultipart("alternative")
        msg["Subject"] = subject
        msg["From"] = f"Workout Tracker <{gmail_user}>"
        msg["To"] = to
        if reply_to:
            msg["Reply-To"] = reply_to
        msg.attach(MIMEText(html_body, "html"))

        with smtplib.SMTP_SSL("smtp.gmail.com", 465) as server:
            server.login(gmail_user, gmail_pass)
            server.sendmail(gmail_user, to, msg.as_string())
        return True
    except Exception as e:
        print(f"Email error: {e}")
        return False


# ═══════════════════════════════════════════════════════════════════════════════
# TRACKER ENDPOINTS
# ═══════════════════════════════════════════════════════════════════════════════

@workout_bp.route("/load-program.php", methods=["POST", "OPTIONS"])
def load_program():
    if request.method == "OPTIONS":
        return "", 200
    data = request.json or {}
    email = (data.get("email") or "").lower().strip()
    code = (data.get("code") or "").strip()

    if not email or not code:
        return jsonify({"success": False, "message": "Email and access code required"}), 400

    db = get_db()
    try:
        cur = db.cursor()

        # Load program
        cur.execute("SELECT * FROM workout_programs WHERE access_code = %s AND is_active = TRUE", (code,))
        program = cur.fetchone()
        if not program:
            return jsonify({"success": False, "message": "Program not found"})

        program_data = program["program_data"]
        if isinstance(program_data, str):
            program_data = json.loads(program_data)

        # Load or create user position
        cur.execute("SELECT * FROM workout_user_position WHERE access_code = %s AND user_email = %s", (code, email))
        position = cur.fetchone()

        requested_week = data.get("requested_week")
        requested_day = data.get("requested_day")
        name = data.get("name", "")

        if not position:
            # Check for previous user data from another program
            cur.execute("SELECT * FROM workout_user_position WHERE user_email = %s ORDER BY updated_at DESC LIMIT 1", (email,))
            prev = cur.fetchone()
            cumulative_weeks = int(prev["cumulative_weeks"] or 0) if prev else 0
            # Carry name and questionnaire status from previous program
            if not name and prev:
                name = prev.get("user_name") or ""

            bench = data.get("benchMax") or (prev and prev.get("one_rm_bench")) or 0
            squat = data.get("squatMax") or (prev and prev.get("one_rm_squat")) or 0
            deadlift = data.get("deadliftMax") or (prev and prev.get("one_rm_deadlift")) or 0
            clean = data.get("cleanMax") or (prev and prev.get("one_rm_clean")) or 0
            height = data.get("height") or (prev and prev.get("height_inches")) or None
            weight = data.get("weight") or (prev and prev.get("weight_lbs")) or None
            age = data.get("age") or (prev and prev.get("age")) or None
            gender = data.get("gender") or (prev and prev.get("gender")) or None

            cur.execute("""
                INSERT INTO workout_user_position
                (access_code, user_email, user_name, current_week, current_day,
                 one_rm_bench, one_rm_squat, one_rm_deadlift, one_rm_clean,
                 height_inches, weight_lbs, age, gender, cumulative_weeks,
                 questionnaire_completed, consent_accepted)
                VALUES (%s, %s, %s, 1, 1, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
            """, (code, email, name, bench, squat, deadlift, clean, height, weight, age, gender, cumulative_weeks,
                  bool(prev and prev.get("questionnaire_completed")), bool(prev and prev.get("consent_accepted"))))
            db.commit()

            cur.execute("SELECT * FROM workout_user_position WHERE access_code = %s AND user_email = %s", (code, email))
            position = cur.fetchone()
        else:
            # Update profile if provided
            if data.get("height") or data.get("weight") or data.get("age") or data.get("gender"):
                cur.execute("""
                    UPDATE workout_user_position
                    SET height_inches = COALESCE(%s, height_inches),
                        weight_lbs = COALESCE(%s, weight_lbs),
                        age = COALESCE(%s, age),
                        gender = COALESCE(%s, gender)
                    WHERE access_code = %s AND user_email = %s
                """, (data.get("height"), data.get("weight"), data.get("age"), data.get("gender"), code, email))
                db.commit()

        current_week = int(requested_week or position["current_week"] or 1)
        current_day = int(requested_day or position["current_day"] or 1)
        days_per_week = program_data.get("daysPerWeek", 3)
        total_weeks = program_data.get("totalWeeks", 4)

        # Get blocks for requested week/day
        workout_key = f"{current_week}-{current_day}"
        blocks = []
        if "allWorkouts" in program_data:
            blocks = program_data["allWorkouts"].get(workout_key, [])

        # Check for saved workout
        cur.execute("""
            SELECT workout_data FROM workout_logs
            WHERE access_code = %s AND user_email = %s AND week_number = %s AND day_number = %s
            ORDER BY created_at DESC LIMIT 1
        """, (code, email, current_week, current_day))
        saved = cur.fetchone()

        return jsonify({
            "success": True,
            "data": {
                "program": {
                    "name": program["program_name"],
                    "userName": position.get("user_name") or name or _lookup_name(email, cur),
                    "daysPerWeek": days_per_week,
                    "totalWeeks": total_weeks,
                    "blocks": blocks,
                },
                "userPosition": {
                    "currentWeek": current_week,
                    "currentDay": current_day,
                    "oneRmBench": str(position.get("one_rm_bench") or ""),
                    "oneRmSquat": str(position.get("one_rm_squat") or ""),
                    "oneRmDeadlift": str(position.get("one_rm_deadlift") or ""),
                    "oneRmClean": str(position.get("one_rm_clean") or ""),
                    "heightInches": str(position.get("height_inches") or ""),
                    "weightLbs": str(position.get("weight_lbs") or ""),
                    "age": str(position.get("age") or ""),
                    "gender": position.get("gender") or "",
                    "cumulativeWeeks": position.get("cumulative_weeks") or 0,
                    "questionnaireCompleted": bool(position.get("questionnaire_completed")),
                    "consentAccepted": bool(position.get("consent_accepted")),
                },
                "savedWorkout": (json.loads(saved["workout_data"]) if isinstance(saved["workout_data"], str) else saved["workout_data"]) if saved and saved["workout_data"] else None,
            },
            "message": "Program loaded successfully",
        })
    finally:
        db.close()


def build_workout_detail_html(workout_data):
    """Build HTML table of exercises with weights/reps and notes."""
    if not workout_data or not isinstance(workout_data, dict):
        return ""
    blocks = workout_data.get("blocks", [])
    if not blocks:
        return ""

    block_type_names = {
        'theme': 'Theme', 'warmup': 'Warm Up', 'cooldown': 'Cool Down',
        'straight-set': 'Straight Set', 'superset': 'Superset',
        'triset': 'Triset', 'circuit': 'Circuit', 'conditioning': 'Conditioning',
        'mobility': 'Mobility', 'movement': 'Movement',
    }

    rows = []
    for block in blocks:
        block_type = block.get("type", "")
        if block_type == "theme":
            continue
        type_name = block_type_names.get(block_type, block_type)
        client_notes = block.get("clientNotes", "")

        exercises = block.get("exercises", [])
        if not exercises:
            continue

        rows.append(f'<tr><td colspan="3" style="background:#f3f0ff;font-weight:700;color:#667eea;padding:8px 10px;font-size:13px;border-bottom:1px solid #e5e7eb;">{type_name}</td></tr>')

        for ex in exercises:
            name = ex.get("name", "Unknown")
            sets_count = ex.get("sets", 0)
            target_reps = ex.get("targetReps", "")
            weights = ex.get("weights", [])
            actual_reps = ex.get("actualReps", [])
            recommendation = ex.get("recommendation", "")
            completed = ex.get("completed", False)
            notes = ex.get("notes", "")
            client_note = ex.get("clientNote", "")
            qualifier = ex.get("qualifier", "")

            # Build sets detail
            set_details = []
            for si in range(len(weights) if weights else 0):
                w = weights[si] if si < len(weights) else ""
                r = actual_reps[si] if si < len(actual_reps) else ""
                if w or r:
                    set_details.append(f"{w or '-'} x {r or '-'}")

            sets_str = " | ".join(set_details) if set_details else f"{sets_count}x{target_reps}"
            if qualifier:
                sets_str += f" {qualifier}"

            # Conditioning/cardio
            actual_dur = ex.get("actualDuration", "")
            actual_dist = ex.get("actualDistance", "")
            target_dur = ex.get("targetDuration", "")
            if actual_dur:
                sets_str = f"{actual_dur} min"
                if actual_dist:
                    sets_str += f" / {actual_dist} {ex.get('distanceUnit', 'mi')}"
            elif target_dur and not set_details:
                sets_str = f"{target_dur} {ex.get('durationUnit', 'min')}"

            # Recommendation arrow
            rec_icon = ""
            if recommendation == "up":
                rec_icon = " ⬆️"
            elif recommendation == "down":
                rec_icon = " ⬇️"
            elif recommendation == "same":
                rec_icon = " ➡️"

            check = "✅ " if completed else ""
            name_style = "color:#333;font-weight:600;" if completed else "color:#888;"

            rows.append(f'<tr><td style="padding:4px 10px;font-size:13px;{name_style}">{check}{name}</td><td style="padding:4px 10px;font-size:13px;color:#555;text-align:right;white-space:nowrap;">{sets_str}{rec_icon}</td></tr>')

            if notes:
                rows.append(f'<tr><td colspan="2" style="padding:2px 10px 6px 28px;font-size:12px;color:#999;font-style:italic;">' + '📝' + f' {notes}</td></tr>')

            if client_note:
                rows.append(f'<tr><td colspan="2" style="padding:2px 10px 6px 28px;font-size:12px;color:#e65100;">' + '💬' + f' {client_note}</td></tr>')

        if client_notes:
            rows.append(f'<tr><td colspan="2" style="padding:4px 10px 8px 10px;font-size:12px;color:#e65100;background:#fff8e1;">' + '💬' + f' Client notes: {client_notes}</td></tr>')

    if not rows:
        return ""

    return f"""
        <div style="margin-bottom:16px;">
            <div style="font-size:14px;font-weight:700;color:#333;margin-bottom:6px;">Workout Detail</div>
            <table style="width:100%;border-collapse:collapse;border:1px solid #e5e7eb;border-radius:8px;overflow:hidden;">
                {''.join(rows)}
            </table>
        </div>
    """


@workout_bp.route("/log-workout.php", methods=["POST", "OPTIONS"])
def log_workout():
    if request.method == "OPTIONS":
        return "", 200
    data = request.json or {}
    email = (data.get("user_email") or "").lower().strip()
    code = (data.get("access_code") or data.get("program_code") or "").strip()
    name = data.get("user_name", "")
    program_name = data.get("program_name", "")
    week = data.get("current_week", 1)
    day = data.get("current_day", 1)
    workout_data = data.get("workout_data")
    volume_stats = data.get("volume_stats")
    chatbot_data = data.get("chatbot_data")

    if not email or not code:
        return jsonify({"success": False, "message": "Email and access code required"}), 400

    db = get_db()
    try:
        cur = db.cursor()

        # Check for duplicate
        cur.execute("""
            SELECT id FROM workout_logs
            WHERE access_code = %s AND user_email = %s AND week_number = %s AND day_number = %s
        """, (code, email, week, day))
        existing = cur.fetchone()
        is_relog = existing is not None

        # Get 1RMs
        bench = data.get("one_rm_bench", 0)
        squat = data.get("one_rm_squat", 0)
        deadlift = data.get("one_rm_deadlift", 0)
        clean = data.get("one_rm_clean", 0)

        if existing:
            cur.execute("""
                UPDATE workout_logs SET workout_data = %s, volume_stats = %s, chatbot_data = %s
                WHERE id = %s
            """, (json.dumps(workout_data), json.dumps(volume_stats), json.dumps(chatbot_data), existing["id"]))
        else:
            cur.execute("""
                INSERT INTO workout_logs (access_code, user_email, user_name, program_name,
                    week_number, day_number, workout_date, workout_data, volume_stats, chatbot_data,
                    one_rm_bench, one_rm_squat, one_rm_deadlift, one_rm_clean)
                VALUES (%s, %s, %s, %s, %s, %s, CURRENT_DATE, %s, %s, %s, %s, %s, %s, %s)
            """, (code, email, name, program_name, week, day,
                  json.dumps(workout_data), json.dumps(volume_stats), json.dumps(chatbot_data),
                  bench, squat, deadlift, clean))

        # Advance position
        cur.execute("SELECT * FROM workout_programs WHERE access_code = %s", (code,))
        prog = cur.fetchone()
        if prog:
            pd = prog["program_data"]
            if isinstance(pd, str):
                pd = json.loads(pd)
            days_per_week = pd.get("daysPerWeek", 3)
            total_weeks = pd.get("totalWeeks", 4)

            next_day = day + 1
            next_week = week
            if next_day > days_per_week:
                next_day = 1
                next_week = week + 1

                # Increment cumulative weeks on last day of week
                cur.execute("""
                    UPDATE workout_user_position SET cumulative_weeks = cumulative_weeks + 1
                    WHERE access_code = %s AND user_email = %s
                """, (code, email))

            if next_week <= total_weeks:
                cur.execute("""
                    UPDATE workout_user_position
                    SET current_week = %s, current_day = %s, last_workout_date = CURRENT_DATE,
                        program_name = %s
                    WHERE access_code = %s AND user_email = %s
                """, (next_week, next_day, program_name, code, email))
            else:
                cur.execute("""
                    UPDATE workout_user_position
                    SET current_week = %s, current_day = %s, last_workout_date = CURRENT_DATE,
                        program_name = %s
                    WHERE access_code = %s AND user_email = %s
                """, (total_weeks, days_per_week, program_name, code, email))

        db.commit()

        # Get user position info for email
        cur.execute("SELECT cumulative_weeks FROM workout_user_position WHERE access_code = %s AND user_email = %s", (code, email))
        pos_row = cur.fetchone()
        cumulative_weeks = pos_row["cumulative_weeks"] if pos_row else 0

        # Get workout count for game
        cur.execute("SELECT COUNT(*) as count FROM workout_logs WHERE access_code = %s AND user_email = %s", (code, email))
        count_row = cur.fetchone()
        workout_count = count_row["count"] if count_row else 0

        # Get program info
        total_weeks_val = total_weeks if prog else '?'
        days_per_week_val = days_per_week if prog else '?'

        # Volume stats from payload
        vs = volume_stats or {}
        tonnage = vs.get("tonnage", 0)
        calories = vs.get("est_calories", 0)
        cardio_min = vs.get("cardio_minutes", 0)

        # Send email (skip if re-log)
        if not is_relog:
            # Belt info
            belt_names = ["White", "White", "White", "White", "White",
                          "Yellow", "Yellow", "Yellow", "Yellow", "Yellow",
                          "Orange", "Orange", "Orange", "Orange", "Orange",
                          "Green", "Green", "Green", "Green", "Green",
                          "Blue", "Blue", "Blue", "Blue", "Blue",
                          "Red", "Red", "Red", "Red", "Red",
                          "Brown", "Brown", "Brown", "Brown", "Brown",
                          "Black", "Black", "Black", "Black", "Black"]
            belt = belt_names[min(cumulative_weeks, len(belt_names)-1)] if cumulative_weeks > 0 else "White"

            stats_html = ""
            if tonnage: stats_html += f'<span style="background:linear-gradient(135deg,#667eea,#764ba2);color:#fff;padding:4px 12px;border-radius:6px;font-size:13px;font-weight:600;margin-right:6px;">{tonnage:,} lbs</span>'
            if calories: stats_html += f'<span style="background:linear-gradient(135deg,#ef4444,#dc2626);color:#fff;padding:4px 12px;border-radius:6px;font-size:13px;font-weight:600;margin-right:6px;">{calories} cal</span>'
            if cardio_min: stats_html += f'<span style="background:linear-gradient(135deg,#f59e0b,#d97706);color:#fff;padding:4px 12px;border-radius:6px;font-size:13px;font-weight:600;">{round(cardio_min)} min cardio</span>'

            send_email(TRAINER_EMAIL, f"Workout Complete: {name} — W{week}D{day}",
                f"""
                <div style="font-family:-apple-system,sans-serif;max-width:600px;margin:0 auto;">
                    <div style="background:linear-gradient(135deg,#667eea,#764ba2);padding:20px;text-align:center;border-radius:12px 12px 0 0;">
                        <h1 style="color:#fff;margin:0;font-size:20px;">Workout Logged</h1>
                    </div>
                    <div style="background:#fff;padding:24px;border:1px solid #e5e7eb;border-radius:0 0 12px 12px;">
                        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;flex-wrap:wrap;gap:8px;">
                            <div>
                                <div style="font-size:18px;font-weight:700;color:#1a1a2e;">{name}</div>
                                <div style="font-size:13px;color:#888;">{email}</div>
                            </div>
                            <div style="text-align:right;">
                                <div style="font-size:22px;font-weight:800;color:#667eea;">W{week} D{day}</div>
                            </div>
                        </div>

                        <div style="background:#f8f9fa;border-radius:10px;padding:14px;margin-bottom:16px;">
                            <table style="width:100%;font-size:14px;line-height:2;">
                                <tr><td style="color:#888;width:140px;">Access Code</td><td style="font-weight:600;font-family:monospace;font-size:16px;">{code}</td></tr>
                                <tr><td style="color:#888;">Program</td><td style="font-weight:600;">{program_name}</td></tr>
                                <tr><td style="color:#888;">Program Length</td><td>{total_weeks_val} weeks, {days_per_week_val} days/week</td></tr>
                                <tr><td style="color:#888;">Total Workouts</td><td style="font-weight:600;">{workout_count}</td></tr>
                                <tr><td style="color:#888;">Cumulative Weeks</td><td>{cumulative_weeks} ({belt} Belt 🥋)</td></tr>
                            </table>
                        </div>

                        {f'<div style="margin-bottom:16px;">{stats_html}</div>' if stats_html else ''}

                        {build_workout_detail_html(workout_data)}

                        <div style="font-size:13px;color:#888;border-top:1px solid #f0f0f0;padding-top:12px;">
                            <a href="mailto:{email}" style="color:#667eea;font-weight:600;">Reply to {name}</a>
                            &nbsp;·&nbsp;
                            <a href="https://bsa-trainer-dashboard.netlify.app" style="color:#667eea;">Open Dashboard</a>
                        </div>
                    </div>
                </div>
                """,
                reply_to=email)

        return jsonify({
            "success": True,
            "data": {
                "email_sent": True,
                "workout_count": count_row["count"] if count_row else 0,
                "is_relog": is_relog,
            }
        })
    finally:
        db.close()


@workout_bp.route("/load-user-override.php", methods=["POST", "OPTIONS"])
def load_user_override():
    if request.method == "OPTIONS":
        return "", 200
    data = request.json or {}
    code = data.get("accessCode", "").strip()
    email = (data.get("userEmail") or "").lower().strip()
    week = data.get("weekNumber", 1)
    day = data.get("dayNumber", 1)

    db = get_db()
    try:
        cur = db.cursor()
        cur.execute("""
            SELECT workout_data, override_reason FROM workout_overrides
            WHERE access_code = %s AND user_email = %s AND week_number = %s AND day_number = %s
        """, (code, email, week, day))
        row = cur.fetchone()

        if row:
            wd = row["workout_data"]
            if isinstance(wd, str):
                wd = json.loads(wd)
            return jsonify({"success": True, "data": {"workoutData": wd, "overrideReason": row.get("override_reason", "")}})
        else:
            return jsonify({"success": True, "data": None})
    finally:
        db.close()


@workout_bp.route("/get-weekly-stats.php", methods=["POST", "OPTIONS"])
def get_weekly_stats():
    if request.method == "OPTIONS":
        return "", 200
    data = request.json or {}
    email = (data.get("email") or "").lower().strip()
    code = (data.get("code") or "").strip()

    db = get_db()
    try:
        cur = db.cursor()
        cur.execute("""
            SELECT week_number, COUNT(*) as workouts,
                   workout_data, volume_stats
            FROM workout_logs
            WHERE access_code = %s AND user_email = %s
            GROUP BY week_number, workout_data, volume_stats
            ORDER BY week_number
        """, (code, email))
        rows = cur.fetchall()

        # Aggregate by week
        weeks = {}
        for row in rows:
            w = row["week_number"]
            if w not in weeks:
                weeks[w] = {"week": w, "workouts": 0, "tonnage": 0, "core_crunches": 0, "cardio_minutes": 0, "cardio_miles": 0, "est_calories": 0}
            weeks[w]["workouts"] += 1
            vs = row.get("volume_stats")
            if vs:
                if isinstance(vs, str):
                    vs = json.loads(vs)
                weeks[w]["tonnage"] += vs.get("tonnage", 0)
                weeks[w]["core_crunches"] += vs.get("core_crunches", 0)
                weeks[w]["cardio_minutes"] += vs.get("cardio_minutes", 0)
                weeks[w]["cardio_miles"] += vs.get("cardio_miles", 0)
                weeks[w]["est_calories"] += vs.get("est_calories", 0)

        return jsonify({"success": True, "data": {"weeks": list(weeks.values())}})
    finally:
        db.close()


@workout_bp.route("/submit-questionnaire.php", methods=["POST", "OPTIONS"])
def submit_questionnaire():
    if request.method == "OPTIONS":
        return "", 200
    data = request.json or {}
    email = (data.get("user_email") or "").lower().strip()
    name = data.get("user_name", "User")
    code = data.get("access_code", "")
    responses = data.get("responses", {})
    waiver_accepted = data.get("waiver_accepted", False)
    waiver_timestamp = data.get("waiver_timestamp")
    pain_areas = data.get("pain_areas", [])

    # Pretty labels for responses
    labels = {
        "goal": {"label": "Primary Fitness Goal", "values": {
            "lose_weight": "Lose Weight", "build_muscle": "Build Muscle",
            "athletic_performance": "Athletic Performance", "mobility": "Improve Mobility",
            "general_health": "General Health", "competition": "Competition Prep",
        }},
        "fitnessLevel": {"label": "Current Fitness Level", "values": {
            "beginner": "Beginner", "intermediate": "Intermediate", "advanced": "Advanced",
        }},
        "location": {"label": "Training Location", "values": {
            "commercial_gym": "Commercial Gym", "crossfit": "CrossFit Box",
            "home_gym": "Home Gym", "outside": "Outside", "other": "Other",
        }},
        "equipment": {"label": "Available Equipment", "values": {
            "dumbbells": "Dumbbells", "barbells": "Barbells", "kettlebells": "Kettlebells",
            "bands": "Resistance Bands", "cardio": "Cardio Machines",
            "machines": "Weight Machines", "bodyweight": "Bodyweight Only",
        }},
        "daysPerWeek": {"label": "Days Per Week", "values": {
            "1-2": "1-2 Days", "3-4": "3-4 Days", "5-6": "5-6 Days", "everyday": "Everyday",
        }},
        "injuries": {"label": "Current Injuries or Pain", "values": {
            "yes": "Yes", "no": "No",
        }},
        "motivation": {"label": "What Motivates You", "values": {
            "health": "Health & Longevity", "mental": "Mental Health",
            "appearance": "Appearance", "sports": "Sports Performance",
            "lifestyle": "Active Lifestyle", "other": "Other",
        }},
        "intensity": {"label": "Workout Intensity Preference", "values": {
            "challenging": "Push Me Hard", "moderate": "Moderate Effort", "easy": "Keep It Light",
        }},
        "coachingStyle": {"label": "Coaching Style Preference", "values": {
            "strict": "Strict & Direct", "motivational": "Motivational",
            "educational": "Educational", "mix": "Mix of All",
        }},
        "additionalInfo": {"label": "Additional Information", "values": {}},
    }

    # Build pretty HTML
    responses_html = ""
    icons = ["1️⃣", "2️⃣", "3️⃣", "4️⃣", "5️⃣", "6️⃣", "7️⃣", "8️⃣", "9️⃣", "🔟"]
    for i, (key, config) in enumerate(labels.items()):
        val = responses.get(key)
        if not val and val != 0:
            continue
        icon = icons[i] if i < len(icons) else "▪️"
        label = config["label"]
        if isinstance(val, list):
            pretty = ", ".join(config["values"].get(v, v) for v in val)
        else:
            pretty = config["values"].get(val, val)
        responses_html += f'<div style="margin-bottom:12px;"><strong style="color:#667eea;">{icon} {label}</strong><br><span style="color:#333;padding-left:24px;">{pretty}</span></div>'

    # Waiver status
    waiver_color = "#4caf50" if waiver_accepted else "#f44336"
    waiver_text = "ACCEPTED" if waiver_accepted else "NOT ACCEPTED"
    waiver_date = ""
    if waiver_timestamp:
        try:
            from datetime import datetime as dt
            waiver_date = dt.fromtimestamp(waiver_timestamp / 1000).strftime("%B %d, %Y %I:%M %p")
        except:
            waiver_date = str(waiver_timestamp)

    # Pain areas
    pain_html = ""
    if pain_areas:
        def format_pain(a):
            if isinstance(a, dict):
                area = (a.get("area") or "").replace("_", " ").title()
                details = a.get("details") or ""
                return f"{area}{' — ' + details if details else ''}"
            return str(a).replace("_", " ").title()
        pain_items = "".join(f"<li style='color:#b71c1c;margin:4px 0;'>{format_pain(a)}</li>" for a in pain_areas)
        pain_html = f"""
        <div style="background:#ffebee;border-left:4px solid #ef5350;padding:12px 16px;border-radius:8px;margin:16px 0;">
            <strong style="color:#c62828;">⚠️ Pain / Injury Areas Reported</strong>
            <ul style="margin:8px 0 0;padding-left:20px;">{pain_items}</ul>
        </div>
        """

    html = f"""
    <div style="font-family:-apple-system,sans-serif;max-width:600px;margin:0 auto;">
        <div style="background:linear-gradient(135deg,#667eea,#764ba2);padding:24px;text-align:center;border-radius:12px 12px 0 0;">
            <h1 style="color:#fff;margin:0;font-size:20px;">📋 New Client Intake Form</h1>
        </div>
        <div style="background:#fff;padding:24px;border:1px solid #e5e7eb;border-radius:0 0 12px 12px;">
            <div style="background:#f9f9f9;border-left:4px solid #667eea;padding:14px;border-radius:5px;margin-bottom:16px;">
                <p style="margin:4px 0;"><strong>Client Name:</strong> {name}</p>
                <p style="margin:4px 0;"><strong>Email:</strong> <a href="mailto:{email}" style="color:#667eea;">{email}</a></p>
                <p style="margin:4px 0;"><strong>Access Code:</strong> {code}</p>
            </div>

            <div style="background:#fff;border-left:4px solid {waiver_color};padding:14px;border-radius:5px;margin-bottom:16px;">
                <strong>⚖️ Liability Waiver</strong><br>
                <span style="color:{waiver_color};font-weight:700;">{'✅' if waiver_accepted else '❌'} {waiver_text}</span>
                {f'<br><span style="color:#888;font-size:13px;">Accepted on: {waiver_date}</span>' if waiver_date else ''}
            </div>

            {pain_html}

            <h2 style="color:#667eea;margin:24px 0 16px;font-size:18px;">Fitness Questionnaire</h2>
            {responses_html}
        </div>
        <p style="text-align:center;color:#999;font-size:12px;margin-top:12px;">Be Strong Again Workout Tracker</p>
    </div>
    """

    # Mark questionnaire as completed in DB
    db2 = get_db()
    try:
        cur2 = db2.cursor()
        cur2.execute("""
            UPDATE workout_user_position
            SET questionnaire_completed = TRUE, consent_accepted = %s
            WHERE user_email = %s AND access_code = %s
        """, (waiver_accepted, email, code))
        db2.commit()
    except Exception as e:
        print(f"DB update error: {e}")
    finally:
        db2.close()

    send_email(TRAINER_EMAIL, f"New Client Intake: {name}", html, reply_to=email)
    return jsonify({"success": True, "data": {"email_sent": True}})


@workout_bp.route("/submit-completion.php", methods=["POST", "OPTIONS"])
def submit_completion():
    if request.method == "OPTIONS":
        return "", 200
    data = request.json or {}
    return jsonify({"success": True, "message": "Completion feedback received"})


# ═══════════════════════════════════════════════════════════════════════════════
# BUILDER ENDPOINTS
# ═══════════════════════════════════════════════════════════════════════════════

@workout_bp.route("/save-program.php", methods=["POST", "OPTIONS"])
def save_program():
    if request.method == "OPTIONS":
        return "", 200
    data = request.json or {}
    email = (data.get("trainerEmail") or data.get("email") or "").lower().strip()
    name = data.get("programName", "Untitled")
    nickname = data.get("programNickname", "")
    program_data = data.get("programData", {})

    code = gen_access_code()
    # Ensure unique
    db = get_db()
    try:
        cur = db.cursor()
        for _ in range(10):
            cur.execute("SELECT id FROM workout_programs WHERE access_code = %s", (code,))
            if not cur.fetchone():
                break
            code = gen_access_code()

        cur.execute("""
            INSERT INTO workout_programs (access_code, user_email, program_name, program_nickname, program_data, created_by)
            VALUES (%s, %s, %s, %s, %s, %s)
            RETURNING id
        """, (code, email, name, nickname, json.dumps(program_data), email))
        row = cur.fetchone()
        db.commit()

        return jsonify({"success": True, "programId": row["id"], "accessCode": code})
    finally:
        db.close()


@workout_bp.route("/update-program.php", methods=["POST", "OPTIONS"])
def update_program():
    if request.method == "OPTIONS":
        return "", 200
    data = request.json or {}
    code = data.get("accessCode", "").strip()
    program_data = data.get("programData", {})

    if not code:
        return jsonify({"success": False, "message": "Access code required"}), 400

    db = get_db()
    try:
        cur = db.cursor()
        cur.execute("""
            UPDATE workout_programs SET program_data = %s, updated_at = NOW()
            WHERE access_code = %s
        """, (json.dumps(program_data), code))
        db.commit()
        return jsonify({"success": True, "accessCode": code})
    finally:
        db.close()


@workout_bp.route("/list-programs.php", methods=["POST", "OPTIONS"])
def list_programs():
    if request.method == "OPTIONS":
        return "", 200
    data = request.json or {}
    email = (data.get("email") or "").lower().strip()

    db = get_db()
    try:
        cur = db.cursor()
        cur.execute("""
            SELECT id, access_code, program_name, program_nickname, program_data, created_at, updated_at
            FROM workout_programs
            WHERE (LOWER(user_email) = %s OR LOWER(optional_trainer_email) = %s) AND is_active = TRUE
            ORDER BY updated_at DESC
        """, (email, email))
        rows = cur.fetchall()

        programs = []
        for r in rows:
            pd = r["program_data"]
            if isinstance(pd, str):
                pd = json.loads(pd)
            programs.append({
                "id": r["id"],
                "accessCode": r["access_code"],
                "name": r["program_name"],
                "nickname": r.get("program_nickname"),
                "daysPerWeek": pd.get("daysPerWeek", 3),
                "totalWeeks": pd.get("totalWeeks", 4),
                "programData": pd,
                "createdAt": str(r["created_at"]),
                "updatedAt": str(r["updated_at"]),
            })

        return jsonify({"success": True, "data": {"programs": programs}})
    finally:
        db.close()


# ═══════════════════════════════════════════════════════════════════════════════
# TRAVEL WORKOUTS
# ═══════════════════════════════════════════════════════════════════════════════

@workout_bp.route("/get-travel-workouts.php", methods=["POST", "OPTIONS"])
def get_travel_workouts():
    if request.method == "OPTIONS":
        return "", 200
    data = request.json or {}
    equipment = data.get("equipmentType", "")
    trainer = (data.get("trainerEmail") or TRAINER_EMAIL).lower().strip()

    db = get_db()
    try:
        cur = db.cursor()
        if equipment:
            cur.execute("""
                SELECT * FROM workout_travel
                WHERE trainer_email = %s AND equipment_type = %s
                ORDER BY day_number
            """, (trainer, equipment))
        else:
            cur.execute("SELECT * FROM workout_travel WHERE trainer_email = %s ORDER BY equipment_type, day_number", (trainer,))
        rows = cur.fetchall()

        workouts = []
        for r in rows:
            wd = r["workout_data"]
            if isinstance(wd, str):
                wd = json.loads(wd)
            workouts.append({
                "id": r["id"],
                "equipment_type": r["equipment_type"],
                "day_number": r["day_number"],
                "workout_name": r.get("workout_name"),
                "workout_data": wd,
            })

        return jsonify({"success": True, "data": workouts})
    finally:
        db.close()


@workout_bp.route("/save-travel-workout.php", methods=["POST", "OPTIONS"])
def save_travel_workout():
    if request.method == "OPTIONS":
        return "", 200
    data = request.json or {}
    trainer = (data.get("trainerEmail") or TRAINER_EMAIL).lower().strip()
    equipment = data.get("equipmentType", "")
    day_num = data.get("dayNumber", 1)
    name = data.get("workoutName", "")
    workout_data = data.get("workoutData")

    db = get_db()
    try:
        cur = db.cursor()
        cur.execute("""
            INSERT INTO workout_travel (trainer_email, equipment_type, day_number, workout_name, workout_data)
            VALUES (%s, %s, %s, %s, %s)
            ON CONFLICT (trainer_email, equipment_type, day_number) DO UPDATE SET
                workout_name = EXCLUDED.workout_name, workout_data = EXCLUDED.workout_data, updated_at = NOW()
        """, (trainer, equipment, day_num, name, json.dumps(workout_data)))
        db.commit()
        return jsonify({"success": True})
    finally:
        db.close()


@workout_bp.route("/delete-travel-workout.php", methods=["POST", "OPTIONS"])
def delete_travel_workout():
    if request.method == "OPTIONS":
        return "", 200
    data = request.json or {}
    trainer = (data.get("trainerEmail") or TRAINER_EMAIL).lower().strip()
    equipment = data.get("equipmentType", "")
    day_num = data.get("dayNumber")

    db = get_db()
    try:
        cur = db.cursor()
        if day_num:
            cur.execute("DELETE FROM workout_travel WHERE trainer_email = %s AND equipment_type = %s AND day_number = %s",
                        (trainer, equipment, day_num))
        else:
            cur.execute("DELETE FROM workout_travel WHERE trainer_email = %s AND equipment_type = %s", (trainer, equipment))
        db.commit()
        return jsonify({"success": True})
    finally:
        db.close()


# ═══════════════════════════════════════════════════════════════════════════════
# OVERRIDE ENDPOINTS
# ═══════════════════════════════════════════════════════════════════════════════

@workout_bp.route("/save-user-override.php", methods=["POST", "OPTIONS"])
def save_user_override():
    if request.method == "OPTIONS":
        return "", 200
    data = request.json or {}
    code = data.get("accessCode", "").strip()
    email = (data.get("userEmail") or "").lower().strip()
    week = data.get("weekNumber", 1)
    day = data.get("dayNumber", 1)
    workout_data = data.get("workoutData")
    reason = data.get("overrideReason", "")

    db = get_db()
    try:
        cur = db.cursor()
        cur.execute("""
            INSERT INTO workout_overrides (access_code, user_email, week_number, day_number, workout_data, override_reason)
            VALUES (%s, %s, %s, %s, %s, %s)
            ON CONFLICT (access_code, user_email, week_number, day_number) DO UPDATE SET
                workout_data = EXCLUDED.workout_data, override_reason = EXCLUDED.override_reason, updated_at = NOW()
        """, (code, email, week, day, json.dumps(workout_data), reason))
        db.commit()
        return jsonify({"success": True})
    finally:
        db.close()


@workout_bp.route("/delete-user-override.php", methods=["POST", "OPTIONS"])
def delete_user_override():
    if request.method == "OPTIONS":
        return "", 200
    data = request.json or {}
    code = data.get("accessCode", "").strip()
    email = (data.get("userEmail") or "").lower().strip()
    week = data.get("weekNumber")
    day = data.get("dayNumber")

    db = get_db()
    try:
        cur = db.cursor()
        cur.execute("DELETE FROM workout_overrides WHERE access_code = %s AND user_email = %s AND week_number = %s AND day_number = %s",
                    (code, email, week, day))
        db.commit()
        return jsonify({"success": True})
    finally:
        db.close()


# ═══════════════════════════════════════════════════════════════════════════════
# TRAINER DASHBOARD ENDPOINTS
# ═══════════════════════════════════════════════════════════════════════════════

@workout_bp.route("/get-clients.php", methods=["POST", "OPTIONS"])
def get_clients():
    if request.method == "OPTIONS":
        return "", 200
    data = request.json or {}
    email = (data.get("email") or TRAINER_EMAIL).lower().strip()

    db = get_db()
    try:
        cur = db.cursor()
        cur.execute("""
            SELECT up.*, p.program_name,
                   (SELECT COUNT(*) FROM workout_logs wl WHERE wl.access_code = up.access_code AND wl.user_email = up.user_email) as workout_count,
                   (SELECT MAX(workout_date) FROM workout_logs wl WHERE wl.access_code = up.access_code AND wl.user_email = up.user_email) as last_workout
            FROM workout_user_position up
            LEFT JOIN workout_programs p ON up.access_code = p.access_code
            WHERE LOWER(p.user_email) = %s OR LOWER(p.optional_trainer_email) = %s
            ORDER BY up.updated_at DESC
        """, (email, email))
        rows = cur.fetchall()

        clients = []
        for r in rows:
            clients.append({
                # Snake case for trainer dashboard compatibility
                "user_email": r["user_email"],
                "email": r["user_email"],
                "user_name": r.get("user_name", ""),
                "name": r.get("user_name", ""),
                "access_code": r["access_code"],
                "accessCode": r["access_code"],
                "program_name": r.get("program_name", ""),
                "programName": r.get("program_name", ""),
                "current_week": r.get("current_week", 1),
                "currentWeek": r.get("current_week", 1),
                "current_day": r.get("current_day", 1),
                "currentDay": r.get("current_day", 1),
                "workout_count": r.get("workout_count", 0),
                "workoutCount": r.get("workout_count", 0),
                "last_workout": str(r["last_workout"]) if r.get("last_workout") else None,
                "lastWorkout": str(r["last_workout"]) if r.get("last_workout") else None,
                "one_rm_bench": float(r.get("one_rm_bench") or 0),
                "oneRmBench": float(r.get("one_rm_bench") or 0),
                "one_rm_squat": float(r.get("one_rm_squat") or 0),
                "oneRmSquat": float(r.get("one_rm_squat") or 0),
                "one_rm_deadlift": float(r.get("one_rm_deadlift") or 0),
                "oneRmDeadlift": float(r.get("one_rm_deadlift") or 0),
                "one_rm_clean": float(r.get("one_rm_clean") or 0),
                "oneRmClean": float(r.get("one_rm_clean") or 0),
            })

        return jsonify({"success": True, "data": clients})
    finally:
        db.close()


@workout_bp.route("/get-client-details.php", methods=["POST", "OPTIONS"])
def get_client_details():
    if request.method == "OPTIONS":
        return "", 200
    data = request.json or {}
    code = (data.get("access_code") or "").strip()
    email = (data.get("user_email") or "").lower().strip()

    if not code or not email:
        return jsonify({"success": False, "message": "Access code and email required"}), 400

    db = get_db()
    try:
        cur = db.cursor()

        # Get program info
        cur.execute("SELECT program_data FROM workout_programs WHERE access_code = %s", (code,))
        prog = cur.fetchone()
        pd = {}
        if prog:
            pd = prog["program_data"]
            if isinstance(pd, str):
                pd = json.loads(pd)
        days_per_week = pd.get("daysPerWeek", 3)

        # Get all workout logs
        cur.execute("""
            SELECT week_number, day_number, workout_date, workout_data, volume_stats
            FROM workout_logs
            WHERE access_code = %s AND user_email = %s
            ORDER BY workout_date DESC
            LIMIT 20
        """, (code, email))
        logs = cur.fetchall()

        recent_workouts = []
        weekly_progress = {}
        total_volume = {"tonnage": 0, "core_crunches": 0, "cardio_minutes": 0, "cardio_miles": 0, "est_calories": 0}
        weekly_volume = {}

        for log in logs:
            week = log["week_number"]

            # Weekly progress
            if week not in weekly_progress:
                weekly_progress[week] = {"week_number": week, "workouts_completed": 0}
            weekly_progress[week]["workouts_completed"] += 1

            # Volume stats — check column first, then inside workout_data
            vs = log.get("volume_stats")
            if vs and isinstance(vs, str):
                vs = json.loads(vs)
            if not vs:
                # Try extracting from workout_data
                wd_check = log.get("workout_data")
                if wd_check:
                    if isinstance(wd_check, str):
                        wd_check = json.loads(wd_check)
                    vs = wd_check.get("volume_stats") if isinstance(wd_check, dict) else None
            if vs:
                total_volume["tonnage"] += vs.get("tonnage", 0)
                total_volume["core_crunches"] += vs.get("core_crunches", 0)
                total_volume["cardio_minutes"] += vs.get("cardio_minutes", 0)
                total_volume["cardio_miles"] += vs.get("cardio_miles", 0)
                total_volume["est_calories"] += vs.get("est_calories", 0)

                if week not in weekly_volume:
                    weekly_volume[week] = {"week": week, "tonnage": 0, "core_crunches": 0, "cardio_minutes": 0, "cardio_miles": 0, "est_calories": 0}
                weekly_volume[week]["tonnage"] += vs.get("tonnage", 0)
                weekly_volume[week]["core_crunches"] += vs.get("core_crunches", 0)
                weekly_volume[week]["cardio_minutes"] += vs.get("cardio_minutes", 0)
                weekly_volume[week]["cardio_miles"] += vs.get("cardio_miles", 0)
                weekly_volume[week]["est_calories"] += vs.get("est_calories", 0)

            # Recent workouts
            wd = log.get("workout_data")
            if wd and isinstance(wd, str):
                wd = json.loads(wd)
            recent_workouts.append({
                "week_number": week,
                "day_number": log["day_number"],
                "workout_date": str(log["workout_date"]) if log["workout_date"] else None,
                "parsed_data": wd,
            })

        # Total count
        cur.execute("SELECT COUNT(*) as total FROM workout_logs WHERE access_code = %s AND user_email = %s", (code, email))
        total_logged = cur.fetchone()["total"]

        # Current position
        cur.execute("SELECT current_week FROM workout_user_position WHERE access_code = %s AND user_email = %s", (code, email))
        pos = cur.fetchone()
        current_week = pos["current_week"] if pos else 1

        expected_workouts = current_week * days_per_week
        completion_rate = min(round((total_logged / expected_workouts) * 100), 100) if expected_workouts > 0 else 0

        # Sort weekly data
        wp_sorted = sorted(weekly_progress.values(), key=lambda x: x["week_number"])
        wv_sorted = sorted(weekly_volume.values(), key=lambda x: x["week"])

        return jsonify({
            "success": True,
            "data": {
                "weekly_progress": wp_sorted,
                "recent_workouts": recent_workouts[:10],
                "total_logged": total_logged,
                "expected_workouts": expected_workouts,
                "completion_rate": completion_rate,
                "days_per_week": days_per_week,
                "total_volume_stats": total_volume,
                "weekly_volume_stats": wv_sorted,
            }
        })
    finally:
        db.close()


@workout_bp.route("/get-dashboard-stats.php", methods=["POST", "OPTIONS"])
def get_dashboard_stats():
    if request.method == "OPTIONS":
        return "", 200
    data = request.json or {}
    coach_email = (data.get("coach_email") or "").lower().strip()

    db = get_db()
    try:
        cur = db.cursor()

        if coach_email:
            # Coach-specific: only their programs' clients
            cur.execute("""
                SELECT access_code FROM workout_programs
                WHERE LOWER(user_email) = %s OR LOWER(optional_trainer_email) = %s
            """, (coach_email, coach_email))
            codes = [r["access_code"] for r in cur.fetchall()]

            cur.execute("SELECT email FROM users WHERE referred_by_id = (SELECT id FROM users WHERE email = %s LIMIT 1)", (coach_email,))
            emails = [r["email"] for r in cur.fetchall()]

            if not codes and not emails:
                return jsonify({"success": True, "data": {"active_clients": 0, "workouts_this_week": 0, "total_workouts": 0, "avg_completion": 0}})

            parts, params = [], []
            if codes:
                parts.append(f"access_code IN ({','.join(['%s']*len(codes))})")
                params.extend(codes)
            if emails:
                parts.append(f"user_email IN ({','.join(['%s']*len(emails))})")
                params.extend(emails)
            where = " OR ".join(parts)

            cur.execute(f"SELECT COUNT(DISTINCT user_email) as c FROM workout_logs WHERE ({where}) AND workout_date >= CURRENT_DATE - INTERVAL '30 days'", params)
            active = cur.fetchone()["c"]
            cur.execute(f"SELECT COUNT(*) as c FROM workout_logs WHERE ({where}) AND workout_date >= CURRENT_DATE - INTERVAL '7 days'", params)
            week = cur.fetchone()["c"]
            cur.execute(f"SELECT COUNT(*) as c FROM workout_logs WHERE ({where})", params)
            total = cur.fetchone()["c"]
        else:
            # Admin — global
            cur.execute("SELECT COUNT(DISTINCT user_email) as c FROM workout_logs WHERE workout_date >= CURRENT_DATE - INTERVAL '30 days'")
            active = cur.fetchone()["c"]
            cur.execute("SELECT COUNT(*) as c FROM workout_logs WHERE workout_date >= CURRENT_DATE - INTERVAL '7 days'")
            week = cur.fetchone()["c"]
            cur.execute("SELECT COUNT(*) as c FROM workout_logs")
            total = cur.fetchone()["c"]

        return jsonify({"success": True, "data": {
            "active_clients": active,
            "workouts_this_week": week,
            "total_workouts": total,
            "avg_completion": 0,
        }})
    finally:
        db.close()


@workout_bp.route("/send-code-to-client.php", methods=["POST", "OPTIONS"])
def send_code_to_client():
    """Send an access code email to a client."""
    if request.method == "OPTIONS":
        return "", 200
    data = request.json or {}
    code = (data.get("access_code") or "").strip()
    client_email = (data.get("user_email") or "").lower().strip()
    client_name = data.get("user_name") or "there"
    coach_name = data.get("coach_name") or "Your Coach"

    if not code or not client_email:
        return jsonify({"success": False, "message": "Access code and email required"}), 400

    db = get_db()
    try:
        cur = db.cursor()
        cur.execute("SELECT program_name FROM workout_programs WHERE access_code = %s", (code,))
        prog = cur.fetchone()
        program_name = prog["program_name"] if prog else "Your Workout"
    finally:
        db.close()

    app_link = f"https://bestrongagain.netlify.app/?code={code}&email={client_email}"

    send_email(
        client_email,
        f"Your workout program is ready — {program_name}",
        f"""
        <div style="font-family:-apple-system,sans-serif;max-width:600px;margin:0 auto;">
            <div style="background:linear-gradient(135deg,#667eea,#764ba2);padding:24px;text-align:center;border-radius:12px 12px 0 0;">
                <h1 style="color:#fff;margin:0;font-size:20px;">Your Program is Ready!</h1>
            </div>
            <div style="background:#fff;padding:24px;border:1px solid #e5e7eb;border-radius:0 0 12px 12px;">
                <p style="font-size:15px;color:#444;margin-top:0;">Hey {client_name},</p>
                <p style="font-size:15px;color:#444;line-height:1.6;">
                    I have your workout program ready. Tap the button below to open the app —
                    your access code and email are already filled in.
                </p>
                <div style="background:#f8f9fa;border-radius:12px;padding:20px;text-align:center;margin:24px 0;">
                    <div style="font-size:12px;font-weight:600;color:#888;text-transform:uppercase;letter-spacing:1px;margin-bottom:6px;">Your Access Code</div>
                    <div style="font-size:32px;font-weight:800;color:#667eea;letter-spacing:4px;margin-bottom:12px;">{code}</div>
                    <div style="font-size:13px;color:#666;margin-bottom:12px;">{program_name}</div>
                    <a href="{app_link}" style="display:inline-block;padding:14px 32px;background:linear-gradient(135deg,#667eea,#764ba2);color:#fff;text-decoration:none;border-radius:10px;font-weight:700;font-size:16px;">Open Workout App</a>
                </div>
                <p style="font-size:14px;color:#666;line-height:1.6;">
                    Every exercise has a coaching video showing you proper form.
                    Track your weights and reps as you go — I'll review your progress and adjust as needed.
                </p>
                <p style="font-size:15px;color:#444;margin-bottom:0;">— {coach_name}</p>
            </div>
            <p style="text-align:center;color:#999;font-size:12px;margin-top:12px;">Be Strong Again</p>
        </div>
        """,
        reply_to=TRAINER_EMAIL
    )

    return jsonify({"success": True, "message": f"Code sent to {client_email}"})


@workout_bp.route("/delete-client.php", methods=["POST", "OPTIONS"])
def delete_client():
    if request.method == "OPTIONS":
        return "", 200
    data = request.json or {}
    code = (data.get("access_code") or "").strip()
    email = (data.get("user_email") or "").lower().strip()

    if not code or not email:
        return jsonify({"success": False, "message": "Access code and email required"}), 400

    db = get_db()
    try:
        cur = db.cursor()
        cur.execute("DELETE FROM workout_user_position WHERE access_code = %s AND user_email = %s", (code, email))
        cur.execute("DELETE FROM workout_logs WHERE access_code = %s AND user_email = %s", (code, email))
        cur.execute("DELETE FROM workout_overrides WHERE access_code = %s AND user_email = %s", (code, email))
        db.commit()
        return jsonify({"success": True, "message": "Client removed"})
    finally:
        db.close()


@workout_bp.route("/update-client-maxes.php", methods=["POST", "OPTIONS"])
def update_client_maxes():
    if request.method == "OPTIONS":
        return "", 200
    data = request.json or {}
    code = (data.get("access_code") or "").strip()
    email = (data.get("user_email") or "").lower().strip()
    bench = data.get("bench_max") or data.get("bench") or 0
    squat = data.get("squat_max") or data.get("squat") or 0
    deadlift = data.get("deadlift_max") or data.get("deadlift") or 0
    clean = data.get("clean_max") or data.get("clean") or 0

    if not code or not email:
        return jsonify({"success": False, "message": "Access code and email required"}), 400

    db = get_db()
    try:
        cur = db.cursor()
        cur.execute("""
            UPDATE workout_user_position
            SET one_rm_bench = %s, one_rm_squat = %s, one_rm_deadlift = %s, one_rm_clean = %s
            WHERE access_code = %s AND user_email = %s
        """, (bench, squat, deadlift, clean, code, email))
        db.commit()
        return jsonify({"success": True, "message": "Maxes updated"})
    finally:
        db.close()
