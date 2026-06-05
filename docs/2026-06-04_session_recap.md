# Session Recap — 2026-06-04

Big cross-repo day: shipped the **$5.99 "Tracker Only" tier** end-to-end, a
**trainer-dashboard upsell radar**, the **movement-drills restructure**, the
**athlete report composer rework + per-coach sync**, a **free-week landing
banner**, **tracker onboarding polish**, a **per-coach gym flyer generator**, and
a **Stripe rebrand** (Polly Connect → Wisconsin Barbell).

Repos touched: `bsa-coach-platform`, `react-trainer-dashboard`, `workoutbuilder`,
`leaderboard`, `WorkoutTracker`.

---

## 1. $5.99 "Tracker Only" tier (gym-members-only)

A cheap tier: same tracker, **no coaching** — "just a database for them to input."
Promoted gym-only, **not** on the public landing (so it doesn't undercut the $20
funnel).

- **Backend** (`bsa-coach-platform/backend/stripe_routes.py`): `tracker` added to
  `PRICE_IDS` + `TIER_AMOUNTS` (599¢). Env `STRIPE_PRICE_TRACKER=price_1TecC1IVieVjOXW4GAwMlQnZ`
  set in `/opt/bestrongagain/.env`.
- **Frontend**: `Register.jsx` + `Login.jsx` allowlists now include `tracker`;
  `MemberDashboard.jsx` has a quiet "Or just the Workout Tracker — $5.99/mo (no
  coaching)" link under the tiers.
- **Gym signup link (hand out / QR):**
  `app.bestrongagain.com/register/GLENM7NUS?tier=tracker`
- **Decision:** the $5.99 (and all paid tiers) still get the universal **1-week
  free trial** before payment is required — we chose NOT to gate them behind
  upfront payment. Free week stays the simple universal trial.

## 2. Trainer dashboard — $5.99 upsell radar  (`react-trainer-dashboard`)

`get-clients.php` already returns `plan_tier`. Added a segment toggle in
`src/App.jsx` + `src/components/clients/ClientTable.jsx`:

- **Coaching** vs **Tracker-only · $5.99** tabs (tab only appears once a tracker
  client exists). Tracker tab = the upsell radar, **sorted by most-recent
  activity** so engaged $5.99 members float to the top.
- `PlanBadge` now shows exact **$5.99** (not rounded to $6) with its own sky tone.

## 3. Movement drills restructure  (`workoutbuilder`)

Reorganized `src/data/generalMovements.js` so the Movement block reads by
direction (Glen's teaching model):

- **Movement Presets** → Linear / Lateral / Multi-Directional (Beg→Adv combos)
- **Movement Drills** → Linear / Lateral / Multi-Directional (individual drills)
- Flat banks kept: **Plyometrics Lower/Upper, Conditioning, Cardio Equipment**

Nested shape `{ label, subcategories: { key: { label, exercises:[] } } }`.
`ExerciseModal.jsx` got category→subcategory drill-down; `MovementCategoryList.jsx`
counts nested banks. **Conditioning block still keys off `conditioning_general` +
`cardio_equipment` by name — don't rename those keys.**

- Full guide + live inventory: **`workoutbuilder/docs/MOVEMENT_DRILLS.md`** (134
  entries). Add a drill by dropping `{name, description}` into the right
  `exercises` array — picker updates automatically, no code changes.
- Also exported a Word copy to the desktop (`BSA Movement Drills.doc`).

## 4. Athlete report composer rework  (`leaderboard`, `AthleteCard.jsx`)

- Tapping a "Doing well" / "Working on" **phrase now inserts it straight into the
  note box** (no AI, no selection state). Coach types their own metrics in the
  same box.
- Replaced the auto "Generate" (which invented content) with an **optional
  "✨ Make it flow"** button — it ONLY fixes punctuation/sentence flow and is
  prompt-forbidden from adding any new info. Post as-is or polish first.
- Phrase editing is clearly **global**: "Edit phrases (all athletes)" + a banner
  explaining the list is shared and doesn't touch saved notes/metrics.

## 5. Per-coach report-phrase sync  (`leaderboard`)

The phrase lists now sync across all a coach's devices (was localStorage-only).

- **Backend**: new `settings` key/value table (`server/db.js`) + coach-only
  `GET/PUT /api/settings/report-phrases` (`server/settings.js`, registered in
  `server/index.js`). One DB per coach → inherently per-coach.
- **Frontend**: `api.getReportPhrases()` / `saveReportPhrases()`; `AthleteCard`
  loads from server on open, saves there on edit. localStorage kept as an offline
  cache. Fresh instances return `null` → built-in defaults.

## 6. Landing free-week trial  (`bsa-coach-platform`, `Landing.jsx`)

The 1-week free trial was only reachable via the bare `/register/GLENM7NUS` URL
(every public CTA appended `?tier=basic`). Added a **prominent free-week banner**
under the pricing tiers → links to the no-tier free path (no card). Paid tiers
still lead.

## 7. Tracker onboarding polish  (`WorkoutTracker`)

- **Feedback (transition) survey** no longer pops the instant a new/trial user
  gets in. We stamp first login and only surface it on a **return visit ~a day
  later** (`App.jsx`).
- **"?" help tips** (plain-English explainers for 1RM / body stats), pulsing for
  first-timers (per-device `gwt_form_help_seen`). Shared component at
  `src/components/common/HelpTip.jsx` (pulse keyframe in `index.css`). Used on the
  new-user form, **returning-user form** ("Update 1RM" / "Body Stats"), and the
  **in-program profile widget**. Friendly blue "?" chosen over a red "1" (red
  reads as an error).
- **Fixes (same day):** tooltip was running off-screen on phones → now
  `position:fixed`, centered in the viewport (can't clip). Fixed a Body Stats tip
  showing a literal `—` (JSX attributes don't decode JS escapes).

### Tier-aware Dashboard upsell  (`DashboardButton.jsx` + `auth.py`)

- `auth/check-member` now returns `{is_member, tier}`. **Tracker-only ($5.99) is
  NO longer a "full member"** → the tracker's Dashboard button shows the upsell
  instead of opening an empty dashboard.
- Upsell modal is tier-aware: names the plan ("You're on the Free Tracker" /
  "the Gym Workout Tracker") and frames the upgrade as unlocking the **dashboard +
  Coach Glen's notes**. Free users → "Become a Member — $20/mo"; $5.99 users →
  "Log in to upgrade →" (avoids double-charging an existing subscriber).

## 8. Per-coach gym flyer generator  (`bsa-coach-platform`)

- New `/gym-flyer` page (`src/pages/GymFlyer.jsx`) + a "🖨️ $5.99 Gym Flyer" tool
  button on the Coach Dashboard. Generates a Letter-size flyer with a **QR + link
  carrying that coach's referral code** (credits their sign-ups). Print/Save-PDF;
  `@media print` strips the chrome. Added the `qrcode` dependency.
- Also a static `BSA Tracker Flyer.html` on the desktop (Glen's code baked in).

## 9. Stripe rebrand — Polly Connect → Wisconsin Barbell

The checkout/payment page showed "Polly Connect" because the **Stripe account is
shared** between BSA and Polly Connect (`acct_1TC2IOIVieVjOXW4`) and was named
"Polly Connect." This is **account settings, not code** — changed in the Stripe
Dashboard.

- ✅ **Public business name** (top of Checkout) → Wisconsin Barbell
- ✅ **Dashboard display name** → Wisconsin Barbell
- ⏳ **Statement descriptor** (card statements) → still `POLLY CONNECT` — TODO:
  Settings → Business → Public details → Statement descriptor → `WISCONSIN BARBELL`
  (max 22 chars). Important so customers recognize the charge.
- Verify (read-only) any time via the server `sk_live`: `GET /v1/account`.

---

## Deploy notes

- **coach-platform**: `npm run build` → scp `dist/*` to `/var/www/bestrongagain/`;
  backend scp to `/opt/bestrongagain/` + `sudo systemctl restart
  bestrongagain.service`; push **master**.
- **leaderboard**: build → scp `dist/*` to `/var/www/leaderboard/`; backend scp to
  `/opt/leaderboard-api/server/` + `sudo systemctl restart leaderboard-api.service`;
  push **main**. API health: `:5052/api/health`.
- **WorkoutTracker / workoutbuilder / react-trainer-dashboard**: push **main** →
  Netlify auto-deploys.
- EC2: `ec2-user@3.19.135.182`, key `Desktop/polly-connect-key.pem`.

## Open / TODO

- Stripe **statement descriptor** → Wisconsin Barbell (Glen, dashboard).
- Optional: true one-tap **$5.99 → $20 plan-swap** (Stripe subscription update)
  instead of "Log in to upgrade" — not built (avoids double-charge for now).
- Optional: branding logo/icon on the Stripe checkout page.
