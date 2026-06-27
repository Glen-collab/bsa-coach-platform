#!/usr/bin/env python3
"""
Versioned safety-net backup of workout programs (overwrite protection).

Runs on a schedule (cron). For every active program it writes a JSON snapshot
ONLY when the program's content changed since the last snapshot (dedup by hash),
so each overwrite leaves the prior version sitting in the backup folder,
timestamped and restorable.

Retention: snapshots older than RETENTION_DAYS are pruned, but the most recent
snapshot per program is ALWAYS kept (so an untouched program never loses its
last backup).

Deploy: lives in ec2-user home on the BSA EC2; reads DATABASE_URL from
/opt/bestrongagain/.env via the run_backup.sh wrapper; uses the app venv python
(system python3 has no psycopg2). Backups go to ~/program-backups/<id>/.
Restore: pick the file just before the bad save and feed its program_data back
(create a record via save-program.php, or UPDATE the row) — see the
program-overwrite-recovery memory.
"""
import os
import json
import time
import glob
import hashlib
import datetime
import psycopg2
import psycopg2.extras

RETENTION_DAYS = 90
BACKUP_DIR = os.path.expanduser("~/program-backups")


def canonical(program_data):
    """Stable JSON string for hashing + storage, whether the column came back as
    a dict (jsonb) or a str (text)."""
    if isinstance(program_data, str):
        try:
            program_data = json.loads(program_data)
        except Exception:
            return program_data, program_data  # un-parseable; hash/store raw
    s = json.dumps(program_data, sort_keys=True, separators=(",", ":"))
    return program_data, s


def main():
    os.makedirs(BACKUP_DIR, exist_ok=True)
    conn = psycopg2.connect(os.environ["DATABASE_URL"])
    cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
    cur.execute(
        "SELECT id, access_code, program_name, program_nickname, program_data, updated_at "
        "FROM workout_programs WHERE is_active = TRUE"
    )
    rows = cur.fetchall()
    conn.close()

    stamp = datetime.datetime.utcnow().strftime("%Y%m%d-%H%M%S")
    written = 0
    for r in rows:
        obj, s = canonical(r["program_data"])
        h = hashlib.sha256(s.encode("utf-8")).hexdigest()[:12]
        pdir = os.path.join(BACKUP_DIR, str(r["id"]))
        os.makedirs(pdir, exist_ok=True)
        # Dedup: a snapshot with this exact content hash already exists -> skip.
        if glob.glob(os.path.join(pdir, f"*_{h}.json")):
            continue
        nick = "".join(c for c in (r["program_nickname"] or "") if c.isalnum() or c in "-_") or "nophase"
        meta = {
            "id": r["id"],
            "access_code": r["access_code"],
            "program_name": r["program_name"],
            "program_nickname": r["program_nickname"],
            "updated_at": str(r["updated_at"]),
            "backed_up_at": stamp,
            "hash": h,
            "program_data": obj,
        }
        with open(os.path.join(pdir, f"{stamp}_{nick}_{h}.json"), "w") as f:
            json.dump(meta, f)
        written += 1

    # Prune: drop snapshots older than the retention window, but always keep the
    # newest one per program.
    cutoff = time.time() - RETENTION_DAYS * 86400
    pruned = 0
    for pdir in glob.glob(os.path.join(BACKUP_DIR, "*")):
        if not os.path.isdir(pdir):
            continue
        files = sorted(glob.glob(os.path.join(pdir, "*.json")), key=os.path.getmtime, reverse=True)
        for f in files[1:]:  # keep the most recent [0]
            if os.path.getmtime(f) < cutoff:
                os.remove(f)
                pruned += 1

    print(f"{stamp} backup: {len(rows)} programs scanned, {written} new snapshots, {pruned} pruned, retention={RETENTION_DAYS}d")


if __name__ == "__main__":
    main()
