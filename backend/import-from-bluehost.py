"""
Import Bluehost MySQL data into AWS RDS PostgreSQL.
Run on EC2: python3.11 import-from-bluehost.py

1. Fetches JSON export from Bluehost PHP endpoint
2. Inserts into PostgreSQL tables on RDS
3. Reports counts and any errors
"""

import json
import os
import sys
import requests
import psycopg2
from datetime import datetime

# One-shot migration script — historical reference only (all data already migrated
# April 2026). Key is env-var so it's not in source control.
MIGRATE_KEY = os.environ.get("BLUEHOST_MIGRATE_KEY", "")
EXPORT_URL = f"https://bestrongagain.com/workout-programs/api/general/export-all-data.php?key={MIGRATE_KEY}"
DATABASE_URL = os.environ["DATABASE_URL"]  # set in /opt/bestrongagain/.env on EC2 — no fallback in source

def main():
    print("=== BSA Data Migration: Bluehost → AWS RDS ===\n")

    # Fetch data from Bluehost
    print("Fetching data from Bluehost...")
    resp = requests.get(EXPORT_URL, timeout=60)
    if resp.status_code != 200:
        print(f"ERROR: Got status {resp.status_code} from export endpoint")
        sys.exit(1)

    data = resp.json()
    print(f"  Programs:       {len(data.get('programs', []))}")
    print(f"  User Positions: {len(data.get('user_positions', []))}")
    print(f"  Workout Logs:   {len(data.get('workout_logs', []))}")
    print(f"  Travel Workouts:{len(data.get('travel_workouts', []))}")
    print(f"  Overrides:      {len(data.get('overrides', []))}")
    print()

    # Connect to RDS
    print("Connecting to RDS PostgreSQL...")
    conn = psycopg2.connect(DATABASE_URL)
    cur = conn.cursor()

    errors = []

    # 1. Import programs
    print("Importing programs...")
    count = 0
    for p in data.get('programs', []):
        try:
            cur.execute("""
                INSERT INTO workout_programs (id, access_code, user_email, user_name, program_name, program_data, created_by, is_active, created_at, updated_at)
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                ON CONFLICT (access_code) DO UPDATE SET
                    program_data = EXCLUDED.program_data,
                    updated_at = EXCLUDED.updated_at
            """, (
                p.get('id'), p.get('access_code'), p.get('user_email'), p.get('user_name'),
                p.get('program_name'), p.get('program_data'), p.get('created_by'),
                bool(p.get('is_active', 1)), p.get('created_at'), p.get('updated_at')
            ))
            count += 1
        except Exception as e:
            errors.append(f"Program {p.get('access_code')}: {e}")
            conn.rollback()
    conn.commit()
    print(f"  Imported {count} programs")

    # 2. Import user positions
    print("Importing user positions...")
    count = 0
    for up in data.get('user_positions', []):
        try:
            cur.execute("""
                INSERT INTO workout_user_position (
                    id, access_code, user_email, user_name, current_week, current_day,
                    last_workout_date, one_rm_bench, one_rm_squat, one_rm_deadlift, one_rm_clean,
                    height_inches, weight_lbs, age, gender, cumulative_weeks, program_name,
                    created_at, updated_at
                ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                ON CONFLICT (access_code, user_email) DO UPDATE SET
                    current_week = EXCLUDED.current_week,
                    current_day = EXCLUDED.current_day,
                    updated_at = EXCLUDED.updated_at
            """, (
                up.get('id'), up.get('access_code'), up.get('user_email'), up.get('user_name'),
                up.get('current_week', 1), up.get('current_day', 1),
                up.get('last_workout_date'), up.get('one_rm_bench'), up.get('one_rm_squat'),
                up.get('one_rm_deadlift'), up.get('one_rm_clean'),
                up.get('height_inches'), up.get('weight_lbs'), up.get('age'), up.get('gender'),
                up.get('cumulative_weeks', 0), up.get('program_name'),
                up.get('created_at'), up.get('updated_at')
            ))
            count += 1
        except Exception as e:
            errors.append(f"User position {up.get('user_email')}: {e}")
            conn.rollback()
    conn.commit()
    print(f"  Imported {count} user positions")

    # 3. Import workout logs
    print("Importing workout logs...")
    count = 0
    for wl in data.get('workout_logs', []):
        try:
            # workout_data might be a string or already parsed
            wd = wl.get('workout_data')
            if isinstance(wd, str):
                try:
                    wd = json.loads(wd)
                except:
                    pass
            wd_json = json.dumps(wd) if wd else None

            vs = wl.get('volume_stats')
            if isinstance(vs, str):
                try:
                    vs = json.loads(vs)
                except:
                    pass
            vs_json = json.dumps(vs) if vs else None

            cd = wl.get('chatbot_data')
            if isinstance(cd, str):
                try:
                    cd = json.loads(cd)
                except:
                    pass
            cd_json = json.dumps(cd) if cd else None

            cur.execute("""
                INSERT INTO workout_logs (
                    access_code, user_email, user_name, program_name,
                    week_number, day_number, workout_date, workout_data,
                    volume_stats, chatbot_data,
                    one_rm_bench, one_rm_squat, one_rm_deadlift, one_rm_clean, created_at
                ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
            """, (
                wl.get('access_code'), wl.get('user_email'), wl.get('user_name'), wl.get('program_name'),
                wl.get('week_number'), wl.get('day_number'), wl.get('workout_date'),
                wd_json, vs_json, cd_json,
                wl.get('one_rm_bench'), wl.get('one_rm_squat'), wl.get('one_rm_deadlift'), wl.get('one_rm_clean'),
                wl.get('created_at')
            ))
            count += 1
        except Exception as e:
            errors.append(f"Workout log {wl.get('user_email')} W{wl.get('week_number')}D{wl.get('day_number')}: {e}")
            conn.rollback()
    conn.commit()
    print(f"  Imported {count} workout logs")

    # 4. Import travel workouts
    print("Importing travel workouts...")
    count = 0
    for tw in data.get('travel_workouts', []):
        try:
            wd = tw.get('workout_data')
            if isinstance(wd, str):
                try:
                    wd = json.loads(wd)
                except:
                    pass
            wd_json = json.dumps(wd) if wd else None

            cur.execute("""
                INSERT INTO workout_travel (trainer_email, equipment_type, day_number, workout_name, workout_data, created_at)
                VALUES (%s, %s, %s, %s, %s, %s)
                ON CONFLICT (trainer_email, equipment_type, day_number) DO UPDATE SET
                    workout_data = EXCLUDED.workout_data
            """, (
                tw.get('trainer_email'), tw.get('equipment_type'), tw.get('day_number'),
                tw.get('workout_name'), wd_json, tw.get('created_at')
            ))
            count += 1
        except Exception as e:
            errors.append(f"Travel workout: {e}")
            conn.rollback()
    conn.commit()
    print(f"  Imported {count} travel workouts")

    # 5. Import overrides
    print("Importing overrides...")
    count = 0
    for ov in data.get('overrides', []):
        try:
            wd = ov.get('workout_data')
            if isinstance(wd, str):
                try:
                    wd = json.loads(wd)
                except:
                    pass
            wd_json = json.dumps(wd) if wd else None

            cur.execute("""
                INSERT INTO workout_overrides (access_code, user_email, week_number, day_number, workout_data, override_reason, created_at)
                VALUES (%s, %s, %s, %s, %s, %s, %s)
                ON CONFLICT (access_code, user_email, week_number, day_number) DO UPDATE SET
                    workout_data = EXCLUDED.workout_data
            """, (
                ov.get('access_code'), ov.get('user_email'), ov.get('week_number'), ov.get('day_number'),
                wd_json, ov.get('override_reason'), ov.get('created_at')
            ))
            count += 1
        except Exception as e:
            errors.append(f"Override: {e}")
            conn.rollback()
    conn.commit()
    print(f"  Imported {count} overrides")

    cur.close()
    conn.close()

    print(f"\n=== Migration Complete ===")
    if errors:
        print(f"\n{len(errors)} errors:")
        for e in errors[:20]:
            print(f"  - {e}")
    else:
        print("No errors!")


if __name__ == "__main__":
    main()
