# Per-Coach Video Override System

End-to-end architecture for the video upload + override feature: coaches upload their own exercise demonstrations, and clients under them see the coach's version instead of the platform default.

## Mental Model

There are **three layers of videos** for any exercise (like "Lat Pulldown"):

1. **Bundled default** — shipped in the React source, lives in `workoutbuilder-tkd/src/data/*.js` (four libraries: `exerciseLibrary`, `martialArtsLibrary`, `mobilityExercises`, `warmupExercises`). ~1081 of 1872 exercises have one.
2. **`featured_global`** — a coach video that admin has promoted to be visible platform-wide (including to anonymous / no-coach users).
3. **Coach-specific** — a coach's upload, visible to clients signed up under that coach. Overrides both of the above.

When a client opens a workout in the tracker, these layers merge with highest priority winning:

```
default (bundled JS) < featured_global < coach's upload < user's own upload
```

The "user's own upload" case only matters when the viewer is themselves a coach (testing what their clients see).

## Audience Rules (who sees what)

| Viewer | Sees |
|---|---|
| Signed-up member under coach X | Coach X's upload → featured_global → bundled |
| Coach testing tracker | Their own upload → their upline's → featured_global → bundled |
| Admin testing tracker | Their own upload → featured_global → bundled |
| Anonymous trial code (no account) | featured_global → bundled |

Clients **never** pick between versions — they see one curated video per exercise. The coach and admin are the curators.

## Data Flow (Upload → Playback)

```
┌─────────────────────────────────────────────────────────────────────┐
│  1. Coach logs into app.bestrongagain.com → CoachDashboard          │
│     Clicks "Your Video Library" → routes to /media-library          │
└─────────────────────────────────────────────────────────────────────┘
                                   ↓
┌─────────────────────────────────────────────────────────────────────┐
│  2. MediaLibrary.jsx renders exercise_manifest.json                 │
│     (1872 exercises, grouped by source_library + category)          │
│     Each row = exercise name + drop zone                            │
└─────────────────────────────────────────────────────────────────────┘
                                   ↓
┌─────────────────────────────────────────────────────────────────────┐
│  3. Coach drops video file on "Lat Pulldown" row                    │
│     Browser POSTs to Flask: /api/media/upload-url                   │
└─────────────────────────────────────────────────────────────────────┘
                                   ↓
┌─────────────────────────────────────────────────────────────────────┐
│  4. Flask calls Cloudflare Stream API                                │
│     Returns one-time Direct Creator Upload URL + future UID          │
│     The Cloudflare API token never leaves EC2                        │
└─────────────────────────────────────────────────────────────────────┘
                                   ↓
┌─────────────────────────────────────────────────────────────────────┐
│  5. Browser PUTs video bytes directly to Cloudflare                  │
│     (never touches your EC2 — keeps bandwidth/cost on CF)           │
│     Progress bar updates via XHR onprogress                          │
└─────────────────────────────────────────────────────────────────────┘
                                   ↓
┌─────────────────────────────────────────────────────────────────────┐
│  6. Browser POSTs to Flask: /api/media/register                     │
│     Body: { exercise_name, category, source_library,                 │
│             media_type, cloudflare_uid }                             │
│     Flask INSERTs into trainer_media (or upserts via UNIQUE key)    │
└─────────────────────────────────────────────────────────────────────┘
                                   ↓
┌─────────────────────────────────────────────────────────────────────┐
│  7. Client opens workouttracker app with their access code          │
│     Tracker calls /api/media/tracker-overrides with their email     │
└─────────────────────────────────────────────────────────────────────┘
                                   ↓
┌─────────────────────────────────────────────────────────────────────┐
│  8. Flask resolves the override map:                                 │
│     - featured_global videos (base layer)                            │
│     - user.referred_by_id → coach's videos (override)                │
│     - user's own videos (top priority)                               │
│     Returns { "Lat Pulldown": "https://iframe.videodelivery.net/…" }│
└─────────────────────────────────────────────────────────────────────┘
                                   ↓
┌─────────────────────────────────────────────────────────────────────┐
│  9. Tracker walks program.blocks, replaces ex.youtube where a       │
│     name match exists in the override map.                           │
│     ExerciseCard.jsx renders ▶ button from ex.youtube.              │
└─────────────────────────────────────────────────────────────────────┘
```

## DB Schema (`trainer_media` on RDS)

```sql
CREATE TABLE trainer_media (
  id                SERIAL PRIMARY KEY,
  trainer_id        UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  exercise_name     TEXT NOT NULL,
  category          TEXT,
  source_library    TEXT,                         -- 'exerciseLibrary' | 'martialArtsLibrary' | ...
  media_type        TEXT NOT NULL CHECK (media_type IN ('video','audio')),
  cloudflare_uid    TEXT,                         -- if video (Stream)
  storage_key       TEXT,                         -- if audio (R2/S3, future)
  duration_seconds  INTEGER,
  status            TEXT NOT NULL DEFAULT 'live'
                      CHECK (status IN ('live','flagged','removed')),
  featured_global   BOOLEAN NOT NULL DEFAULT FALSE,
  waiver_signed_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  uploaded_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (trainer_id, exercise_name, media_type)
);
```

- `UNIQUE (trainer_id, exercise_name, media_type)` → re-upload replaces via `ON CONFLICT DO UPDATE` in the register endpoint.
- `status = 'removed'` = soft delete, hidden from clients, still in admin feed (audit trail).
- `status = 'flagged'` = hidden from clients, visible to coach as a warning, visible to admin.
- `featured_global` = admin toggle; promotes to platform-wide visibility.

Migration file: `migrations/001_trainer_media.sql`. Apply with:
```bash
scp migrations/001_trainer_media.sql ec2-user@3.19.135.182:~/
ssh ec2-user@3.19.135.182
PGPASSWORD='…' psql -h bestrongagain.cdqaq4sg2r1g.us-east-2.rds.amazonaws.com \
  -U bsa_admin -d bestrongagain -f 001_trainer_media.sql
```

## Exercise Manifest

The coach upload UI needs to know every possible exercise name, its category, and which bundled library it came from. That list lives in **`src/data/exercise_manifest.json`**, generated by `scripts/build_exercise_manifest.js` which reads the four `.js` libraries from `workoutbuilder-tkd/src/data/`.

**Schema** (each exercise):
```json
{
  "name": "Front Kick",
  "category": "Kicks",
  "subcategory": "Foundation Kicks (Tier 1)",
  "source_library": "martialArtsLibrary",
  "has_default_video": true,
  "default_video_uid": "c181be8ff06a59f7a61b7c7e3059c757"
}
```

Re-run `node scripts/build_exercise_manifest.js` whenever you add exercises to the source libraries.

## Deployment

- **Backend**: `scp backend/media.py ec2-user@3.19.135.182:/opt/bestrongagain/` → `sudo systemctl restart bestrongagain.service`. Blueprint is registered in `app.py` at `/api/media`.
- **Frontend**: `npm run build` → `scp -r dist/* ec2-user@3.19.135.182:/tmp/dist-new/` → move into `/var/www/bestrongagain/`. Served by Nginx.
- **Workouttracker**: auto-deploys on `git push origin main` (Netlify).

## Secrets

- `CLOUDFLARE_API_TOKEN` lives in `/opt/bestrongagain/.env` on EC2 only. Never in the git repo, never in client JS.
- Rotated 2026-04-18 to `cfut_O7Wg2X…` after the previous key was exposed.
- The browser never sees this token — `/api/media/upload-url` mints a **one-time** creator-upload URL that browsers can use to PUT bytes directly to Cloudflare.

## Debugging Tips

**Client doesn't see the override:**
1. Check `curl -X POST https://app.bestrongagain.com/api/media/tracker-overrides -H 'Content-Type: application/json' -d '{"email":"<client-email>"}'`
2. `has_coach: false` means the client's `users.referred_by_id` is null — they're anonymous or signed up without a referral code.
3. Check PWA service worker cache on phone — may need to close all tabs / reinstall app.

**Upload fails at step 4 (`/api/media/upload-url`):**
- Cloudflare API token expired or wrong scope. Rotate and update EC2 `.env`.
- Check `sudo journalctl -u bestrongagain.service -f` for Flask error.

**Upload succeeds but video won't play:**
- Cloudflare Stream has a processing delay (15-60s for new uploads). `admin/cloudflare-list` returns a `status_state` field — wait for `ready`.
- Embed iframe URL: `https://iframe.videodelivery.net/{uid}`. Standalone watch: `https://watch.cloudflarestream.com/{uid}`.

## Related Files

- `backend/media.py` — Flask blueprint (all 8 endpoints)
- `migrations/001_trainer_media.sql` — DB schema
- `scripts/build_exercise_manifest.js` — manifest builder
- `src/pages/MediaLibrary.jsx` — coach upload UI
- `src/pages/AdminDashboard.jsx` — Coach Uploads + Cloudflare Library tabs
- `src/pages/CoachDashboard.jsx` — entry-point button
- `src/utils/api.jsx` — client-side API wrapper
- `workouttracker/src/App.jsx` — override lookup on program load
- `workouttracker/src/hooks/useTrackerAPI.js` — `getTrackerOverrides` helper
