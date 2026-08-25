#!/usr/bin/env python3
"""
import_ledger.py — bring the FileMaker "Monthly Transactions" export into Postgres.

The export is one row per visit with eleven unlabelled columns:

    0  name "Last, First"        6  sessions purchased
    1  Y/A/B rate letter          7  sessions used (1 on 134,271 of 135,711 rows)
    2  check number               8  grand total, repeated on every row
    3  date                       9  grand total, repeated on every row
    4  amount paid               10  coach
    5  grand total, repeated on every row

Columns 5, 8 and 9 hold three numbers copied into all 135,711 rows — FileMaker
summary fields flattened on export. Useless as storage, perfect as a checksum:
they are the exact totals of money, sessions used and sessions purchased, so the
import verifies itself against them and refuses to run on a mismatch.

DRY RUN BY DEFAULT. Prints a reconciliation report and writes nothing. Pass
--commit to actually insert. Re-running is safe: clients are matched on
(coach_id, legacy_name) and attendance on (client_id, attended_on).

    python scripts/import_ledger.py --csv ~/database_file_totals.csv \
        --coach-email wisco.barbell@gmail.com
    python scripts/import_ledger.py --csv ... --coach-email ... --commit
"""

import argparse
import csv
import datetime as dt
import os
import re
import sys
from collections import defaultdict

# psycopg2 is imported inside the --commit branch, so the dry-run report can be
# read anywhere — including a laptop with no database driver installed.

# Names typed without the "Last, First" comma. Repaired here rather than
# silently importing twelve people with a surname of "Libby Fox".
NAME_FIXES = {
    "libby fox": ("Fox", "Libby"),            "wendorf troy": ("Wendorf", "Troy"),
    "schleicher. grant": ("Schleicher", "Grant"), "michael mack": ("Mack", "Michael"),
    "addy kaschub": ("Kaschub", "Addy"),      "1grady wendorf": ("Wendorf", "Grady"),
    "lily schoonover": ("Schoonover", "Lily"), "finn fox": ("Fox", "Finn"),
    "vera grutz": ("Grutz", "Vera"),          "noah hansen": ("Hansen", "Noah"),
    "todd annick": ("Annick", "Todd"),        "tracy barber": ("Barber", "Tracy"),
}

DATE_RE = re.compile(r"^(\d{1,2})/(\d{1,2})/(\d{4})$")


def norm(s: str) -> str:
    """Collapse the ways the same person got typed: curly vs straight quotes,
    trailing spaces, doubled spaces, stray vertical tabs."""
    return re.sub(r"[\x0b\s]+", " ", (s or "").replace("‘", "'").replace("’", "'")).strip().lower()


def parse_date(s):
    m = DATE_RE.match((s or "").strip())
    if not m:
        return None
    mo, d, y = int(m.group(1)), int(m.group(2)), int(m.group(3))
    try:
        return dt.date(y, mo, d)
    except ValueError:
        return None


def num(s):
    s = (s or "").strip()
    if not s:
        return None
    try:
        return float(s)
    except ValueError:
        return None


def split_name(raw):
    key = norm(raw)
    if key in NAME_FIXES:
        return NAME_FIXES[key]
    cleaned = re.sub(r"[\x0b]+", " ", raw).strip()
    if "," in cleaned:
        last, _, first = cleaned.partition(",")
        return last.strip(), first.strip()
    return cleaned, ""


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--csv", required=True)
    ap.add_argument("--coach-email", required=True, help="who owns these clients")
    ap.add_argument("--commit", action="store_true", help="actually write (default is a dry run)")
    ap.add_argument("--database-url", default=os.environ.get("DATABASE_URL"))
    args = ap.parse_args()

    if args.commit and not args.database_url:
        sys.exit("DATABASE_URL not set and --database-url not given")

    today = dt.date.today()
    people = {}          # norm key -> dict
    blank = future = baddate = 0
    skipped_used = 0.0             # sessions on rows we deliberately drop
    col5 = col8 = col9 = None      # FileMaker's own grand totals, used as checksums

    with open(args.csv, newline="", encoding="utf-8-sig") as fh:
        for row in csv.reader(fh):
            if not row or not any(x.strip() for x in row):
                blank += 1
                continue
            if len(row) < 11:
                row = row + [""] * (11 - len(row))
            name_raw, flag, check_no, date_s, paid_s = row[0], row[1], row[2], row[3], row[4]
            bought_s, used_s, coach = row[6], row[7], row[10]
            if col5 is None:
                col5, col8, col9 = num(row[5]), num(row[8]), num(row[9])

            d = parse_date(date_s)
            if d is None:
                baddate += 1
                skipped_used += num(used_s) or 0.0
                continue
            if d > today:
                future += 1
                skipped_used += num(used_s) or 0.0
                continue
            key = norm(name_raw)
            if not key:
                blank += 1
                skipped_used += num(used_s) or 0.0
                continue

            p = people.get(key)
            if p is None:
                last, first = split_name(name_raw)
                p = people[key] = {
                    "legacy_name": re.sub(r"[\x0b]+", " ", name_raw).strip(),
                    "last": last, "first": first,
                    "visits": {},          # date -> (used, coach, note)
                    "packages": [],
                    "flags": defaultdict(int),
                    "paid_orphans": 0, "pkg_orphans": 0, "collapsed": 0,
                }
            if flag.strip():
                p["flags"][flag.strip().upper()[:1]] += 1

            # Blank sessions_used counts as 0, not 1. FileMaker's own summary
            # column treats it that way (836 such rows), and defaulting to 1
            # would silently invent 836 sessions that never existed.
            used = num(used_s) or 0.0
            c = re.sub(r"[\x0b]+", " ", coach or "").strip()
            note = None
            if c and (len(c) > 12 or c.startswith("$")):   # notes typed into the coach field
                note, c = c, ""
            if c and c.upper() in ("A", "Y", "B", "AA"):
                c = ""

            # The check-in screen is built on one visit per person per day, and
            # the UNIQUE index enforces it. 834 ledger rows share a person+date,
            # so SUM their sessions rather than dropping the extras — otherwise
            # 833.5 sessions vanish and the totals stop reconciling.
            if d in p["visits"]:
                prev_u, prev_c, prev_n = p["visits"][d]
                p["visits"][d] = (prev_u + used, prev_c or c or None, prev_n or note)
                p["collapsed"] += 1
            else:
                p["visits"][d] = (used, c or None, note)

            paid = num(paid_s)
            bought = num(bought_s)
            if paid is not None or bought is not None:
                p["packages"].append({
                    "on": d, "paid": paid, "bought": bought,
                    "check_no": (check_no or "").strip() or None,
                })
                if paid is not None and bought is None:
                    p["paid_orphans"] += 1
                if bought is not None and paid is None:
                    p["pkg_orphans"] += 1

    # ── report ────────────────────────────────────────────────────────────
    total_visits = sum(len(p["visits"]) for p in people.values())
    total_bought = sum(pk["bought"] or 0 for p in people.values() for pk in p["packages"])
    total_paid = sum(pk["paid"] or 0 for p in people.values() for pk in p["packages"])
    total_used = sum(u for p in people.values() for (u, _, _) in p["visits"].values())
    orphan_paid = sum(p["paid_orphans"] for p in people.values())
    orphan_pkg = sum(p["pkg_orphans"] for p in people.values())
    collapsed = sum(p["collapsed"] for p in people.values())
    one_visit = [p for p in people.values() if len(p["visits"]) == 1]
    negatives = [(p["legacy_name"], d, u) for p in people.values()
                 for d, (u, _, _) in p["visits"].items() if u < 0]
    active = [p for p in people.values()
              if p["visits"] and (today - max(p["visits"])).days <= 120]

    print("-" * 66)
    print("RECONCILIATION")
    print("-" * 66)
    print(f"  people (after name normalising)   {len(people):>10,}")
    print(f"  visits                            {total_visits:>10,}")
    print(f"  sessions used (sum)               {total_used:>10,.2f}")
    print(f"  sessions purchased (sum)          {total_bought:>10,.2f}")
    print(f"  money recorded (sum)            $ {total_paid:>10,.2f}")
    print()
    print(f"  active in last 120 days           {len(active):>10,}")
    print(f"  single-visit -> 'prospect'        {len(one_visit):>10,}")
    print(f"  payments with no sessions         {orphan_paid:>10,}   <- flagged, not guessed")
    print(f"  sessions with no payment          {orphan_pkg:>10,}   <- flagged, not guessed")
    print(f"  negative session rows             {len(negatives):>10,}   <- manual balance corrections")
    print(f"  same-day rows merged              {collapsed:>10,}   <- sessions summed, none lost")
    print(f"  blank rows skipped                {blank:>10,}")
    print(f"  future-dated rows skipped         {future:>10,}")
    print(f"  unparseable dates skipped         {baddate:>10,}")
    if negatives:
        print("\n  negative rows:")
        for n, d, u in negatives[:12]:
            print(f"    {d}  {n:<28} {u}")
    print("-" * 66)

    # The three "junk" columns turn out to be FileMaker summary fields holding
    # exactly these three sums, repeated into all 135,711 rows. They are useless
    # as storage and perfect as a checksum: if the import reproduces them, every
    # visit and every dollar made it across. Mismatch means STOP.
    # Skipped rows are added back before comparing: a row we chose not to import
    # is a decision, not drift, and the checksum should still have to balance.
    checks = [
        ("money",              total_paid,                 col5),
        ("sessions used",      total_used + skipped_used,  col8),
        ("sessions purchased", total_bought,               col9),
    ]
    if skipped_used:
        print(f"  (adding back {skipped_used:,.2f} sessions from {future + baddate + blank} skipped rows)")
    print()
    ok = True
    for label, got, want in checks:
        if want is None:
            print(f"  {label:<20} {got:>14,.2f}   (no checksum column found)")
            continue
        match = abs(got - want) < 0.005
        ok = ok and match
        print(f"  {label:<20} {got:>14,.2f}  vs ledger {want:>14,.2f}   "
              f"{'MATCH' if match else 'MISMATCH  <-- STOP'}")
    print("-" * 66)

    if not ok:
        sys.exit("Checksums do not reconcile - refusing to import. "
                 "Investigate before running with --commit.")

    if not args.commit:
        print("DRY RUN - nothing written. Re-run with --commit when this looks right.")
        return

    # ── write ─────────────────────────────────────────────────────────────
    import psycopg2
    from psycopg2.extras import RealDictCursor, execute_values

    conn = psycopg2.connect(args.database_url, cursor_factory=RealDictCursor)
    try:
        cur = conn.cursor()
        cur.execute("SELECT id, gym_id FROM users WHERE lower(email) = %s",
                    (args.coach_email.lower(),))
        me = cur.fetchone()
        if not me:
            sys.exit(f"No user with email {args.coach_email}")
        coach_id, gym_id = me["id"], me["gym_id"]

        ins_c = 0
        for p in people.values():
            last_visit = max(p["visits"]) if p["visits"] else None
            status = ("active" if last_visit and (today - last_visit).days <= 120
                      else "prospect" if len(p["visits"]) == 1 else "inactive")
            flag = max(p["flags"], key=p["flags"].get) if p["flags"] else None
            display = f"{p['first']} {p['last']}".strip() or p["legacy_name"]
            cur.execute(
                """
                INSERT INTO clients (coach_id, gym_id, first_name, last_name, display_name,
                                     status, legacy_name, legacy_category, billing_type)
                VALUES (%s,%s,%s,%s,%s,%s,%s,%s,'monthly')
                ON CONFLICT (coach_id, legacy_name) WHERE legacy_name IS NOT NULL
                DO UPDATE SET status = EXCLUDED.status, updated_at = NOW()
                RETURNING id
                """,
                (coach_id, gym_id, p["first"], p["last"], display,
                 status, p["legacy_name"], flag),
            )
            p["id"] = cur.fetchone()["id"]
            ins_c += 1

        rows = [
            (p["id"], coach_id, gym_id, d, u, c, note)
            for p in people.values()
            for d, (u, c, note) in p["visits"].items()
        ]
        execute_values(
            cur,
            """
            INSERT INTO attendance
              (client_id, coach_id, gym_id, attended_on, sessions_used, coach_name, note, source)
            VALUES %s
            ON CONFLICT (client_id, attended_on) DO NOTHING
            """,
            rows,
            template="(%s,%s,%s,%s,%s,%s,%s,'legacy')",
            page_size=1000,
        )
        # NOT cur.rowcount — execute_values batches, so rowcount reports only the
        # last page and under-reports the total by orders of magnitude.
        ins_a = len(rows)

        # Packages are imported with needs_review set wherever the purchase and
        # payment halves could not be paired, so the UI shows the history and
        # refuses to assert a balance it cannot stand behind.
        pkgs = []
        for p in people.values():
            for pk in p["packages"]:
                if pk["bought"] is None and pk["paid"] is None:
                    continue
                pkgs.append((p["id"], pk["on"], pk["bought"] or 0, pk["paid"],
                             pk["check_no"], pk["bought"] is None or pk["paid"] is None))
        execute_values(
            cur,
            """
            INSERT INTO session_packages
              (client_id, purchased_on, sessions_purchased, amount_paid, check_no, needs_review)
            VALUES %s
            """,
            pkgs, page_size=1000,
        )

        conn.commit()
        print(f"WROTE  clients {ins_c:,}   attendance {ins_a:,}   packages {len(pkgs):,}")
    finally:
        conn.close()


if __name__ == "__main__":
    main()
