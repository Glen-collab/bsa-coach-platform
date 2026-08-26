#!/usr/bin/env python3
"""
import_waivers.py — pull signed liability waivers from the leaderboard into the CRM.

The leaderboard's `waiver_submissions` table is already the right shape — version,
signed name, IP, user agent, timestamp — it is just keyed to `athletes` and lives
in a separate SQLite database. This copies each signature into `client_waivers`
and links the athlete to the matching client.

It also carries across what the ledger never had: **every waiver has a parent
name, email, phone and address, 100% filled.** The address is the child's home
address so it lands on the client; the parent's contact details are stored
explicitly as the guardian's.

READ-ONLY against the leaderboard. It opens the SQLite file with mode=ro and
never writes to it.

DRY RUN BY DEFAULT — prints exactly what it would do and writes nothing.

    python scripts/import_waivers.py --coach-email wisco.barbell@gmail.com
    python scripts/import_waivers.py --coach-email ... --commit
"""

import argparse
import datetime as dt
import os
import re
import sqlite3
import sys
import unicodedata

LEADERBOARD_DB = "/opt/leaderboard-api/server/leaderboard.db"

# Confirmed by Glen on 2026-08-25. These are the same people under a name the
# ledger spells differently — two surname transpositions and two shortened
# first names. Deliberately an explicit list rather than a fuzzy threshold: a
# liability release attached to the wrong person is worse than an unattached
# one, so nothing gets matched on a similarity score.
MANUAL_MATCHES = {
    ("porter", "scheid"):  "Porter Schied",
    ("kamron", "scheid"):  "Kamron Schied",
    ("william", "peiffer"): "Will Peiffer",
    ("samuel", "lochen"):  "Sam Lochen",
}

# Athletes who must get their own client record no matter what the name match
# says. #128 is "James (Jed) Wagner" — a different child from #125 "James
# Wagner" in the same blended family, born 16 months apart. Stripping the
# nickname to match names collapsed two brothers onto one card, which put one
# boy's liability release and the other family's address on the wrong record.
FORCE_NEW_CLIENT = {
    128: ("Jed", "Wagner"),
}


def clean(s):
    s = unicodedata.normalize("NFKD", s or "").replace("’", "'")
    s = re.sub(r"\(.*?\)", " ", s)                  # drop "(Jed)" style nicknames
    return re.sub(r"[^a-z ]", " ", s.lower())


def key(s):
    return " ".join(t for t in clean(s).split() if len(t) > 1)


def utc(raw):
    """SQLite writes signed_at as a naive 'YYYY-MM-DD HH:MM:SS' in UTC.

    Postgres reads a naive timestamp into a timestamptz using the *session*
    timezone, so this only ever worked because the box happens to run UTC. The
    live hook in checkin.py pins its connection to America/Chicago, and anything
    else that follows may too — at which point every signature silently lands
    five hours late. Be explicit instead of lucky.
    """
    if raw is None:
        return None
    try:
        s = str(raw).strip().replace("Z", "+00:00")
        parsed = dt.datetime.fromisoformat(s)
        return parsed if parsed.tzinfo else parsed.replace(tzinfo=dt.timezone.utc)
    except ValueError:
        return raw


def split_person(name):
    """'Jane Smith' or 'Smith, Jane' -> ('Jane', 'Smith')."""
    n = re.sub(r"\s+", " ", (name or "").strip())
    if not n:
        return "", ""
    if "," in n:
        last, _, first = n.partition(",")
        return first.strip(), last.strip()
    parts = n.split(" ")
    return (" ".join(parts[:-1]), parts[-1]) if len(parts) > 1 else (n, "")


def parse_address(addr):
    """
    Wisconsin addresses arrive as four comma parts with the state and zip
    SEPARATE: 'N61W29140 Parkside Pl, Hartland, WI, 53029'. Peel the zip and
    state off the end rather than assuming a fixed part count, so the
    three-part 'City, WI 53029' form works too. Anything unparseable is kept
    whole in `street` rather than shredded across the wrong columns.
    """
    a = re.sub(r"\s+", " ", (addr or "").strip()).rstrip(",")
    if not a:
        return None, None, None, None
    parts = [p.strip() for p in a.split(",") if p.strip()]
    zipc = state = None
    if parts and re.fullmatch(r"\d{5}(?:-\d{4})?", parts[-1]):
        zipc = parts.pop()
    if parts:
        m = re.fullmatch(r"([A-Za-z]{2})\.?", parts[-1])
        if m:
            state = m.group(1).upper(); parts.pop()
        elif re.fullmatch(r"([A-Za-z]{2})\.?\s+(\d{5}(?:-\d{4})?)", parts[-1]):
            m2 = re.fullmatch(r"([A-Za-z]{2})\.?\s+(\d{5}(?:-\d{4})?)", parts[-1])
            state = m2.group(1).upper(); zipc = zipc or m2.group(2); parts.pop()
        else:
            m = re.fullmatch(r"(.*?)\s+([A-Za-z]{2})\.?\s+(\d{5}(?:-\d{4})?)", parts[-1])
            if m:
                parts[-1] = m.group(1); state = m.group(2).upper(); zipc = zipc or m.group(3)
    city = parts.pop() if len(parts) > 1 else None
    street = ", ".join(parts) if parts else None
    return street, city, state, zipc


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--coach-email", required=True)
    ap.add_argument("--commit", action="store_true")
    ap.add_argument("--leaderboard-db", default=LEADERBOARD_DB)
    ap.add_argument("--database-url", default=os.environ.get("DATABASE_URL"))
    args = ap.parse_args()
    if not args.database_url:
        sys.exit("DATABASE_URL not set")

    import psycopg2
    from psycopg2.extras import RealDictCursor

    # ── read the leaderboard, read-only ──────────────────────────────────
    lb = sqlite3.connect(f"file:{args.leaderboard_db}?mode=ro", uri=True)
    lb.row_factory = sqlite3.Row
    waivers = lb.execute("""
        SELECT w.id wid, w.athlete_id, w.parent_name, w.parent_email, w.parent_phone,
               w.parent_address, w.signed_name, w.waiver_version, w.ip_address,
               w.user_agent, w.signed_at,
               a.first_name, a.last_name, a.dob
        FROM waiver_submissions w
        JOIN athletes a ON a.id = w.athlete_id
        ORDER BY w.signed_at
    """).fetchall()
    lb.close()

    pg = psycopg2.connect(args.database_url, cursor_factory=RealDictCursor)
    cur = pg.cursor()
    cur.execute("SELECT id, gym_id FROM users WHERE lower(email) = %s", (args.coach_email.lower(),))
    me = cur.fetchone()
    if not me:
        sys.exit(f"No user with email {args.coach_email}")
    coach_id, gym_id = me["id"], me["gym_id"]

    cur.execute("SELECT id, display_name, date_of_birth, street, status FROM clients WHERE coach_id = %s",
                (coach_id,))
    clients = cur.fetchall()
    by_key = {}
    for c in clients:
        by_key.setdefault(key(c["display_name"]), []).append(c)

    cur.execute("SELECT imported_from FROM client_waivers WHERE imported_from LIKE 'leaderboard:%%'")
    already = {r["imported_from"] for r in cur.fetchall()}

    link, create, skip = [], [], []
    for w in waivers:
        tag = f"leaderboard:{w['wid']}"
        if tag in already:
            skip.append((w, "already imported"))
            continue
        if w["athlete_id"] in FORCE_NEW_CLIENT:
            create.append(w)
            continue
        k = key(f"{w['first_name']} {w['last_name']}")
        hits = by_key.get(k, [])
        if len(hits) == 1:
            link.append((w, hits[0], "exact"))
            continue
        manual = MANUAL_MATCHES.get(((w["first_name"] or "").strip().lower(),
                                     (w["last_name"] or "").strip().lower()))
        if manual:
            m = by_key.get(key(manual), [])
            if len(m) == 1:
                link.append((w, m[0], "confirmed"))
                continue
            skip.append((w, f"confirmed match '{manual}' not found"))
            continue
        if len(hits) > 1:
            skip.append((w, f"ambiguous: {len(hits)} clients"))
            continue
        create.append(w)

    # Two athletes must never land on one client. Name matching cannot see the
    # difference between two children who genuinely share a name — it happened
    # with the Wagner brothers — and the result is one child's liability release
    # sitting on another child's card. Refuse rather than guess.
    seen_client = {}
    for w, c, how in list(link):
        prev = seen_client.get(c["id"])
        if prev is None:
            seen_client[c["id"]] = w
            continue
        for bad in (w, prev):
            if any(x[0] is bad for x in link):
                link.remove(next(x for x in link if x[0] is bad))
                skip.append((bad, f"COLLISION: two athletes match client '{c['display_name']}'"))
        seen_client[c["id"]] = None

    # ── report ───────────────────────────────────────────────────────────
    print("-" * 68)
    print("WAIVER IMPORT")
    print("-" * 68)
    print(f"  signatures on the leaderboard   {len(waivers):>4}")
    print(f"  link to an existing client      {len(link):>4}"
          f"   ({sum(1 for x in link if x[2]=='confirmed')} via confirmed name variants)")
    print(f"  create as a new client          {len(create):>4}")
    print(f"  skipped                         {len(skip):>4}")
    if create:
        print("\n  new clients:")
        for w in create:
            print(f"    {w['first_name']} {w['last_name']:<16} dob {w['dob']}")
    if skip:
        print("\n  skipped:")
        for w, why in skip:
            print(f"    {w['first_name']} {w['last_name']:<16} {why}")

    # what the contact backfill actually gains
    gain_dob = sum(1 for w, c, _ in link if not c["date_of_birth"])
    gain_addr = sum(1 for w, c, _ in link if not c["street"] and (w["parent_address"] or "").strip())
    print(f"\n  birthdays filled in             {gain_dob:>4}")
    print(f"  addresses filled in             {gain_addr:>4}")

    bad = [w for w in waivers if (w["parent_address"] or "").strip()
           and parse_address(w["parent_address"])[1] is None]
    if bad:
        print(f"  addresses kept whole in street  {len(bad):>4}  (would not parse into city/state/zip)")

    print("-" * 68)
    if not args.commit:
        print("DRY RUN - nothing written. Re-run with --commit when this looks right.")
        pg.close()
        return

    # ── write ────────────────────────────────────────────────────────────
    made = 0
    for w in create:
        first, last = (w["first_name"] or "").strip(), (w["last_name"] or "").strip()
        if w["athlete_id"] in FORCE_NEW_CLIENT:
            first, last = FORCE_NEW_CLIENT[w["athlete_id"]]
        cur.execute(
            """
            INSERT INTO clients (coach_id, gym_id, first_name, last_name, display_name,
                                 date_of_birth, status, billing_type)
            VALUES (%s,%s,%s,%s,%s,%s,'active','monthly') RETURNING id, date_of_birth, street
            """,
            (coach_id, gym_id, first, last, f"{first} {last}".strip(), w["dob"]),
        )
        link.append((w, cur.fetchone(), "new"))
        made += 1

    linked = waived = 0
    for w, c, how in link:
        street, city, state, zipc = parse_address(w["parent_address"])
        g_first, g_last = split_person(w["parent_name"])

        # Only fill blanks — never overwrite something already on the card.
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
            (w["athlete_id"], w["dob"], street, city, state, zipc,
             g_first or None, g_last or None,
             (w["parent_email"] or "").strip() or None,
             (w["parent_phone"] or "").strip() or None,
             c["id"]),
        )
        linked += 1

        # Adult or minor at the moment of signing decides who the signature is
        # attributed to — a guardian's release does not cover an adult.
        signed_by = "guardian"
        try:
            born = dt.date.fromisoformat(str(w["dob"])[:10])
            when = dt.date.fromisoformat(str(w["signed_at"])[:10])
            age = when.year - born.year - ((when.month, when.day) < (born.month, born.day))
            signed_by = "self" if age >= 18 else "guardian"
        except Exception:
            pass

        cur.execute(
            """
            INSERT INTO client_waivers
              (client_id, version, signed_at, typed_name, signed_by,
               guardian_name, guardian_email, guardian_phone, ip, user_agent, imported_from)
            VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
            ON CONFLICT (imported_from) WHERE imported_from IS NOT NULL DO NOTHING
            """,
            (c["id"], w["waiver_version"], utc(w["signed_at"]),
             (w["signed_name"] or w["parent_name"] or "").strip(), signed_by,
             (w["parent_name"] or "").strip() or None,
             (w["parent_email"] or "").strip() or None,
             (w["parent_phone"] or "").strip() or None,
             (w["ip_address"] or "").strip() or None,
             (w["user_agent"] or "").strip() or None,
             f"leaderboard:{w['wid']}"),
        )
        waived += cur.rowcount

    pg.commit()
    print(f"WROTE  new clients {made}   linked {linked}   waivers {waived}")
    pg.close()


if __name__ == "__main__":
    main()
