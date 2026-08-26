"""
checkin.py — /api/checkin/* — the client check-in ledger.

The screen this serves is a phone in a coach's hand between sets, so the whole
design is one tap per person and nothing that can block that tap:

  * `paid` is a nullable boolean — yes, no, or nobody said. Forgetting it costs
    nothing, and the client's card lists unticked visits whenever the coach
    feels like reconciling.
  * Toggling is idempotent. Tapping a name twice is an undo, enforced by the
    UNIQUE (client_id, attended_on) index rather than by careful clients.

Session grouping is the one piece of real logic here. Every check-in stamps
`attended_at`, so the server can work out that Tuesday 9am and Tuesday 2pm are
different groups of people without anyone configuring a schedule. `/roster`
ships each client's learned (weekday, block) histogram and the client decides
membership — see the SETTLE_AFTER note in the frontend for why the fallback is
per-session and not per-person.

Scoping is always (coach_id = me) OR (gym_id = my gym), because a solo trainer
has gym_id NULL while gym partners share one. Never trust a client-supplied
coach_id.

EVERY CLOCK QUESTION HERE IS ABOUT THE GYM'S WALL CLOCK, NOT THE SERVER'S.
The box runs UTC and Wisconsin is five or six hours behind it, so reading a
timestamp back in the server's timezone silently files the Tuesday 3pm group as
"Tuesday evening, 8pm". The phone then asks for "Tuesday afternoon", matches
nothing, never counts a run against the key it queries, and falls back to every
Tuesday regular in eighteen years of ledger — forever. That is the whole
grouping feature quietly not working, with no error to notice.

So the connection is pinned to GYM_TZ (see get_db) and every "today" comes from
_today(). That makes EXTRACT(...) on a timestamptz, CURRENT_DATE, and the
client_dues / client_balance views all speak Central. `attended_at` is
timestamptz, so this is a read-side fix: existing rows re-read correctly and
nothing needs migrating.
"""

from flask import Blueprint, request, jsonify
from psycopg2.extras import RealDictCursor
from zoneinfo import ZoneInfo
import psycopg2
import os
import datetime as dt

from auth import require_auth

checkin_bp = Blueprint("checkin", __name__)

# One gym, one timezone. If the platform ever serves a gym in another one, this
# becomes a column on `gyms` and _today() takes the gym — but until then a
# constant is honest about what is actually true.
GYM_TZ = ZoneInfo("America/Chicago")


def _today():
    """Today on the gym's wall clock. Never dt.date.today(), which is UTC here
    and rolls over at 7pm Central — mid-session, onto tomorrow's date."""
    return dt.datetime.now(GYM_TZ).date()


def get_db():
    # `options` is a libpq connection parameter, so the timezone is set as part
    # of connecting. Doing it with a `SET TIME ZONE` statement instead would put
    # it inside psycopg2's implicit transaction, where a later rollback silently
    # reverts it and the bug comes back only on the error path.
    return psycopg2.connect(
        os.environ.get("DATABASE_URL"),
        options="-c timezone=America/Chicago",
        cursor_factory=RealDictCursor,
    )


BILLING_TYPES = {"monthly", "package", "drop_in", "one_on_one", "untracked"}
STATUSES = {"active", "paused", "former", "prospect", "inactive"}
BLOCKS = ("morning", "afternoon", "evening")


def _scope(cur, user_id):
    """Returns (sql_fragment, params) limiting rows to what this coach may see."""
    cur.execute("SELECT gym_id FROM users WHERE id = %s", (user_id,))
    row = cur.fetchone()
    gym_id = (row or {}).get("gym_id")
    if gym_id:
        return "(c.coach_id = %s OR c.gym_id = %s)", (user_id, gym_id)
    return "c.coach_id = %s", (user_id,)


def _owns(cur, user_id, client_id):
    frag, params = _scope(cur, user_id)
    cur.execute(f"SELECT c.id FROM clients c WHERE c.id = %s::uuid AND {frag}", (client_id, *params))
    return cur.fetchone() is not None


def _balances_after(cur, client_id):
    """Fresh remaining for this client and every household member they share with."""
    cur.execute(
        """
        SELECT b.client_id, b.remaining
          FROM client_balance b
         WHERE b.client_id = %s::uuid
            OR (b.household_id IS NOT NULL
                AND b.household_id = (SELECT household_id FROM clients WHERE id = %s::uuid))
        """,
        (client_id, client_id),
    )
    return {str(r["client_id"]): (float(r["remaining"]) if r["remaining"] is not None else None)
            for r in cur.fetchall()}


def _block(hour):
    return "morning" if hour < 12 else "afternoon" if hour < 17 else "evening"


def _end_absence(cur, client_id, on):
    """They walked in, so they are not away any more — whatever the card said.

    Someone standing in the gym is the most reliable fact available, and making
    Glen go and cancel the vacation by hand before the check-in reads right is
    exactly the kind of admin that leaves a field permanently stale. An absence
    that hadn't started yet is deleted outright: it never happened, and leaving
    a zero-length row behind would just be litter.
    """
    cur.execute(
        """DELETE FROM client_absences
            WHERE client_id = %s::uuid AND starts_on >= %s::date
              AND (ends_on IS NULL OR ends_on >= %s::date)""",
        (client_id, on, on),
    )
    removed = cur.rowcount
    cur.execute(
        """UPDATE client_absences SET ends_on = %s::date - 1
            WHERE client_id = %s::uuid AND starts_on < %s::date
              AND (ends_on IS NULL OR ends_on >= %s::date)""",
        (on, client_id, on, on),
    )
    return removed + cur.rowcount


# ── Roster ───────────────────────────────────────────────────────────────────

@checkin_bp.route("/roster", methods=["GET"])
@require_auth
def roster():
    """
    Everything the check-in screen needs in one call: who, their tags, their
    visit history summary, and the learned (weekday, block) → hour histograms
    that let the list narrow to whoever trains at this hour on this day.
    """
    user_id = request.current_user["user_id"]
    today = _today()
    # Default to the working roster only. An eighteen-year ledger carries ~1,300
    # people who came exactly once in 2009; loading them puts a 1,499-row payload
    # on a phone and buries today's group. ?include=all reaches them when needed.
    include_all = request.args.get("include") == "all"
    status_frag = "" if include_all else " AND c.status = 'active'"
    db = get_db()
    try:
        cur = db.cursor()
        frag, params = _scope(cur, user_id)

        cur.execute(
            f"""
            SELECT c.id, c.display_name, c.first_name, c.last_name, c.date_of_birth,
                   c.billing_type, c.rate_amount, c.sports, c.sessions, c.slot,
                   c.status, c.status_note, c.cell_phone, c.email, c.notes, c.legacy_name,
                   b.visits, b.first_visit, b.last_visit,
                   b.purchased, b.used, b.remaining, b.household_name, b.household_id,
                   b.credits_expire_on, b.balance_needs_review,
                   d.monthly_amount, d.last_paid, d.due_on, d.days_until_due,
                   aw.reason AS away_reason, aw.note AS away_note,
                   aw.starts_on AS away_since, aw.ends_on AS away_until,
                   (SELECT signed_at FROM client_waivers w
                     WHERE w.client_id = c.id ORDER BY signed_at DESC LIMIT 1) AS waiver_signed_at,
                   (SELECT signed_by FROM client_waivers w
                     WHERE w.client_id = c.id ORDER BY signed_at DESC LIMIT 1) AS waiver_signed_by
            FROM clients c
            LEFT JOIN client_balance b ON b.client_id = c.id
            LEFT JOIN client_dues    d ON d.client_id = c.id
            LEFT JOIN client_away    aw ON aw.client_id = c.id
            WHERE {frag} AND c.status <> 'inactive'{status_frag}
            ORDER BY b.last_visit DESC NULLS LAST, c.display_name
            """,
            params,
        )
        clients = cur.fetchall()
        ids = [r["id"] for r in clients]

        # Which weekdays each person has historically trained. Comes from the
        # imported ledger, which has dates but no times — so it is the only
        # thing available to group by on day one, before any clock stamps exist.
        dow = {}
        if ids:
            cur.execute(
                """
                SELECT client_id, EXTRACT(DOW FROM attended_on)::int AS d, COUNT(*) AS n
                FROM attendance
                WHERE client_id = ANY(%s::uuid[]) AND source <> 'adjustment'
                GROUP BY client_id, d
                """,
                (ids,),
            )
            for r in cur.fetchall():
                dow.setdefault(r["client_id"], {})[r["d"]] = r["n"]

        # Learned sessions: only rows with a real clock time can teach a block.
        sess = {}
        if ids:
            cur.execute(
                """
                SELECT client_id,
                       EXTRACT(DOW  FROM attended_at)::int  AS d,
                       EXTRACT(HOUR FROM attended_at)::int  AS h,
                       COUNT(*) AS n
                FROM attendance
                WHERE client_id = ANY(%s::uuid[]) AND attended_at IS NOT NULL
                  AND source <> 'adjustment'
                GROUP BY client_id, d, h
                """,
                (ids,),
            )
            for r in cur.fetchall():
                key = f"{r['d']}-{_block(r['h'])}"
                e = sess.setdefault(r["client_id"], {}).setdefault(key, {"n": 0, "hours": {}})
                e["n"] += r["n"]
                e["hours"][str(r["h"])] = e["hours"].get(str(r["h"]), 0) + r["n"]

        # How many distinct days each session has actually been run. This is what
        # decides a group has settled and should stop falling back to "everyone
        # who trains that weekday".
        runs = {}
        cur.execute(
            f"""
            SELECT EXTRACT(DOW FROM a.attended_at)::int AS d,
                   EXTRACT(HOUR FROM a.attended_at)::int AS h,
                   a.attended_on
            FROM attendance a JOIN clients c ON c.id = a.client_id
            WHERE {frag} AND a.attended_at IS NOT NULL
            GROUP BY d, h, a.attended_on
            """,
            params,
        )
        seen = {}
        for r in cur.fetchall():
            seen.setdefault(f"{r['d']}-{_block(r['h'])}", set()).add(r["attended_on"])
        runs = {k: len(v) for k, v in seen.items()}

        # Last 8 visits per client for the card.
        hist = {}
        if ids:
            cur.execute(
                """
                SELECT client_id, attended_on FROM (
                  SELECT client_id, attended_on,
                         ROW_NUMBER() OVER (PARTITION BY client_id ORDER BY attended_on DESC) rn
                  FROM attendance
                   WHERE client_id = ANY(%s::uuid[]) AND source <> 'adjustment'
                ) t WHERE rn <= 8
                """,
                (ids,),
            )
            for r in cur.fetchall():
                hist.setdefault(r["client_id"], []).append(r["attended_on"].isoformat())

        # Today's check-ins, with the clock time so the UI can show it back.
        cur.execute(
            f"""
            SELECT a.client_id, a.attended_at, a.paid
            FROM attendance a JOIN clients c ON c.id = a.client_id
            WHERE {frag} AND a.attended_on = %s
            """,
            (*params, today),
        )
        today_map = {
            r["client_id"]: {
                "at": r["attended_at"].isoformat() if r["attended_at"] else None,
                "paid": r["paid"],
            }
            for r in cur.fetchall()
        }

        out = []
        for c in clients:
            d = dow.get(c["id"], {})
            total = sum(d.values()) or 1
            out.append({
                "id": str(c["id"]),
                "n": c["display_name"],
                "s": c["last_name"] or c["display_name"],
                "dob": c["date_of_birth"].isoformat() if c["date_of_birth"] else None,
                "billing": c["billing_type"],
                "rate": float(c["rate_amount"]) if c["rate_amount"] is not None else None,
                "sports": c["sports"] or [],
                "pinned": c["sessions"] or [],
                "slot": c["slot"],
                "phone": c["cell_phone"],
                "note": c["notes"],
                "status": c["status"],
                "statusNote": c["status_note"],
                "monthly": float(c["monthly_amount"]) if c["monthly_amount"] is not None else None,
                "lastPaid": c["last_paid"].isoformat() if c["last_paid"] else None,
                "dueOn": c["due_on"].isoformat() if c["due_on"] else None,
                "v": int(c["visits"] or 0),
                "since": c["first_visit"].isoformat() if c["first_visit"] else None,
                "last": c["last_visit"].isoformat() if c["last_visit"] else None,
                # weekdays this person shows up on at least 18% of the time
                "d": sorted([k for k, n in d.items() if n / total >= 0.18],
                            key=lambda k: -d[k]),
                "pb": float(c["purchased"] or 0),
                "remaining": float(c["remaining"]) if c["remaining"] is not None else None,
                "household": c["household_name"],
                "householdId": str(c["household_id"]) if c["household_id"] else None,
                "needsReview": bool(c["balance_needs_review"]),
                "waiver": (
                    c["waiver_signed_by"] if c["waiver_signed_at"] else None
                ),
                # `back` is the day they return — one past the last day away —
                # because that is the thing the coach actually wants to read off
                # the row. null means open-ended: gone, back when they're back.
                "away": ({
                    "reason": c["away_reason"],
                    "note": c["away_note"],
                    "since": c["away_since"].isoformat() if c["away_since"] else None,
                    "back": ((c["away_until"] + dt.timedelta(days=1)).isoformat()
                             if c["away_until"] else None),
                } if c["away_reason"] else None),
                "h": hist.get(c["id"], []),
                "sess": sess.get(c["id"], {}),
            })

        return jsonify({
            "success": True,
            "today": today.isoformat(),
            "clients": out,
            "runs": runs,
            "checkedIn": {str(k): v for k, v in today_map.items()},
        })
    finally:
        db.close()


# ── Check in / undo ──────────────────────────────────────────────────────────

@checkin_bp.route("/toggle", methods=["POST"])
@require_auth
def toggle():
    """
    Check someone in, or undo it. Idempotent by (client_id, attended_on): the
    UNIQUE index is what makes a double-tap safe rather than careful clients.
    Returns the resulting state so the UI never has to guess.
    """
    user_id = request.current_user["user_id"]
    data = request.json or {}
    client_id = data.get("client_id")
    if not client_id:
        return jsonify({"error": "client_id required"}), 400

    on = (data.get("date") or "").strip()
    try:
        attended_on = dt.date.fromisoformat(on) if on else _today()
    except ValueError:
        return jsonify({"error": "date must be YYYY-MM-DD"}), 400

    db = get_db()
    try:
        cur = db.cursor()
        if not _owns(cur, user_id, client_id):
            return jsonify({"error": "Not found"}), 404

        cur.execute(
            "SELECT id FROM attendance WHERE client_id = %s::uuid AND attended_on = %s",
            (client_id, attended_on),
        )
        existing = cur.fetchone()

        if existing and data.get("force") != "in":
            cur.execute("DELETE FROM attendance WHERE id = %s", (existing["id"],))
            bal = _balances_after(cur, client_id)
            db.commit()
            return jsonify({"success": True, "checked_in": False, "balances": bal})

        if existing:
            db.commit()
            return jsonify({"success": True, "checked_in": True})

        cur.execute("SELECT gym_id FROM users WHERE id = %s", (user_id,))
        gym_id = (cur.fetchone() or {}).get("gym_id")

        cur.execute(
            """
            INSERT INTO attendance
              (client_id, coach_id, gym_id, attended_on, attended_at,
               sessions_used, paid, amount, session_type, source, note)
            VALUES (%s, %s, %s, %s, NOW(), %s, %s, %s, %s, 'phone', %s)
            ON CONFLICT (client_id, attended_on) DO NOTHING
            RETURNING id, attended_at
            """,
            (client_id, user_id, gym_id, attended_on,
             data.get("sessions_used") or 1,
             data.get("paid"),
             data.get("amount"),
             data.get("session_type"),
             data.get("note")),
        )
        row = cur.fetchone()
        came_back = _end_absence(cur, client_id, attended_on)
        bal = _balances_after(cur, client_id)
        db.commit()
        return jsonify({
            "success": True,
            "checked_in": True,
            "at": row["attended_at"].isoformat() if row and row["attended_at"] else None,
            "balances": bal,
            "away_cleared": bool(came_back),
        })
    finally:
        db.close()


@checkin_bp.route("/paid", methods=["POST"])
@require_auth
def set_paid():
    """Tick or untick the payment box on a visit already recorded."""
    user_id = request.current_user["user_id"]
    data = request.json or {}
    client_id = data.get("client_id")
    if not client_id:
        return jsonify({"error": "client_id required"}), 400
    try:
        attended_on = dt.date.fromisoformat(data["date"]) if data.get("date") else _today()
    except (ValueError, KeyError):
        return jsonify({"error": "date must be YYYY-MM-DD"}), 400

    db = get_db()
    try:
        cur = db.cursor()
        if not _owns(cur, user_id, client_id):
            return jsonify({"error": "Not found"}), 404
        cur.execute(
            "UPDATE attendance SET paid = %s, amount = COALESCE(%s, amount) "
            "WHERE client_id = %s::uuid AND attended_on = %s RETURNING id",
            (data.get("paid"), data.get("amount"), client_id, attended_on),
        )
        found = cur.fetchone()
        db.commit()
        if not found:
            return jsonify({"error": "No check-in on that date"}), 404
        return jsonify({"success": True})
    finally:
        db.close()


# ── Client edits ─────────────────────────────────────────────────────────────

EDITABLE = {
    "date_of_birth": "date_of_birth", "billing_type": "billing_type",
    "rate_amount": "rate_amount", "sports": "sports", "sessions": "sessions",
    "slot": "slot", "notes": "notes", "cell_phone": "cell_phone",
    "email": "email", "status": "status", "first_name": "first_name",
    "last_name": "last_name", "display_name": "display_name",
    "guardian_first": "guardian_first", "guardian_last": "guardian_last",
    "emergency_name": "emergency_name", "emergency_phone": "emergency_phone",
    "status_note": "status_note", "monthly_amount": "monthly_amount",
}


@checkin_bp.route("/client/<client_id>", methods=["PATCH"])
@require_auth
def update_client(client_id):
    user_id = request.current_user["user_id"]
    data = request.json or {}

    sets, vals = [], []
    for key, col in EDITABLE.items():
        if key not in data:
            continue
        v = data[key]
        if key == "billing_type" and v not in BILLING_TYPES:
            return jsonify({"error": f"bad billing_type: {v}"}), 400
        if key == "status" and v not in STATUSES:
            return jsonify({"error": f"bad status: {v}"}), 400
        if key in ("sports", "sessions"):
            if not isinstance(v, list):
                return jsonify({"error": f"{key} must be a list"}), 400
            v = [str(x)[:60] for x in v][:40]
        if key == "date_of_birth" and v:
            try:
                dt.date.fromisoformat(v)
            except ValueError:
                return jsonify({"error": "date_of_birth must be YYYY-MM-DD"}), 400
        sets.append(f"{col} = %s")
        vals.append(v if v != "" else None)

    if "status" in data:
        sets.append("status_changed_at = NOW()")

    if not sets:
        return jsonify({"error": "Nothing to update"}), 400

    db = get_db()
    try:
        cur = db.cursor()
        if not _owns(cur, user_id, client_id):
            return jsonify({"error": "Not found"}), 404
        sets.append("updated_at = NOW()")
        cur.execute(f"UPDATE clients SET {', '.join(sets)} WHERE id = %s", (*vals, client_id))

        # A shared household has one bill. Writing the amount to the person
        # would leave two copies of it, free to drift apart.
        if "monthly_amount" in data:
            cur.execute("SELECT household_id FROM clients WHERE id = %s::uuid", (client_id,))
            hid = (cur.fetchone() or {}).get("household_id")
            if hid:
                cur.execute("UPDATE households SET monthly_amount = %s WHERE id = %s",
                            (data["monthly_amount"], hid))
        db.commit()
        return jsonify({"success": True})
    finally:
        db.close()


@checkin_bp.route("/client/<client_id>", methods=["DELETE"])
@require_auth
def delete_client(client_id):
    """
    Remove a client outright. Their attendance, packages and waivers go with
    them (ON DELETE CASCADE) — this is for the one-off note rows the ledger is
    full of, not for someone who simply stopped coming. That is what the
    'No longer a client' status is for, and it keeps the history.

    Returns what was destroyed so the UI can say so rather than just blinking.
    """
    user_id = request.current_user["user_id"]
    db = get_db()
    try:
        cur = db.cursor()
        if not _owns(cur, user_id, client_id):
            return jsonify({"error": "Not found"}), 404
        cur.execute(
            """SELECT c.display_name,
                      (SELECT COUNT(*) FROM attendance a WHERE a.client_id=c.id) visits,
                      (SELECT COUNT(*) FROM client_waivers w WHERE w.client_id=c.id) waivers
                 FROM clients c WHERE c.id = %s::uuid""",
            (client_id,),
        )
        row = cur.fetchone() or {}
        # A signed liability release is not ours to throw away on a tap.
        if row.get("waivers"):
            return jsonify({
                "error": "This client has a signed waiver on file. "
                         "Mark them 'No longer a client' instead, which keeps the record.",
                "code": "has_waiver",
            }), 409
        cur.execute("DELETE FROM clients WHERE id = %s::uuid", (client_id,))
        db.commit()
        return jsonify({"success": True, "name": row.get("display_name"),
                        "visits": row.get("visits", 0)})
    finally:
        db.close()


@checkin_bp.route("/bulk-tag", methods=["POST"])
@require_auth
def bulk_tag():
    """
    Apply one tag to many people at once.

    This endpoint exists because tagging 148 clients one card at a time is
    exactly the cost that left the old FileMaker contact file empty for years.
    If bulk tagging is awkward, nothing ever gets tagged and the sport and
    session filters stay permanently useless.
    """
    user_id = request.current_user["user_id"]
    data = request.json or {}
    ids = data.get("client_ids") or []
    if not isinstance(ids, list) or not ids:
        return jsonify({"error": "client_ids required"}), 400
    ids = ids[:500]

    sport = data.get("sport")
    session = data.get("session")
    slot = data.get("slot")
    remove = bool(data.get("remove"))
    if not (sport or session or slot):
        return jsonify({"error": "one of sport, session or slot required"}), 400

    db = get_db()
    try:
        cur = db.cursor()
        frag, params = _scope(cur, user_id)

        if sport:
            sql = (
                f"UPDATE clients c SET sports = array_remove(c.sports, %s), updated_at = NOW() "
                if remove else
                f"UPDATE clients c SET sports = "
                f"  (SELECT ARRAY(SELECT DISTINCT unnest(c.sports || ARRAY[%s::text]))), "
                f"  updated_at = NOW() "
            )
            cur.execute(sql + f"WHERE c.id = ANY(%s::uuid[]) AND {frag}", (str(sport)[:60], ids, *params))
        if session:
            sql = (
                f"UPDATE clients c SET sessions = array_remove(c.sessions, %s), updated_at = NOW() "
                if remove else
                f"UPDATE clients c SET sessions = "
                f"  (SELECT ARRAY(SELECT DISTINCT unnest(c.sessions || ARRAY[%s::text]))), "
                f"  updated_at = NOW() "
            )
            cur.execute(sql + f"WHERE c.id = ANY(%s::uuid[]) AND {frag}", (str(session)[:40], ids, *params))
        if slot:
            cur.execute(
                f"UPDATE clients c SET slot = %s, updated_at = NOW() "
                f"WHERE c.id = ANY(%s::uuid[]) AND {frag}",
                (None if remove else str(slot)[:20], ids, *params),
            )

        db.commit()
        return jsonify({"success": True, "count": len(ids)})
    finally:
        db.close()


@checkin_bp.route("/client", methods=["POST"])
@require_auth
def create_client():
    """Add someone who walked in and isn't on the list yet."""
    user_id = request.current_user["user_id"]
    data = request.json or {}
    first = (data.get("first_name") or "").strip()
    last = (data.get("last_name") or "").strip()
    display = (data.get("display_name") or f"{first} {last}").strip()
    if not display:
        return jsonify({"error": "A name is required"}), 400

    billing = data.get("billing_type") or "monthly"
    if billing not in BILLING_TYPES:
        return jsonify({"error": f"bad billing_type: {billing}"}), 400

    db = get_db()
    try:
        cur = db.cursor()
        cur.execute("SELECT gym_id FROM users WHERE id = %s", (user_id,))
        gym_id = (cur.fetchone() or {}).get("gym_id")
        cur.execute(
            """
            INSERT INTO clients (coach_id, gym_id, first_name, last_name,
                                 display_name, billing_type, cell_phone, email)
            VALUES (%s,%s,%s,%s,%s,%s,%s,%s) RETURNING id
            """,
            (user_id, gym_id, first, last, display, billing,
             data.get("cell_phone"), data.get("email")),
        )
        new_id = cur.fetchone()["id"]
        db.commit()
        return jsonify({"success": True, "id": str(new_id)})
    finally:
        db.close()


# ── Away: vacation, work, injured ────────────────────────────────────────────
#
# Deliberately NOT the `status` column. 'paused' is a decision about a
# membership — on hold, probably not billing. Away is a fact about a person:
# in Florida until the 8th, still a member, still owes September. Folding one
# into the other would mean either pausing people who should still be billed,
# or having no way at all to say why a regular hasn't been in for two weeks.

@checkin_bp.route("/away", methods=["POST"])
@require_auth
def set_away():
    """
    Mark someone away. `ends_on` is the LAST day away and may be null — gone,
    back when they're back, which is what the coach usually actually knows.
    """
    user_id = request.current_user["user_id"]
    data = request.json or {}
    client_id = data.get("client_id")
    reason = (data.get("reason") or "").strip()[:40]
    if not client_id or not reason:
        return jsonify({"error": "client_id and reason required"}), 400

    try:
        starts_on = dt.date.fromisoformat(data["starts_on"]) if data.get("starts_on") else _today()
        ends_on = dt.date.fromisoformat(data["ends_on"]) if data.get("ends_on") else None
    except ValueError:
        return jsonify({"error": "dates must be YYYY-MM-DD"}), 400
    if ends_on and ends_on < starts_on:
        return jsonify({"error": "They can't be back before they've gone"}), 400

    db = get_db()
    try:
        cur = db.cursor()
        if not _owns(cur, user_id, client_id):
            return jsonify({"error": "Not found"}), 404

        # One absence at a time. Re-marking someone who is already away is an
        # edit — a corrected return date, a changed reason — not a second trip,
        # and two overlapping rows would make `client_away` pick a winner
        # arbitrarily rather than obviously.
        cur.execute(
            """DELETE FROM client_absences
                WHERE client_id = %s::uuid
                  AND (ends_on IS NULL OR ends_on >= %s::date)""",
            (client_id, _today()),
        )
        cur.execute(
            """INSERT INTO client_absences (client_id, reason, note, starts_on, ends_on, created_by)
               VALUES (%s::uuid, %s, %s, %s, %s, %s) RETURNING id""",
            (client_id, reason, (data.get("note") or "").strip()[:120] or None,
             starts_on, ends_on, user_id),
        )
        aid = cur.fetchone()["id"]
        db.commit()
        return jsonify({
            "success": True, "id": str(aid), "reason": reason,
            "note": (data.get("note") or "").strip()[:120] or None,
            "since": starts_on.isoformat(),
            "back": (ends_on + dt.timedelta(days=1)).isoformat() if ends_on else None,
        })
    finally:
        db.close()


@checkin_bp.route("/away/end", methods=["POST"])
@require_auth
def end_away():
    """They're back. Closes the absence rather than deleting the history of it."""
    user_id = request.current_user["user_id"]
    data = request.json or {}
    client_id = data.get("client_id")
    if not client_id:
        return jsonify({"error": "client_id required"}), 400

    db = get_db()
    try:
        cur = db.cursor()
        if not _owns(cur, user_id, client_id):
            return jsonify({"error": "Not found"}), 404
        n = _end_absence(cur, client_id, _today())
        db.commit()
        return jsonify({"success": True, "ended": n})
    finally:
        db.close()


@checkin_bp.route("/away/<client_id>", methods=["GET"])
@require_auth
def away_history(client_id):
    """Every absence on record. 'That's her fourth trip since March' is the
    thing worth knowing when she asks about her session balance."""
    user_id = request.current_user["user_id"]
    db = get_db()
    try:
        cur = db.cursor()
        if not _owns(cur, user_id, client_id):
            return jsonify({"error": "Not found"}), 404
        cur.execute(
            """SELECT id, reason, note, starts_on, ends_on
                 FROM client_absences WHERE client_id = %s::uuid
                ORDER BY starts_on DESC LIMIT 24""",
            (client_id,),
        )
        return jsonify({"success": True, "absences": [{
            "id": str(r["id"]), "reason": r["reason"], "note": r["note"],
            "since": r["starts_on"].isoformat(),
            "back": (r["ends_on"] + dt.timedelta(days=1)).isoformat() if r["ends_on"] else None,
        } for r in cur.fetchall()]})
    finally:
        db.close()


# ── Monthly dues ─────────────────────────────────────────────────────────────

@checkin_bp.route("/payment", methods=["POST"])
@require_auth
def record_payment():
    """
    Log a monthly payment. `paid_on` defaults to today, which is the whole point:
    the common case is one tap on the card the moment cash changes hands.
    """
    user_id = request.current_user["user_id"]
    data = request.json or {}
    client_id = data.get("client_id")
    if not client_id:
        return jsonify({"error": "client_id required"}), 400
    try:
        paid_on = dt.date.fromisoformat(data["paid_on"]) if data.get("paid_on") else _today()
        covers = dt.date.fromisoformat(data["covers_until"]) if data.get("covers_until") else None
    except ValueError:
        return jsonify({"error": "dates must be YYYY-MM-DD"}), 400

    db = get_db()
    try:
        cur = db.cursor()
        if not _owns(cur, user_id, client_id):
            return jsonify({"error": "Not found"}), 404
        cur.execute(
            """
            INSERT INTO client_payments (client_id, paid_on, amount, method, covers_until, note)
            VALUES (%s::uuid, %s, %s, %s, %s, %s) RETURNING id
            """,
            (client_id, paid_on, data.get("amount"), data.get("method"), covers, data.get("note")),
        )
        pid = cur.fetchone()["id"]
        # Everyone sharing the pool is now paid up, so return them all.
        cur.execute(
            """SELECT d.client_id, d.last_paid, d.due_on FROM client_dues d
                WHERE d.client_id = %s::uuid
                   OR (d.household_id IS NOT NULL AND d.household_id =
                       (SELECT household_id FROM clients WHERE id = %s::uuid))""",
            (client_id, client_id),
        )
        dues = {str(r["client_id"]): {
            "last_paid": r["last_paid"].isoformat() if r["last_paid"] else None,
            "due_on": r["due_on"].isoformat() if r["due_on"] else None,
        } for r in cur.fetchall()}
        row = dues.get(str(client_id), {})
        db.commit()
        return jsonify({"success": True, "id": str(pid),
                        "last_paid": row.get("last_paid"), "due_on": row.get("due_on"),
                        "dues": dues})
    finally:
        db.close()


@checkin_bp.route("/payment/<payment_id>", methods=["DELETE"])
@require_auth
def delete_payment(payment_id):
    """Undo a payment logged by mistake."""
    user_id = request.current_user["user_id"]
    db = get_db()
    try:
        cur = db.cursor()
        frag, params = _scope(cur, user_id)
        cur.execute(
            f"""DELETE FROM client_payments p USING clients c
                 WHERE p.id = %s::uuid AND c.id = p.client_id AND {frag}""",
            (payment_id, *params),
        )
        found = cur.rowcount
        db.commit()
        return (jsonify({"success": True}) if found
                else (jsonify({"error": "Not found"}), 404))
    finally:
        db.close()


@checkin_bp.route("/payments/<client_id>", methods=["GET"])
@require_auth
def list_payments(client_id):
    user_id = request.current_user["user_id"]
    db = get_db()
    try:
        cur = db.cursor()
        if not _owns(cur, user_id, client_id):
            return jsonify({"error": "Not found"}), 404
        cur.execute(
            """SELECT id, paid_on, amount, method, covers_until, note
                 FROM client_payments WHERE client_id = %s::uuid
                ORDER BY paid_on DESC LIMIT 24""",
            (client_id,),
        )
        return jsonify({"success": True, "payments": [{
            "id": str(r["id"]), "paid_on": r["paid_on"].isoformat(),
            "amount": float(r["amount"]) if r["amount"] is not None else None,
            "method": r["method"],
            "covers_until": r["covers_until"].isoformat() if r["covers_until"] else None,
            "note": r["note"],
        } for r in cur.fetchall()]})
    finally:
        db.close()


# ── Households: who shares a pool ────────────────────────────────────────────

@checkin_bp.route("/household/add", methods=["POST"])
@require_auth
def household_add():
    """
    Put two clients on the same pool. If the first is already in a household the
    second joins it; otherwise a new one is created named after their surname.
    """
    user_id = request.current_user["user_id"]
    data = request.json or {}
    a, b = data.get("client_id"), data.get("with_client_id")
    if not a or not b:
        return jsonify({"error": "client_id and with_client_id required"}), 400
    if a == b:
        return jsonify({"error": "Cannot share a pool with themselves"}), 400

    db = get_db()
    try:
        cur = db.cursor()
        if not (_owns(cur, user_id, a) and _owns(cur, user_id, b)):
            return jsonify({"error": "Not found"}), 404

        cur.execute("""SELECT id, display_name, last_name, household_id
                         FROM clients WHERE id IN (%s::uuid, %s::uuid)""", (a, b))
        rows = {str(r["id"]): r for r in cur.fetchall()}
        ra, rb = rows.get(a), rows.get(b)

        hid = ra["household_id"] or rb["household_id"]
        if not hid:
            name = (ra["last_name"] or ra["display_name"] or "Family").strip()
            cur.execute(
                """INSERT INTO households (coach_id, name, payer_id, note)
                   VALUES (%s, %s, %s::uuid, %s) RETURNING id""",
                (user_id, name, a, "Created from the check-in card"),
            )
            hid = cur.fetchone()["id"]

        cur.execute("UPDATE clients SET household_id = %s, updated_at = NOW() "
                    "WHERE id IN (%s::uuid, %s::uuid)", (hid, a, b))
        cur.execute("SELECT name, remaining, members FROM household_balance WHERE household_id = %s", (hid,))
        h = cur.fetchone() or {}
        bal = _balances_after(cur, a)
        db.commit()
        return jsonify({"success": True, "household_id": str(hid),
                        "name": h.get("name"), "members": h.get("members"),
                        "remaining": float(h["remaining"]) if h.get("remaining") is not None else None,
                        "balances": bal})
    finally:
        db.close()


@checkin_bp.route("/household/remove", methods=["POST"])
@require_auth
def household_remove():
    """
    Take someone off a shared pool. Their own purchases and visits go back to
    being their own balance, which may well be a number that needs adjusting —
    the pool was hiding it, not fixing it.
    """
    user_id = request.current_user["user_id"]
    data = request.json or {}
    client_id = data.get("client_id")
    if not client_id:
        return jsonify({"error": "client_id required"}), 400

    db = get_db()
    try:
        cur = db.cursor()
        if not _owns(cur, user_id, client_id):
            return jsonify({"error": "Not found"}), 404
        cur.execute("SELECT household_id FROM clients WHERE id = %s::uuid", (client_id,))
        hid = (cur.fetchone() or {}).get("household_id")
        cur.execute("UPDATE clients SET household_id = NULL, updated_at = NOW() WHERE id = %s::uuid",
                    (client_id,))
        # A pool of one is just a person; clear it rather than leaving a husk.
        left = []
        if hid:
            cur.execute("SELECT id FROM clients WHERE household_id = %s", (hid,))
            left = [str(r["id"]) for r in cur.fetchall()]
            if len(left) < 2:
                cur.execute("UPDATE clients SET household_id = NULL WHERE household_id = %s", (hid,))
                cur.execute("DELETE FROM households WHERE id = %s", (hid,))

        cur.execute("""SELECT client_id, remaining FROM client_balance
                        WHERE client_id = %s::uuid OR client_id = ANY(%s::uuid[])""",
                    (client_id, left))
        bal = {str(r["client_id"]): (float(r["remaining"]) if r["remaining"] is not None else None)
               for r in cur.fetchall()}
        db.commit()
        return jsonify({"success": True, "balances": bal, "dissolved": bool(hid) and len(left) < 2})
    finally:
        db.close()


# ── Session credits: adjust and transfer ─────────────────────────────────────
#
# Glen used to do this by typing a new name into the ledger — 'Wendorf Troy to
# grady', 'Bushweiler, Kristin (Joel)' — because there was nowhere else to put
# it. That is what created ~157 phantom clients. These two endpoints are the
# thing that was missing.
#
# Both write `session_packages` rows flagged is_adjustment, never edits or
# deletes history: the arithmetic stays visible and every move carries a note.

@checkin_bp.route("/sessions/adjust", methods=["POST"])
@require_auth
def adjust_sessions():
    """Add or remove sessions for one client. Negative removes."""
    user_id = request.current_user["user_id"]
    data = request.json or {}
    client_id = data.get("client_id")
    try:
        sessions = float(data.get("sessions"))
    except (TypeError, ValueError):
        return jsonify({"error": "sessions must be a number"}), 400
    if not client_id or sessions == 0:
        return jsonify({"error": "client_id and a non-zero sessions value required"}), 400

    db = get_db()
    try:
        cur = db.cursor()
        if not _owns(cur, user_id, client_id):
            return jsonify({"error": "Not found"}), 404
        cur.execute(
            """INSERT INTO session_packages
                 (client_id, purchased_on, sessions_purchased, amount_paid,
                  is_adjustment, needs_review, note)
               VALUES (%s::uuid, CURRENT_DATE, %s, NULL, TRUE, FALSE, %s)""",
            (client_id, sessions, (data.get("note") or "").strip()
             or f"Manual adjustment of {sessions:+g} sessions"),
        )
        cur.execute("SELECT remaining FROM client_balance WHERE client_id = %s::uuid", (client_id,))
        row = cur.fetchone()
        db.commit()
        return jsonify({"success": True, "remaining": float(row["remaining"]) if row else None})
    finally:
        db.close()


@checkin_bp.route("/sessions/transfer", methods=["POST"])
@require_auth
def transfer_sessions():
    """
    Move sessions from one client to another — a parent handing credits to a
    kid, or a kid ageing out and passing them back. Recorded as a matched pair
    so both cards show where the sessions went and where they came from.
    """
    user_id = request.current_user["user_id"]
    data = request.json or {}
    src, dst = data.get("from_client_id"), data.get("to_client_id")
    try:
        sessions = float(data.get("sessions"))
    except (TypeError, ValueError):
        return jsonify({"error": "sessions must be a number"}), 400
    if not src or not dst:
        return jsonify({"error": "from_client_id and to_client_id required"}), 400
    if src == dst:
        return jsonify({"error": "Cannot transfer to the same person"}), 400
    if sessions <= 0:
        return jsonify({"error": "sessions must be positive"}), 400

    db = get_db()
    try:
        cur = db.cursor()
        if not (_owns(cur, user_id, src) and _owns(cur, user_id, dst)):
            return jsonify({"error": "Not found"}), 404
        cur.execute("SELECT id, display_name FROM clients WHERE id IN (%s::uuid, %s::uuid)", (src, dst))
        names = {str(r["id"]): r["display_name"] for r in cur.fetchall()}
        note = (data.get("note") or "").strip()

        cur.execute(
            """INSERT INTO session_packages
                 (client_id, purchased_on, sessions_purchased, is_adjustment, needs_review, note)
               VALUES (%s::uuid, CURRENT_DATE, %s, TRUE, FALSE, %s)""",
            (src, -sessions,
             f"Transferred {sessions:g} sessions to {names.get(dst,'another client')}"
             + (f" — {note}" if note else "")),
        )
        cur.execute(
            """INSERT INTO session_packages
                 (client_id, purchased_on, sessions_purchased, is_adjustment, needs_review, note)
               VALUES (%s::uuid, CURRENT_DATE, %s, TRUE, FALSE, %s)""",
            (dst, sessions,
             f"Received {sessions:g} sessions from {names.get(src,'another client')}"
             + (f" — {note}" if note else "")),
        )
        cur.execute("""SELECT client_id, remaining FROM client_balance
                        WHERE client_id IN (%s::uuid, %s::uuid)""", (src, dst))
        bal = {str(r["client_id"]): float(r["remaining"]) for r in cur.fetchall()}
        db.commit()
        return jsonify({"success": True, "from_remaining": bal.get(src), "to_remaining": bal.get(dst)})
    finally:
        db.close()


# ── Summary ──────────────────────────────────────────────────────────────────

@checkin_bp.route("/summary", methods=["GET"])
@require_auth
def summary():
    """
    Week and month totals, a run of recent weeks, who trained most, and who has
    gone quiet. Adjustments are excluded everywhere — a balance correction is
    not a session and would inflate every one of these numbers.
    """
    user_id = request.current_user["user_id"]
    db = get_db()
    try:
        cur = db.cursor()
        frag, params = _scope(cur, user_id)
        real = "a.source <> 'adjustment'"

        def scalar(sql, extra=()):
            cur.execute(sql, (*params, *extra))
            r = cur.fetchone()
            return list(r.values())[0] if r else 0

        base = f"FROM attendance a JOIN clients c ON c.id = a.client_id WHERE {frag} AND {real}"

        # Weeks start Monday; months on the 1st. date_trunc handles both.
        out = {}
        for unit in ("week", "month"):
            out[unit] = {
                "total": scalar(f"SELECT COUNT(*) n {base} AND date_trunc('{unit}', a.attended_on) = date_trunc('{unit}', CURRENT_DATE)"),
                "prev": scalar(f"SELECT COUNT(*) n {base} AND date_trunc('{unit}', a.attended_on) = date_trunc('{unit}', CURRENT_DATE - INTERVAL '1 {unit}')"),
                "people": scalar(f"SELECT COUNT(DISTINCT a.client_id) n {base} AND date_trunc('{unit}', a.attended_on) = date_trunc('{unit}', CURRENT_DATE)"),
            }

        cur.execute(
            f"""SELECT date_trunc('week', a.attended_on)::date AS bucket, COUNT(*) AS n
                  {base} AND a.attended_on >= date_trunc('week', CURRENT_DATE) - INTERVAL '11 weeks'
                 GROUP BY 1 ORDER BY 1""",
            params,
        )
        weeks = [{"start": r["bucket"].isoformat(), "n": r["n"]} for r in cur.fetchall()]

        cur.execute(
            f"""SELECT date_trunc('month', a.attended_on)::date AS bucket, COUNT(*) AS n
                  {base} AND a.attended_on >= date_trunc('month', CURRENT_DATE) - INTERVAL '11 months'
                 GROUP BY 1 ORDER BY 1""",
            params,
        )
        months = [{"start": r["bucket"].isoformat(), "n": r["n"]} for r in cur.fetchall()]

        cur.execute(
            f"""SELECT c.display_name AS name, COUNT(*) AS n
                  {base} AND date_trunc('month', a.attended_on) = date_trunc('month', CURRENT_DATE)
                 GROUP BY 1 ORDER BY n DESC, 1 LIMIT 8""",
            params,
        )
        top = [{"name": r["name"], "n": r["n"]} for r in cur.fetchall()]

        # Active people who have gone quiet — the number worth acting on.
        cur.execute(
            f"""SELECT c.display_name AS name, MAX(a.attended_on) AS last
                  FROM clients c LEFT JOIN attendance a
                    ON a.client_id = c.id AND a.source <> 'adjustment'
                 WHERE {frag} AND c.status = 'active'
                 GROUP BY c.id, c.display_name
                HAVING MAX(a.attended_on) < CURRENT_DATE - INTERVAL '21 days'
                    OR MAX(a.attended_on) IS NULL
                 ORDER BY MAX(a.attended_on) DESC NULLS LAST LIMIT 12""",
            params,
        )
        quiet = [{"name": r["name"], "last": r["last"].isoformat() if r["last"] else None}
                 for r in cur.fetchall()]

        cur.execute(
            f"""SELECT COALESCE(SUM(p.amount), 0) AS s, COUNT(*) AS n
                  FROM client_payments p JOIN clients c ON c.id = p.client_id
                 WHERE {frag} AND date_trunc('month', p.paid_on) = date_trunc('month', CURRENT_DATE)""",
            params,
        )
        pay = cur.fetchone() or {}

        return jsonify({
            "success": True, "week": out["week"], "month": out["month"],
            "weeks": weeks, "months": months, "top": top, "quiet": quiet,
            "paid_this_month": {"total": float(pay.get("s") or 0), "count": pay.get("n") or 0},
        })
    finally:
        db.close()


# ── Day view, for reconciling later ──────────────────────────────────────────

@checkin_bp.route("/day", methods=["GET"])
@require_auth
def day():
    user_id = request.current_user["user_id"]
    on = request.args.get("date")
    try:
        d = dt.date.fromisoformat(on) if on else _today()
    except ValueError:
        return jsonify({"error": "date must be YYYY-MM-DD"}), 400

    db = get_db()
    try:
        cur = db.cursor()
        frag, params = _scope(cur, user_id)
        cur.execute(
            f"""
            SELECT c.id, c.display_name, c.billing_type,
                   a.attended_at, a.paid, a.amount, a.sessions_used, a.note
            FROM attendance a JOIN clients c ON c.id = a.client_id
            WHERE {frag} AND a.attended_on = %s
            ORDER BY a.attended_at NULLS LAST, c.display_name
            """,
            (*params, d),
        )
        rows = [{
            "id": str(r["id"]),
            "name": r["display_name"],
            "billing": r["billing_type"],
            "at": r["attended_at"].isoformat() if r["attended_at"] else None,
            "paid": r["paid"],
            "amount": float(r["amount"]) if r["amount"] is not None else None,
            "sessions_used": float(r["sessions_used"]),
            "note": r["note"],
        } for r in cur.fetchall()]
        unpaid = [r for r in rows if r["billing"] == "drop_in" and r["paid"] is not True]
        return jsonify({"success": True, "date": d.isoformat(),
                        "count": len(rows), "rows": rows, "unpaid": unpaid})
    finally:
        db.close()


# ── The waiver hook ──────────────────────────────────────────────────────────
#
# The liability waiver is signed on the leaderboard (Node + SQLite). The CRM is
# Flask + Postgres. Until this existed the only bridge between them was
# scripts/import_waivers.py, run by hand — so a waiver signed on Tuesday was
# invisible on the check-in screen until somebody remembered to run a script.
# There was no error and nothing to notice: the person simply wasn't there.
#
# This is that script's decision table, for one signature, live. It deliberately
# keeps the script's central rule: NEVER MATCH PEOPLE ON A SIMILARITY SCORE.
# Fuzzy matching once merged two boys both called James Wagner — stepbrothers,
# different parents — and put one child's liability release on the other's card.
# So the only automatic link is an exact normalized name with exactly one hit.
# Everything else creates a new client, flagged for review.
#
# That asymmetry is on purpose. A duplicate client is visible in the roster and
# mergeable with scripts/merge_clients.py. A release filed against the wrong
# child is neither.

WAIVER_HOOK_COACH_EMAIL = os.environ.get("WAIVER_HOOK_COACH_EMAIL", "wisco.barbell@gmail.com")


def _name_key(s):
    """'James (Jed) Wagner' -> 'james wagner'. Same normalization the import
    script uses, so the hook and a later re-run agree on who is who."""
    import re
    import unicodedata
    s = unicodedata.normalize("NFKD", s or "").replace("’", "'")
    s = re.sub(r"\(.*?\)", " ", s)                      # drop "(Jed)" nicknames
    s = re.sub(r"[^a-z ]", " ", s.lower())
    return " ".join(t for t in s.split() if len(t) > 1)


def _split_person(name):
    """'Jane Smith' or 'Smith, Jane' -> ('Jane', 'Smith')."""
    import re
    n = re.sub(r"\s+", " ", (name or "").strip())
    if not n:
        return "", ""
    if "," in n:
        last, _, first = n.partition(",")
        return first.strip(), last.strip()
    parts = n.split(" ")
    return (" ".join(parts[:-1]), parts[-1]) if len(parts) > 1 else (n, "")


def _signed_at(raw):
    """The leaderboard sends an ISO-8601 UTC instant. Parse it as one.

    This matters more than it looks: `signed_at` is timestamptz and this
    connection is pinned to Central, so handing Postgres a naive
    '2026-08-26 00:45:06' would book a 7:45pm signature at 12:45am — five hours
    late, on the wrong day. An aware datetime is unambiguous whatever the
    session timezone is."""
    if not raw:
        return dt.datetime.now(dt.timezone.utc)
    try:
        s = str(raw).strip().replace("Z", "+00:00")
        parsed = dt.datetime.fromisoformat(s)
        return parsed if parsed.tzinfo else parsed.replace(tzinfo=dt.timezone.utc)
    except ValueError:
        return dt.datetime.now(dt.timezone.utc)


@checkin_bp.route("/waiver-hook", methods=["POST"])
def waiver_hook():
    """
    Called by the leaderboard the moment a release is signed. Server to server,
    so it carries a shared secret rather than a user's JWT.

    Idempotent on `imported_from = 'leaderboard:<waiver id>'`, which already has
    a unique index. Retries, replays and a later run of import_waivers.py all
    land on the same row, so the leaderboard is free to be dumb about failure.
    """
    import hmac

    secret = os.environ.get("WAIVER_HOOK_SECRET")
    if not secret:
        # Fail closed. An unset secret must never mean "let everyone in".
        return jsonify({"error": "Waiver hook is not configured"}), 503
    if not hmac.compare_digest(request.headers.get("X-BSA-Waiver-Secret", ""), secret):
        return jsonify({"error": "Not authorised"}), 401

    w = request.json or {}
    try:
        waiver_id = int(w["waiver_id"])
        athlete_id = int(w["athlete_id"])
    except (KeyError, TypeError, ValueError):
        return jsonify({"error": "waiver_id and athlete_id required"}), 400

    first = (w.get("first_name") or "").strip()
    last = (w.get("last_name") or "").strip()
    if not first and not last:
        return jsonify({"error": "the athlete needs a name"}), 400
    display = f"{first} {last}".strip()
    tag = f"leaderboard:{waiver_id}"

    db = get_db()
    try:
        cur = db.cursor()

        # Already have this signature? Say so and change nothing. Checked before
        # anything is created, so a retry can't leave a duplicate client behind.
        cur.execute("SELECT client_id FROM client_waivers WHERE imported_from = %s", (tag,))
        seen = cur.fetchone()
        if seen:
            return jsonify({"success": True, "already": True,
                            "client_id": str(seen["client_id"]), "action": "none"})

        cur.execute("SELECT id, gym_id FROM users WHERE lower(email) = %s",
                    (WAIVER_HOOK_COACH_EMAIL.lower(),))
        me = cur.fetchone()
        if not me:
            return jsonify({"error": f"No coach with email {WAIVER_HOOK_COACH_EMAIL}"}), 500
        coach_id, gym_id = me["id"], me["gym_id"]

        # ── Who is this? ────────────────────────────────────────────────────
        client_id = None
        action = None
        review = None

        # 1. Signed before. The athlete link is the only identifier here that is
        #    an actual identifier rather than an inference, so it wins outright.
        cur.execute(
            "SELECT id FROM clients WHERE coach_id = %s AND leaderboard_athlete_id = %s",
            (coach_id, athlete_id),
        )
        row = cur.fetchone()
        if row:
            client_id, action = row["id"], "linked-by-athlete"

        # 2. Exactly one client whose normalized name is exactly this name.
        if client_id is None:
            key = _name_key(display)
            cur.execute(
                "SELECT id, display_name, status, leaderboard_athlete_id FROM clients WHERE coach_id = %s",
                (coach_id,),
            )
            hits = [r for r in cur.fetchall() if _name_key(r["display_name"]) == key] if key else []

            if len(hits) == 1 and hits[0]["leaderboard_athlete_id"] in (None, athlete_id):
                client_id, action = hits[0]["id"], "linked-by-name"
                # Signing a release means they are coming. Wake up a dormant
                # ledger row — but never override a decision Glen made by hand:
                # 'paused' and 'former' are his words and stay his.
                if hits[0]["status"] in ("inactive", "prospect"):
                    cur.execute(
                        "UPDATE clients SET status = 'active', status_changed_at = NOW() WHERE id = %s",
                        (client_id,),
                    )
            elif len(hits) == 1:
                # The one name match is already spoken for by a DIFFERENT
                # athlete. This is precisely the Wagner brothers, and the right
                # answer is a second card, not a shared one.
                review = (f"Waiver hook: name matches '{hits[0]['display_name']}', who is already "
                          f"linked to a different leaderboard athlete. Made a separate client — "
                          f"check whether these are two people or one.")
            elif len(hits) > 1:
                review = (f"Waiver hook: {len(hits)} existing clients are also called '{display}'. "
                          f"Made a separate client rather than guess — merge with "
                          f"scripts/merge_clients.py if this is one of them.")

        # 3. Nobody, or nobody we dare pick. Make a card.
        if client_id is None:
            cur.execute(
                """
                INSERT INTO clients (coach_id, gym_id, first_name, last_name, display_name,
                                     date_of_birth, status, billing_type, notes)
                VALUES (%s,%s,%s,%s,%s,%s,'active','monthly',%s) RETURNING id
                """,
                (coach_id, gym_id, first, last, display, w.get("dob") or None, review),
            )
            client_id = cur.fetchone()["id"]
            action = "created-for-review" if review else "created"

        # ── Everything the waiver carries that the ledger never had ─────────
        # Only fill blanks. A waiver is not allowed to overwrite something Glen
        # typed on the card himself.
        g_first, g_last = _split_person(w.get("parent_name"))
        cur.execute(
            """
            UPDATE clients SET
              leaderboard_athlete_id = COALESCE(leaderboard_athlete_id, %s),
              date_of_birth  = COALESCE(date_of_birth, %s),
              street         = COALESCE(NULLIF(street,''), %s),
              city           = COALESCE(NULLIF(city,''), %s),
              state          = COALESCE(NULLIF(state,''), %s),
              zip            = COALESCE(NULLIF(zip,''), %s),
              guardian_first = COALESCE(NULLIF(guardian_first,''), %s),
              guardian_last  = COALESCE(NULLIF(guardian_last,''), %s),
              guardian_email = COALESCE(NULLIF(guardian_email,''), %s),
              guardian_phone = COALESCE(NULLIF(guardian_phone,''), %s),
              updated_at = NOW()
            WHERE id = %s
            """,
            (athlete_id, w.get("dob") or None,
             # The leaderboard collects the address as four fields and only
             # joins them for display, so ask for the parts and skip the
             # guesswork the import script has to do on a flattened string.
             (w.get("address_street") or "").strip() or None,
             (w.get("address_city") or "").strip() or None,
             (w.get("address_state") or "").strip().upper() or None,
             (w.get("address_zip") or "").strip() or None,
             g_first or None, g_last or None,
             (w.get("parent_email") or "").strip() or None,
             (w.get("parent_phone") or "").strip() or None,
             client_id),
        )

        # Adult or minor at the moment of signing decides who the signature is
        # attributed to — a guardian's release does not cover an adult.
        signed_at = _signed_at(w.get("signed_at"))
        signed_by = "guardian"
        try:
            born = dt.date.fromisoformat(str(w.get("dob"))[:10])
            when = signed_at.date()
            age = when.year - born.year - ((when.month, when.day) < (born.month, born.day))
            signed_by = "self" if age >= 18 else "guardian"
        except (TypeError, ValueError):
            pass

        cur.execute(
            """
            INSERT INTO client_waivers
              (client_id, version, signed_at, typed_name, signed_by,
               guardian_name, guardian_email, guardian_phone, ip, user_agent, imported_from)
            VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
            ON CONFLICT (imported_from) WHERE imported_from IS NOT NULL DO NOTHING
            RETURNING id
            """,
            (client_id, w.get("waiver_version") or "unknown", signed_at,
             (w.get("signed_name") or w.get("parent_name") or display).strip(), signed_by,
             (w.get("parent_name") or "").strip() or None,
             (w.get("parent_email") or "").strip() or None,
             (w.get("parent_phone") or "").strip() or None,
             (w.get("ip_address") or "").strip() or None,
             (w.get("user_agent") or "").strip() or None,
             tag),
        )
        wrote = cur.fetchone()
        db.commit()
        return jsonify({"success": True, "client_id": str(client_id), "action": action,
                        "waiver_recorded": bool(wrote), "needs_review": bool(review),
                        "name": display})
    except Exception as e:
        db.rollback()
        # The leaderboard must never lose a signature because the CRM had a bad
        # day, so it treats this as advisory. Say what broke and let it move on.
        return jsonify({"error": str(e)}), 500
    finally:
        db.close()
