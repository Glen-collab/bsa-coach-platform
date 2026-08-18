#!/usr/bin/env python3
"""Which exercises in live programs will a client actually see a video for?

Run this whenever videos get added. READ-ONLY — it never writes anything.

    ssh ec2-user@3.19.135.182
    cd /opt/bestrongagain
    sudo -E env DATABASE_URL=$(sudo grep -h '^DATABASE_URL' .env | cut -d= -f2-) \
        ./venv/bin/python /tmp/video_coverage.py

Mirrors the three sources the tracker checks, in its order of preference:

  1. a coach upload in trainer_media, matched on EXACT exercise name
  2. the video baked into program_data when the program was saved
  3. the bundled library, resolved at load time from the tracker's swap index

Because 1 and 3 are resolved at LOAD time, most gaps fix themselves the moment
a clip is uploaded — no re-save, no database sweep. This script exists to
answer the only question left: what still has no demo anywhere, and is it
something worth filming?

The library check reads the tracker's exerciseSwapIndex.json when it can be
found (pass --swap-index PATH), since the server has no copy of the library.
Without it, exercises covered only by the library are reported as unknown
rather than guessed at.
"""
import argparse
import json
import os
import sys

import psycopg2
from psycopg2.extras import RealDictCursor

ap = argparse.ArgumentParser()
ap.add_argument("--swap-index", help="path to workouttracker/src/data/exerciseSwapIndex.json")
ap.add_argument("--limit", type=int, default=25, help="rows to show per section")
args = ap.parse_args()

lib = {}
if args.swap_index and os.path.exists(args.swap_index):
    with open(args.swap_index, encoding="utf-8") as fh:
        for e in json.load(fh).get("list", []):
            if e.get("name"):
                lib[e["name"].strip().lower()] = e.get("video") or ""
    print(f"library entries loaded: {len(lib)}")
else:
    print("library not supplied (--swap-index) — library-only coverage will read as UNKNOWN")

db = psycopg2.connect(os.environ["DATABASE_URL"], cursor_factory=RealDictCursor)
cur = db.cursor()

cur.execute("SELECT exercise_name FROM trainer_media "
            "WHERE status <> 'removed' AND cloudflare_uid IS NOT NULL")
uploads = {r["exercise_name"].strip().lower() for r in cur.fetchall()}
print(f"coach uploads:          {len(uploads)}\n")

cur.execute("SELECT access_code, program_name, program_data FROM workout_programs WHERE is_active")

covered_upload, covered_baked, covered_lib, gaps, unknown = {}, {}, {}, {}, {}
for p in cur.fetchall():
    where = f"{p['access_code']} {p['program_name']}"
    for _day, blocks in ((p["program_data"] or {}).get("allWorkouts") or {}).items():
        for b in blocks or []:
            for ex in (b.get("exercises") or []):
                name = (ex.get("name") or "").strip()
                if not name:
                    continue
                key = name.lower()
                if key in uploads:
                    bucket = covered_upload
                elif (ex.get("youtube") or "").strip():
                    bucket = covered_baked
                elif not lib:
                    bucket = unknown
                elif lib.get(key):
                    bucket = covered_lib
                else:
                    bucket = gaps
                bucket.setdefault(name, set()).add(where)


def show(title, note, data, limit):
    print("=" * 78)
    print(f"{title}: {len(data)}")
    if note:
        print(f"  {note}")
    print("=" * 78)
    for n, progs in sorted(data.items(), key=lambda kv: -len(kv[1]))[:limit]:
        print(f"  {n[:58]:58} {len(progs)} program(s)")
    if len(data) > limit:
        print(f"  ... and {len(data)-limit} more")
    print()


show("COVERED — your own upload", "resolved by name at load; works in old programs too",
     covered_upload, args.limit)
show("COVERED — baked into the program", "saved with the program", covered_baked, args.limit)
if lib:
    show("COVERED — bundled library", "filled in at load time; no re-save needed",
         covered_lib, args.limit)
    show("NO VIDEO ANYWHERE", "these show nothing to the client — film or ignore",
         gaps, args.limit)
else:
    show("UNKNOWN (no library supplied)", "", unknown, args.limit)

total = len(covered_upload) + len(covered_baked) + len(covered_lib) + len(gaps) + len(unknown)
have = len(covered_upload) + len(covered_baked) + len(covered_lib)
if lib and total:
    print(f"coverage: {have}/{total} distinct exercises ({100*have//total}%)")
db.close()
