# BSA Coach Platform

## What This Is
The **central backend + coach dashboard** for the Be Strong Again ecosystem. Every other BSA app talks to this platform's Flask API. Coaches sign up clients through its referral system, manage them through the coach dashboard, and earn commissions via Stripe Connect.

**Repo:** `Glen-collab/bsa-coach-platform`
**Stack:** React 19 + Vite 7 (frontend), Flask + psycopg2 (backend), RDS PostgreSQL
**Hosting:** EC2 (3.19.135.182) — Nginx + Gunicorn. Frontend static at `/var/www/bestrongagain/`, backend at `/opt/bestrongagain/`
**Live URL:** https://app.bestrongagain.com
**Database:** RDS PostgreSQL `bestrongagain.cdqaq4sg2r1g.us-east-2.rds.amazonaws.com` / DB `bestrongagain`
**Auth:** JWT in `Authorization: Bearer <token>` header; user roles = `admin | coach | member`

---

## Related Repos (BSA Ecosystem)

- **`Glen-collab/bsa-coach-platform`** — (this repo) Central backend + coach dashboard. All other repos hit its Flask API at `app.bestrongagain.com/api/*`.
- **`Glen-collab/workoutbuilder`** — React app where coaches build multi-week workout programs. Source of the bundled exercise libraries (~1872 exercises across `exerciseLibrary.js`, `martialArtsLibrary.js`, `mobilityExercises.js`, `warmupExercises.js`). Live clone on Glen's Desktop is `workoutbuilder-tkd/`.
- **`Glen-collab/WorkoutTracker`** — PWA clients use to log workouts. Reads programs from `/api/workout/*`, reads per-coach video overrides from `/api/media/tracker-overrides`, includes the `/tv` kiosk routes (whiteboard + QR landing) used by the Pi-based gym displays.
- **`Glen-collab/react-trainer-dashboard`** — React app coaches use to manage clients (send access codes via email, view progress, edit programs via override mode). Extracted from the workoutbuilder repo.

Cross-repo architecture doc: `docs/ARCHITECTURE.md` (in this repo). API surface reference: `docs/MEDIA_API.md`.

---

## Backend (`backend/` in repo; deployed to `/opt/bestrongagain/` on EC2)

```
app.py                    # Flask app factory, blueprint registration, CORS, DB helper
auth.py                   # /api/auth/* — register, login, JWT, coach application, require_auth decorator
stripe_routes.py          # /api/stripe/* — checkout, Stripe Connect onboarding, webhooks
coaches.py                # /api/coaches/* — coach dashboard data, referral tree, earnings
admin.py                  # /api/admin/* — member/coach management, applications
workout_api.py            # /api/workout/* — the legacy-named workout endpoints (load-program.php etc)
                          # — consumed by WorkoutTracker + workoutbuilder + react-trainer-dashboard
media.py                  # /api/media/* — video upload override system (see docs/VIDEO_OVERRIDE_SYSTEM.md)
commission_engine.py      # MLM upline-walking logic for Stripe transfer calculations
email_helper.py           # Gmail SMTP notifications (signups, coach applications, workout logs, send-code)
```

Service: `sudo systemctl {restart,status} bestrongagain.service`
Env: `/opt/bestrongagain/.env` (gitignored). Contains DATABASE_URL, SECRET_KEY, STRIPE_*, CLOUDFLARE_API_TOKEN, GMAIL_APP_PASSWORD.

## Frontend (`src/` — React)

```
src/
  App.jsx                 # React Router setup, auth-gated routes, role-based dashboard routing
  hooks/
    useAuth.js            # AuthProvider, localStorage token persistence
    useMediaQuery.js      # Responsive styles helper (see docs/MOBILE_CSS.md)
  utils/
    api.jsx               # Centralized fetch wrapper with Bearer token injection
  pages/
    Landing.jsx           # Marketing landing (public)
    Login.jsx / Register.jsx
    ApplyCoach.jsx        # Coach application form
    MemberDashboard.jsx   # Client-facing — "Start Your Workout" primary CTA
    CoachDashboard.jsx    # Coach view — clients, tree, earnings, tools buttons
    AdminDashboard.jsx    # Admin (Glen) — overview stats, members, coaches, applications, coach uploads, cloudflare library, exercise requests
    MediaLibrary.jsx      # Drag-drop video upload for coaches (1872 exercises)
  components/
    Navbar.jsx
    VideoWaiverModal.jsx  # One-time video use agreement
    ProposeExerciseModal.jsx  # Coach proposes new exercise
  data/
    exercise_manifest.json    # 1872 exercises flattened (regenerate with scripts/build_exercise_manifest.js)
```

Build: `npm run build` → `dist/` → scp to `/var/www/bestrongagain/` on EC2.

---

## Key System Docs (in `docs/`)

- **`ARCHITECTURE.md`** — how the four BSA repos fit together, data flow, who reads/writes where
- **`VIDEO_OVERRIDE_SYSTEM.md`** — per-coach video upload + override, full architecture + debugging
- **`MEDIA_API.md`** — reference for all `/api/media/*` endpoints
- **`WAIVER_AND_PROPOSALS.md`** — video use agreement flow + coach-proposed exercise flow
- **`MOBILE_CSS.md`** — `useMediaQuery` hook + `buildStyles(isMobile)` pattern for future screens
- **`boxing_kickboxing_forms.pdf`** — belt-mapped form curriculum (I-pattern system for boxing + kickboxing/muay thai)

## Migrations

SQL migrations in `migrations/` — apply via:
```bash
scp migrations/001_trainer_media.sql ec2-user@3.19.135.182:~/
ssh ec2-user@3.19.135.182
PGPASSWORD='...' psql -h <rds-host> -U bsa_admin -d bestrongagain -f 001_trainer_media.sql
```

Current migrations:
- `001_trainer_media.sql` — per-coach video uploads
- `002_video_waiver.sql` — one-time video use agreement columns on users
- `003_custom_exercises.sql` — coach-proposed custom exercises

## Commission Structure

- Direct signup: **80% coach / 10% platform / 10% upline**
- 3-tier affiliate tree via `users.referred_by_id`
- Stripe Connect Express accounts for coach payouts
- Webhook handler in `stripe_routes.py` triggers `commission_engine.py` walks

## Admin Credentials (Glen)

- URL: https://app.bestrongagain.com
- Email: `wisco.barbell@gmail.com`
- Referral code: `GLENM7NUS`
- Coach access code (for others applying to be coaches): `BSACOACH2026`

## Deploy Checklist

Backend change:
```
scp backend/<file>.py ec2-user@3.19.135.182:/tmp/
ssh ec2-user@3.19.135.182 "sudo mv /tmp/<file>.py /opt/bestrongagain/<file>.py && sudo systemctl restart bestrongagain.service"
```

Frontend change:
```
npm run build
scp -r dist/* ec2-user@3.19.135.182:/tmp/dist-new/
ssh ec2-user@3.19.135.182 "sudo rm -rf /var/www/bestrongagain/assets && sudo cp -r /tmp/dist-new/* /var/www/bestrongagain/"
```
