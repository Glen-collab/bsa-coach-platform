# BSA Master Reference

**Last verified: 2026-07-30.** Start here when working anywhere in the Be Strong Again ecosystem. Everything below was checked against the live code and running servers on that date — not copied from older docs.

Per-repo detail lives in each repo's own `CLAUDE.md`. Cross-repo wiring detail lives in `docs/ARCHITECTURE.md`. This file is the orientation layer over both: what exists, what's live, how to deploy it, and what will bite you.

---

## 1. The one-paragraph version

Everything hangs off **one backend**: `bsa-coach-platform`, a Flask app on EC2 talking to RDS Postgres, serving `app.bestrongagain.com/api/*`. Three React apps on Netlify are pure front-ends against it — `workoutbuilder` (coach builds programs), `react-trainer-dashboard` (coach manages clients), `workouttracker` (client logs workouts, plus all the gym-TV/kiosk screens). A fourth app, `leaderboard`, runs on the same EC2 box but is its own service and DB-adjacent world. There is no second backend. If data moved, it moved through Flask.

---

## 2. Repo map

| Repo (`Glen-collab/…`) | Desktop folder | Live URL | Deploys by | HEAD as of 2026-07-30 |
|---|---|---|---|---|
| `bsa-coach-platform` | `bsa-coach-platform/` | app.bestrongagain.com | build + scp to EC2, **then** push | 2026-07-22 |
| `WorkoutTracker` | `workouttracker/` | bestrongagain.netlify.app | push to `main` = deploy | 2026-07-29 |
| `workoutbuilder` | `workoutbuilder/` | workoutbuild.netlify.app | push to `main` = deploy | 2026-07-06 |
| `react-trainer-dashboard` | `react-trainer-dashboard/` | bsa-trainer-dashboard.netlify.app | push to `main` = deploy | 2026-06-09 |
| `leaderboard` | `leaderboard/` | leaderboard.bestrongagain.com | build + scp to EC2 | 2026-07-01 |

Branch is `main` everywhere **except `bsa-coach-platform`, which is `master`.**

### Folders that are NOT the working repo

- **`workoutbuilder-tkd/`** — a stale second clone of `Glen-collab/workoutbuilder`, months behind `main`. Same remote. Do not edit it, do not build the exercise manifest from it. The real one is `workoutbuilder/`.
- **`WorkoutTracker-tv/`** — a second clone of `Glen-collab/WorkoutTracker`, also behind. The TV code lives in the main `workouttracker/` checkout under `src/components/tv/`.

Both exist for historical reasons. Treat them as read-only archaeology.

---

## 3. Backend surface

Flask blueprints in `bsa-coach-platform/backend/`, all served under `app.bestrongagain.com`:

| Prefix | File | Who calls it |
|---|---|---|
| `/api/auth/*` | `auth.py` | platform frontend |
| `/api/workout/*` | `workout_api.py` | **all three React apps** — the main shared surface |
| `/api/media/*` | `media.py` | platform (uploads), tracker (video overrides) |
| `/api/coaches/*` | `coaches.py` | platform, trainer dashboard |
| `/api/admin/*` | `admin.py` | platform (admin only) |
| `/api/stripe/*` | `stripe_routes.py` | platform frontend, Stripe webhooks |
| `/api/health` | `app.py` | **GET only.** Returns `{"db":"connected","status":"ok"}` — hits the DB, so it's the correct cold-start warmup target. |

`/api/workout/*` endpoints keep `.php` suffixes (`load-program.php`, `log-workout.php`, …). That is legacy naming from the WordPress era. They are Flask routes. Nothing PHP is involved.

**All three React apps hardcode `https://app.bestrongagain.com` in their API hooks** — `useTrackerAPI.js`, `useProgramAPI.js`, `useDashboardAPI.js`. They do not rely on the Netlify `/api/*` proxy. If you add a relative `/api/` call, check that repo's `netlify.toml` first.

---

## 4. Client lifecycle

1. Coach invites via `app.bestrongagain.com/register/{COACHCODE}` → `users` row with `referred_by_id` set.
2. Coach builds a program in **workoutbuilder** → `save-program.php` → `workout_programs` row with a **4-digit access code**.
3. Coach sends the code from **react-trainer-dashboard** (envelope button) → `/api/coaches/send-code` → Gmail SMTP.
4. Client enters email + code in **workouttracker** → `load-program.php` returns `{program, userPosition}`. Tracker then calls `/api/media/tracker-overrides` and swaps `ex.youtube` for any coach-specific video.
5. Client logs → `log-workout.php` → `workout_logs` row + formatted email to the coach.

**Video override priority:** own uploads → their coach's uploads → `featured_global` → bundled library default.

---

## 5. Exercise library — the ownership rule

`workoutbuilder/src/data/` is the **single source of truth** for exercises. Files: `exerciseLibrary.js`, `martialArtsLibrary.js`, `mobilityExercises.js`, `warmupExercises.js` (plus `olympicLifting.js`, `generalMovements.js`, `cnsLifts.js`, `poomsaeData.js`, `firstResponder.js`, `preMadeWorkouts.js`).

`bsa-coach-platform/src/data/exercise_manifest.json` is **generated**, currently **2060 exercises**. Regenerate:

```bash
cd bsa-coach-platform
node scripts/build_exercise_manifest.js
```

The script reads `../workoutbuilder/src/data/`. Re-run and commit it any time the builder libraries gain or lose an exercise. Never point it at `workoutbuilder-tkd/`.

---

## 6. Payments, tiers, commissions

Tiers, from `backend/stripe_routes.py`:

| Tier | Price | `TIER_AMOUNTS` cents | What it is |
|---|---|---|---|
| `tracker` | $5.99/mo | 599 | tracker only, no coaching |
| `basic` | $20/mo | 2000 | |
| `coached` | $200/mo | 20000 | |
| `elite` | $400/mo | 40000 | |

Price IDs come from env vars (`STRIPE_PRICE_TRACKER`, `_BASIC`, `_COACHED`, `_ELITE`) in `/opt/bestrongagain/.env`.

**Money flow — this is the important part.** Checkout Sessions are created on the **platform account**: no `stripe_account` header, no `transfer_data`. Glen is merchant of record and collects 100% of every charge. Coach and upline are paid **afterward** via separate `stripe.Transfer.create` calls in `commission_engine.pay_commission()`. Coaches are on **Connect Express** accounts (`users.stripe_account_id`, `stripe_onboarded`).

**The split always sums to exactly 100%** (`commission_engine.py`):

- Coach keeps **80%**
- Platform fee **10%** — always
- Referral bonus **10%** — to whoever recruited the coach, **one level only** (`MAX_COMMISSION_DEPTH = 1`)
- No recruiter → platform keeps 20%

> Older docs describe this as a "3-tier affiliate tree." It is not, and hasn't been. Depth is capped at 1 in code. Trust `commission_engine.py` over any prose.

---

## 7. Deploy playbooks

**Git must always match live.** Never leave a deployed change unpushed or a pushed change undeployed.

### Netlify apps (tracker, builder, trainer dashboard)

Push to `main` **is** the deploy. Nothing else to do. `dist/` is gitignored — Netlify builds it.

```bash
npm run build          # sanity-check locally first
git push origin main   # this deploys
```

### bsa-coach-platform — frontend

```bash
npm run build
scp -r dist/* ec2-user@3.19.135.182:/tmp/dist-new/
ssh ec2-user@3.19.135.182 "sudo rm -rf /var/www/bestrongagain/assets && sudo cp -r /tmp/dist-new/* /var/www/bestrongagain/"
git push origin master
```

### bsa-coach-platform — backend

```bash
scp backend/<file>.py ec2-user@3.19.135.182:/tmp/
ssh ec2-user@3.19.135.182 "sudo mv /tmp/<file>.py /opt/bestrongagain/<file>.py && sudo systemctl restart bestrongagain.service"
git push origin master
```

`scp -r` to the coach-platform has **hung before** — prefer explicit files and verify the hash on the far side after copying.

### Migrations

```bash
scp migrations/00X_*.sql ec2-user@3.19.135.182:~/
ssh ec2-user@3.19.135.182
PGPASSWORD='…' psql -h <rds-host> -U bsa_admin -d bestrongagain -f 00X_*.sql
```

---

## 8. Infrastructure

- **EC2 `3.19.135.182`** — Nginx + Gunicorn. Backend `/opt/bestrongagain/`, frontend static `/var/www/bestrongagain/`. Service `bestrongagain.service`. Env `/opt/bestrongagain/.env` (gitignored: `DATABASE_URL`, `SECRET_KEY`, `STRIPE_*`, `CLOUDFLARE_API_TOKEN`, `GMAIL_APP_PASSWORD`).
- **This same box also runs Polly (polly-connect.com) and the leaderboard** as independent apps. They share hardware and nothing else — separate dirs, services, repos, nginx blocks. Never let work on one touch another; verify all services still `active` after any nginx or systemd change.
- **RDS Postgres** `bestrongagain.cdqaq4sg2r1g.us-east-2.rds.amazonaws.com`, DB `bestrongagain`.
- **Cloudflare Stream** account `3a007b6233a4089a87f73fda6292684b`, embeds `https://iframe.videodelivery.net/{uid}`. The API token rotates — a 401 means it rolled; update `.env` and restart.
- **Netlify** — the three React apps.
- **Bluehost** — `bestrongagain.com` marketing site + DNS for `app.bestrongagain.com` → EC2.
- **SSH** — key at `Desktop/polly-connect-key.pem`, user `ec2-user`.

---

## 9. What each front-end actually contains

### workouttracker — far more than a logger

Beyond `access/ → consent/ → program/`, this repo owns every screen that isn't the coach's:

- **Routes:** `/tv` (two-QR landing), `/tv/static` (whiteboard + QR), `/kiosk` (tablet picker), `/cast`, `/magic` (magic-link consume), `?kiosk=1`, `?mode=1on1&coach=<code>` (trainer's digital clipboard).
- **program/:** `BodyweightChart`, `ChallengeCard`, `ScratchPadCard`, `CastButton`/`CastStatusPill`, `DashboardButton`, `PrintWorkout`, plus the core tracking cards.
- **utils/:** `cnsLoadCalc.js`, `sprintTargets.js`, `visibleDays.js`, `challengeFormat.js`, `scratchpad.js`.
- **Also:** `social/FriendChat.jsx`, `game/TestYourMight.jsx` (belt progression), `chatbot/WorkoutChatbot.jsx` (53-node pain tree + travel workouts), `modals/SessionRecapModal`, `TransitionSurveyModal`.

### workoutbuilder

`builder/`, `exercises/`, `programs/`, `screens/`, `shared/`, `auth/`. Override mode is `?accessCode=X&email=Y&mode=override`. Also owns the CNS/INOL load engine and travel-workout authoring.

### react-trainer-dashboard

`clients/` (`ClientTable`, `ClientDetails`, `AISummary`, `BulkWeeklySummary`, `ProgressHighlights`, `RecentWorkouts`), `dashboard/` (`StatsCards`, `SearchBar`, `TriageFilters`), `charts/`, `modals/`, `auth/LoginGate`. **There is no `src/pages/` in this repo** despite what older docs said.

---

## 10. Gotchas that have cost real time

- **Cold-start warmup must use the absolute URL.** A relative `/api/…` ping goes through the Netlify proxy, and that proxy pointed at the retired WordPress host for months — it 403'd and warmed nothing, silently, because the ping was wrapped in `.catch(() => {})`. Fixed 2026-07-30 in both tracker and builder; both now GET `https://app.bestrongagain.com/api/health`.
- **iOS Safari ignores `overflow-x: hidden` on `body` alone** — set it on `html` too, and cap `audio`/`img` at `max-width: 100%`.
- **PWA updates:** Vite injects a `BUILD_VERSION` timestamp; the nuclear SW + cache reset is gated on it. Do not trust Workbox's soft update on iOS. `sw.js`, `registerSW.js`, and `index.html` are served `no-cache` via `netlify.toml` — Safari was pinning tabs to stale builds otherwise.
- **Fire TV / TCL Silk ignores `window.scrollTo`** — use a container div with `overflow: auto` and `ref.scrollBy`.
- **Gym TV showing stale code needs a Pi *reboot*, not a refresh.**
- **Builder `setsCount` quirk:** the builder saves `setsCount` as a string with `sets: []` empty. Any tracker surface must read `setsCount` first.
- **Hidden days keep their raw day numbers with gaps** (hide Day 4 → "…3, 5, 6, 7"). That is intended; navigation skips them.
- **Builder Save overwrites the program row in place** — there is no version history. Recovery means re-fetching from a prior `list-programs.php` response.
- **Martial-arts exercises default `baseMax` to bodyweight**, never bench/squat.
- **Program grouping is by Title** (unique per client); phase/nickname nests underneath. Month is not a Title.

---

## 11. Known open items

- **`react-trainer-dashboard` is the laggard** — untouched since 2026-06-09 while the tracker gained persistent exercise swaps, client-scoped bodyweight history, PT/clinician summaries and live ACWR. None of that is surfaced to the coach yet. Most likely next place work is needed.
- **Martial arts / TKD** — `martialArtsLibrary.js` and `poomsaeData.js` in the builder are parked by choice; Glen will return to them. Not stale by accident.
- **`workoutbuilder-tkd/` and `WorkoutTracker-tv/`** stale clones still sit on the Desktop. Deleting them would remove a recurring footgun, but nothing depends on that happening.
- **Per-repo `CLAUDE.md` files have drifted** from the code — the tracker's file predates the `tv/`, `kiosk/`, `social/`, and `common/` directories and all of 1-on-1 mode. Worth a refresh pass; this file is accurate in the meantime.
- Open security items from the last review pass: rotate `COACH_PASSWORD`, remove the JWT dev-secret fallback, purge a committed wifi password.

---

## 12. Fast health check

```bash
curl -s https://app.bestrongagain.com/api/health          # {"db":"connected","status":"ok"}
curl -sI https://bestrongagain.netlify.app     | head -1   # tracker
curl -sI https://workoutbuild.netlify.app      | head -1   # builder
curl -sI https://bsa-trainer-dashboard.netlify.app | head -1
```

All four were 200 on 2026-07-30.

---

## 13. Where to read next

| Question | File |
|---|---|
| How the repos wire together | `docs/ARCHITECTURE.md` |
| Per-coach video overrides | `docs/VIDEO_OVERRIDE_SYSTEM.md` |
| All `/api/media/*` endpoints | `docs/MEDIA_API.md` |
| Payment funnel end to end | `docs/PAYMENT_FUNNEL.md` |
| Deploy + git sync rules | `docs/DEPLOYMENT_AND_GIT_SYNC.md` |
| Gym TV / Pi kiosks | `docs/GYM_TV_KIOSK.md`, `docs/KIOSK_STATION_REDESIGN.md` |
| 1-on-1 training mode | `docs/ONE_ON_ONE_TRAINING.md` |
| Waivers + coach exercise proposals | `docs/WAIVER_AND_PROPOSALS.md` |
| Mobile CSS pattern | `docs/MOBILE_CSS.md` |
| Chat system | `docs/CHAT_SYSTEM.md` |
| Gym entity model | `docs/GYM_ENTITY.md` |
| Smart import | `docs/SMART_IMPORT.md` |
</content>
