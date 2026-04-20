# BSA Ecosystem — Cross-Repo Architecture

Single source of truth for how the four BSA repos connect. Read this first when working across them.

## The Four Repos

```
┌──────────────────────────────────────────────────────────────────────┐
│  Glen-collab/bsa-coach-platform                       (this repo)   │
│  ──────────────────────────────                                     │
│  • Flask API (the central backend) → app.bestrongagain.com/api/*   │
│  • React coach/admin/member dashboards                              │
│  • RDS PostgreSQL (users, programs, trainer_media, custom_exercises,│
│    subscriptions, commissions, workout_logs, user_position)         │
│  • Stripe Connect for coach payouts                                 │
│  • EC2 deploy (Nginx + Gunicorn)                                    │
└──────────────────────────────────────────────────────────────────────┘
           ▲                  ▲                   ▲
           │  /api/*          │  /api/workout/*   │  /api/media/*
           │  /api/workout/*  │                   │  /api/workout/*
           │                  │                   │
┌──────────┴──────────┐   ┌───┴───────────┐   ┌──┴──────────────┐
│ Glen-collab/        │   │ Glen-collab/  │   │ Glen-collab/    │
│ workoutbuilder      │   │ react-trainer-│   │ WorkoutTracker  │
│                     │   │ dashboard     │   │                 │
│ (coaches: build     │   │ (coaches:     │   │ (clients: log   │
│  multi-week programs│   │  manage       │   │  workouts; also │
│  — source of truth  │   │  clients,     │   │  /tv kiosk for  │
│  for the 1872       │   │  send codes,  │   │  gym TVs; also  │
│  exercise libs)     │   │  edit programs│   │  /kiosk for     │
│                     │   │  in override  │   │  tablet picker) │
│ React + Netlify     │   │  mode)        │   │                 │
│                     │   │               │   │ React + Netlify │
│                     │   │ React+Netlify │   │ (PWA)           │
└─────────────────────┘   └───────────────┘   └─────────────────┘
```

## Data Flow — Client Lifecycle

1. **Coach invites prospect** via referral link `app.bestrongagain.com/register/{COACHCODE}` → form submission creates a `users` row with `referred_by_id = coach_user_id`.
2. **Coach builds program** in `workoutbuilder` (uses `src/data/*.js` for exercise picker). On save, POSTs to `bsa-coach-platform/api/workout/save-program.php` → row in `workout_programs` table with 4-digit `access_code`.
3. **Coach sends access code to client** via `react-trainer-dashboard` → clicks the envelope button → triggers `bsa-coach-platform/api/coaches/send-code` → server sends email via Gmail SMTP.
4. **Client logs into `WorkoutTracker`** (PWA at `bestrongagain.netlify.app`) → enters email + code → POSTs to `bsa-coach-platform/api/workout/load-program.php` → receives `{program, userPosition}`. Tracker also POSTs to `/api/media/tracker-overrides` with the client's email → receives coach-specific video URL overrides that override `ex.youtube` in the program's exercises.
5. **Client logs workout** → POST to `bsa-coach-platform/api/workout/log-workout.php` with all sets/reps/notes → server inserts `workout_logs` row + triggers formatted email to coach via `email_helper.py`.

## Which Repo Owns What

| Concern | Repo | File / Location |
|---|---|---|
| User auth, JWT, roles | bsa-coach-platform | `backend/auth.py` |
| Stripe subscriptions + Connect | bsa-coach-platform | `backend/stripe_routes.py` |
| Commission calc / MLM upline walk | bsa-coach-platform | `backend/commission_engine.py` |
| Admin management UI | bsa-coach-platform | `src/pages/AdminDashboard.jsx` |
| Coach-proposed custom exercises | bsa-coach-platform | `backend/media.py` + `src/pages/AdminDashboard.jsx` (Exercise Requests tab) |
| Video upload + override system | bsa-coach-platform | `backend/media.py` + `src/pages/MediaLibrary.jsx` |
| Bundled exercise libraries (1872) | workoutbuilder | `src/data/exerciseLibrary.js`, `martialArtsLibrary.js`, `mobilityExercises.js`, `warmupExercises.js` |
| Program builder UI | workoutbuilder | `src/components/builder/` |
| Travel workout system | workoutbuilder | `src/components/programs/ManageTravelWorkouts.jsx` |
| Access-code client UX | WorkoutTracker | `src/components/access/` |
| Workout logging UI | WorkoutTracker | `src/components/program/` |
| Exercise video rendering (`ex.youtube`) | WorkoutTracker | `src/components/program/ExerciseCard.jsx` |
| Belt progression game | WorkoutTracker | `src/components/game/TestYourMight.jsx` |
| Pain management chatbot | WorkoutTracker | `src/components/chatbot/WorkoutChatbot.jsx` |
| Gym TV kiosk (`/tv`, `/tv/static`) | WorkoutTracker | `src/components/tv/TVScreen.jsx`, `TVStatic.jsx` |
| Tablet kiosk (`/kiosk`) | WorkoutTracker | `src/components/kiosk/KioskScreen.jsx` |
| Coach client list + send code | react-trainer-dashboard | `src/pages/*` |
| Override mode (coach edits client's program) | react-trainer-dashboard + workoutbuilder | Uses `?mode=override` URL param in builder |

## Exercise Manifest

The 1872-exercise list in `bsa-coach-platform/src/data/exercise_manifest.json` is **generated from** the four JS files in `workoutbuilder/src/data/`. To regenerate:

```
cd bsa-coach-platform
node scripts/build_exercise_manifest.js
```

The script reads the workoutbuilder JS libraries (must be at `../workoutbuilder-tkd/src/data/` — Glen's desktop clone layout). Any time the workoutbuilder libraries gain/lose exercises, re-run this in `bsa-coach-platform` and commit.

## Video Override Lookup (`/api/media/tracker-overrides`)

When `WorkoutTracker` loads a program, it calls this endpoint with the client's email. The server returns a map `{ exercise_name: iframe_url }` based on:

1. **User's own uploads** (if they're a coach) — highest priority
2. **Their coach's uploads** (via `users.referred_by_id`)
3. **`featured_global` uploads** (admin promoted)
4. **Bundled defaults** in the JS libraries — lowest fallback

`WorkoutTracker`'s `App.jsx` walks `prog.blocks` after `loadProgram` and replaces `ex.youtube` where a name matches the override map. Full flow + edge cases: see `bsa-coach-platform/docs/VIDEO_OVERRIDE_SYSTEM.md`.

## API Endpoint Ownership

All endpoints live in `bsa-coach-platform/backend/`. Consumers reference them by URL.

| Blueprint prefix | Source file | Consumers |
|---|---|---|
| `/api/auth/*` | `auth.py` | bsa-coach-platform frontend |
| `/api/stripe/*` | `stripe_routes.py` | bsa-coach-platform frontend, Stripe webhooks |
| `/api/coaches/*` | `coaches.py` | bsa-coach-platform, react-trainer-dashboard |
| `/api/admin/*` | `admin.py` | bsa-coach-platform (admin only) |
| `/api/workout/*` | `workout_api.py` | **all three React apps** — primary shared surface |
| `/api/media/*` | `media.py` | bsa-coach-platform (uploads), WorkoutTracker (overrides) |

## Infrastructure Summary

- **EC2** `3.19.135.182` — Flask backend + Nginx + static React hosting for `app.bestrongagain.com`
- **RDS PostgreSQL** `bestrongagain.cdqaq4sg2r1g.us-east-2.rds.amazonaws.com` — single DB for all the above
- **Cloudflare Stream** account `3a007b6233a4089a87f73fda6292684b` — video hosting (embed pattern `https://iframe.videodelivery.net/{uid}`)
- **Netlify** — hosts `workoutbuilder`, `WorkoutTracker`, `react-trainer-dashboard` (each auto-deploys on push to `main`)
- **Bluehost** — holds `bestrongagain.com` marketing site + DNS for `app.bestrongagain.com` → EC2

## Key Reference Files

- `bsa-coach-platform/docs/VIDEO_OVERRIDE_SYSTEM.md` — per-coach video system
- `bsa-coach-platform/docs/MEDIA_API.md` — all `/api/media/*` endpoints
- `bsa-coach-platform/docs/WAIVER_AND_PROPOSALS.md` — video use agreement + custom exercise proposals
- `bsa-coach-platform/docs/MOBILE_CSS.md` — `useMediaQuery` pattern used across the frontend
- `bsa-coach-platform/docs/boxing_kickboxing_forms.pdf` — belt-mapped form curriculum
