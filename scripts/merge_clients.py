#!/usr/bin/env python3
"""
merge_clients.py — fold duplicate client records into one.

The FileMaker ledger has ~157 name collisions because notes got typed into the
name field over eighteen years:

    Will Wagner              57 visits    <- the person
    Will feb Wagner           1 visit     <- a note about February
    Will January Wagner       1 visit
    Mork, Maggie             46 visits
    Mork, Maggie 9/3, 8,10…   1 visit

The import had no way to tell those apart from genuinely different people —
Beau and Wynn Wagner really are separate kids — so it created a client for each
spelling. This moves the duplicate's visits, packages and waivers onto the
record you keep, then deletes the emptied shell.

DRY RUN BY DEFAULT. Merges are destructive and irreversible, so nothing happens
without --commit, and every merge must be named explicitly. There is deliberately
no "merge everything that looks similar" mode.

    # see what would happen
    python scripts/merge_clients.py --into "Will Wagner" \\
        --from "Will feb Wagner" --from "Will January Wagner"

    # do it
    python scripts/merge_clients.py --into "Will Wagner" --from "..." --commit

    # review sheet of every collision, so a human can decide
    python scripts/merge_clients.py --report
"""

import argparse
import os
import re
import sys
import unicodedata


def key(s):
    s = unicodedata.normalize("NFKD", s or "").replace("’", "'")
    s = re.sub(r"\(.*?\)", " ", s)
    s = re.sub(r"[^a-z ]", " ", s.lower())
    return " ".join(t for t in s.split() if len(t) > 1)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--into", help="display_name of the record to KEEP")
    ap.add_argument("--from", dest="sources", action="append", default=[],
                    help="display_name to fold in (repeatable)")
    ap.add_argument("--from-like", dest="like",
                    help="SQL LIKE pattern for the rows to fold in, e.g. 'Jake %% Powell'. "
                         "Always dry-run first: it prints exactly what it matched.")
    ap.add_argument("--report", action="store_true", help="list every collision group and exit")
    ap.add_argument("--commit", action="store_true")
    ap.add_argument("--coach-email", default="wisco.barbell@gmail.com")
    ap.add_argument("--database-url", default=os.environ.get("DATABASE_URL"))
    args = ap.parse_args()
    if not args.database_url:
        sys.exit("DATABASE_URL not set")

    import psycopg2
    from psycopg2.extras import RealDictCursor

    pg = psycopg2.connect(args.database_url, cursor_factory=RealDictCursor)
    cur = pg.cursor()
    cur.execute("SELECT id FROM users WHERE lower(email)=%s", (args.coach_email.lower(),))
    me = cur.fetchone()
    if not me:
        sys.exit(f"No user {args.coach_email}")
    coach_id = me["id"]

    cur.execute("""
        SELECT c.id, c.display_name, c.legacy_name, c.status, c.date_of_birth,
               c.leaderboard_athlete_id,
               (SELECT COUNT(*) FROM attendance a WHERE a.client_id=c.id) visits,
               (SELECT MAX(attended_on) FROM attendance a WHERE a.client_id=c.id) last_visit,
               (SELECT COUNT(*) FROM client_waivers w WHERE w.client_id=c.id) waivers
        FROM clients c WHERE c.coach_id=%s
    """, (coach_id,))
    rows = cur.fetchall()
    by_name = {r["display_name"]: r for r in rows}

    if args.report:
        groups = {}
        for r in rows:
            groups.setdefault(key(r["display_name"]), []).append(r)
        multi = {k: g for k, g in groups.items() if len(g) > 1}
        print(f"{len(multi)} collision groups\n")
        # Most-visits-first: the ones worth a human's attention are the ones
        # where real history is split, not the 1-visit annotation shells.
        for k, g in sorted(multi.items(), key=lambda kv: -sum(x["visits"] for x in kv[1])):
            g.sort(key=lambda r: -r["visits"])
            total = sum(x["visits"] for x in g)
            print(f"  {k}  ({total} visits across {len(g)} records)")
            for r in g:
                mark = "KEEP?" if r is g[0] else "     "
                extra = f" waiver={r['waivers']}" if r["waivers"] else ""
                print(f"    {mark} {r['display_name']!r:<42} {r['visits']:>4} visits  "
                      f"last={r['last_visit'] or '-'}  {r['status']}{extra}")
            print()
        pg.close()
        return

    if args.like:
        # Never silently include the keeper itself in its own merge.
        cur.execute("""SELECT display_name FROM clients
                        WHERE coach_id=%s AND display_name LIKE %s AND display_name <> %s""",
                    (coach_id, args.like, args.into or ""))
        args.sources += [r["display_name"] for r in cur.fetchall()]

    if not args.into or not args.sources:
        sys.exit("Need --into and at least one --from / --from-like (or --report)")

    keep = by_name.get(args.into)
    if not keep:
        sys.exit(f"No client named {args.into!r}")
    srcs = []
    for name in args.sources:
        s = by_name.get(name)
        if not s:
            sys.exit(f"No client named {name!r}")
        if s["id"] == keep["id"]:
            sys.exit("--from and --into are the same record")
        srcs.append(s)

    print("-" * 66)
    print(f"KEEP  {keep['display_name']!r}  {keep['visits']} visits  "
          f"dob={keep['date_of_birth'] or '-'}  waivers={keep['waivers']}")
    for s in srcs:
        print(f"FOLD  {s['display_name']!r}  {s['visits']} visits  waivers={s['waivers']}")
    moved = sum(s["visits"] for s in srcs)
    print(f"\n  visits to move            {moved}")
    print(f"  resulting visit total     {keep['visits'] + moved}")
    print("-" * 66)

    if not args.commit:
        print("DRY RUN - nothing written. Add --commit to merge.")
        pg.close()
        return

    ids = [s["id"] for s in srcs]
    # A visit already on the keeper for the same day wins; the duplicate's row is
    # dropped rather than colliding with the one-per-day unique index.
    cur.execute("""
        DELETE FROM attendance a
         WHERE a.client_id = ANY(%s::uuid[])
           AND EXISTS (SELECT 1 FROM attendance k
                        WHERE k.client_id=%s AND k.attended_on=a.attended_on)
    """, (ids, keep["id"]))
    dropped = cur.rowcount
    cur.execute("UPDATE attendance SET client_id=%s WHERE client_id=ANY(%s::uuid[])",
                (keep["id"], ids))
    kept = cur.rowcount
    cur.execute("UPDATE session_packages SET client_id=%s WHERE client_id=ANY(%s::uuid[])",
                (keep["id"], ids))
    pkgs = cur.rowcount
    cur.execute("UPDATE client_waivers SET client_id=%s WHERE client_id=ANY(%s::uuid[])",
                (keep["id"], ids))
    waivers = cur.rowcount
    # Carry over anything the keeper is missing before the shell is destroyed.
    for s in srcs:
        cur.execute("""
            UPDATE clients SET
              date_of_birth = COALESCE(date_of_birth, %s),
              leaderboard_athlete_id = COALESCE(leaderboard_athlete_id, %s),
              updated_at = NOW()
            WHERE id=%s
        """, (s["date_of_birth"], s["leaderboard_athlete_id"], keep["id"]))
    cur.execute("DELETE FROM clients WHERE id=ANY(%s::uuid[])", (ids,))
    gone = cur.rowcount
    pg.commit()
    print(f"MERGED  visits moved {kept}  same-day dropped {dropped}  "
          f"packages {pkgs}  waivers {waivers}  records deleted {gone}")
    pg.close()


if __name__ == "__main__":
    main()
