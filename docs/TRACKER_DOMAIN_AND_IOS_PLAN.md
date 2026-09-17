# Tracker Domain Fix — and the plan for a native iOS tracker

Written on the Mac, 2026-09-17. Everything in Part 1 is for the **Windows box**,
because that is where the EC2 deploy key lives. Part 3 is for the Mac, later.

---

## Why this exists

Clients could not find the workout tracker. The assumption was "people don't
understand what a PWA is." That is not what the evidence says.

The tracker is a **good PWA** — real Workbox service worker, correct manifest,
offline-capable, named "Workout Tracker." Nothing is wrong with it. The problem
is that it has no domain of its own and the public link points somewhere else:

| What | URL |
|---|---|
| The actual tracker | `bestrongagain.netlify.app` |
| What the portfolio page links to | `app.bestrongagain.com` — **the coach console** |
| What access-code emails link to | `bestrongagain.netlify.app` |
| `tracker.bestrongagain.com` | does not resolve |

`apps-page/apps.json` line 183, the `tracker` entry, has
`"url": "https://app.bestrongagain.com"`. Every client who taps **"Open the
tracker"** on the portfolio page lands on the BSA Coach console, whose home
screen is the gym TV. Meanwhile the emails send them to a `.netlify.app`
address that reads like a typo.

Two URLs in circulation, and the public one goes to the wrong app.

---

# Part 1 — For the Claude on the Windows box

## Do this in this order. The order is the whole point.

### Step 0 — Confirm the branch

The Mac's `bsa-coach-platform` checkout is on branch **`checkin-system`**
(clean, one commit ahead of `origin/master`). Check what the Windows box is on
before editing:

```bash
git status -sb
```

If it is on a different branch than the one that gets deployed, ask Glen which
branch the CORS change belongs on. Do not guess. A CORS line that sits on an
undeployed feature branch looks done and is not.

### Step 1 — Check whether the email work is already finished

**This is probably a no-op. Check before writing any code.**

`backend/workout_api.py:1039` already sends Glen an email on every logged
workout:

```python
send_email(TRAINER_EMAIL, f"Workout {'Re-Logged' if is_relog else 'Complete'}: {name} — W{week}D{day}", ...)
```

It is unconditional, and the body already carries tonnage, calories, cardio
minutes, belt level, access code and program name. There is a 15-minute
double-submit guard at `workout_api.py:1014-1020` so an accidental re-tap stays
silent while a genuine re-log days later still sends.

> Line numbers in this doc were verified against `checkin-system` at commit
> `faefa01` (2026-09-01). `email_helper.py` gained 22 lines in the check-in
> work, so anything citing it from an older note will be off.

So if Glen is not receiving these, it is **not** missing code. It is one of:

1. `GMAIL_APP_PASSWORD` is not set in the environment on EC2. It lives in
   `/opt/bestrongagain/.env` (gitignored — see this repo's `CLAUDE.md`).
   `backend/email_helper.py:41` silently returns `False` and prints
   `No GMAIL_APP_PASSWORD set — skipping email`. It never raises, so nothing
   in the logs looks like an error.
   ```bash
   ssh ec2-user@3.19.135.182 "sudo grep -c GMAIL_APP_PASSWORD /opt/bestrongagain/.env"
   ssh ec2-user@3.19.135.182 "sudo journalctl -u bestrongagain.service --since '7 days ago' | grep -i 'skipping email\|Email error'"
   ```
2. The mail is landing in spam. Search the inbox for `Workout Complete:`.

Check `/api/admin/email-log` to see what actually went out.

**Do not add a second send_email call.** If this turns out to be an env var,
the fix is on the server, not in the repo.

### Step 2 — CORS, and deploy it BEFORE any DNS change

`backend/app.py:42`. The allowlist has the Netlify host and not the new domain:

```python
CORS(app, origins=[
    "https://bestrongagain.netlify.app",          # workout tracker
    "https://tracker.bestrongagain.com",          # ← ADD THIS LINE
    ...
```

This is **purely additive**. The existing Netlify origin stays exactly where it
is, so nobody currently using the tracker is affected by this change at all.

It matters because `WorkoutTracker/src/hooks/useTrackerAPI.js:3-4` hardcodes
absolute `https://app.bestrongagain.com/api/...` URLs, so every call from the
tracker is cross-origin. If the new domain goes live before this is deployed,
the tracker will load and then fail every request — blank program, cannot log,
no visible error explaining why.

Deploy it per `docs/DEPLOYMENT_AND_GIT_SYNC.md` **Model B** (this repo is not
git-driven — pushing does not deploy):

```bash
git add backend/app.py
git commit -m "CORS: allow tracker.bestrongagain.com"
git push origin <branch>          # step 0 of the golden rule — back it up first

# then deploy (exact commands from this repo's CLAUDE.md):
scp backend/app.py ec2-user@3.19.135.182:/tmp/
ssh ec2-user@3.19.135.182 \
  "sudo mv /tmp/app.py /opt/bestrongagain/app.py && sudo systemctl restart bestrongagain.service"
ssh ec2-user@3.19.135.182 "sudo systemctl status bestrongagain.service --no-pager | head -5"
```

Restarting the backend is a brief outage. **Do not do it mid-morning or
mid-evening when clients are training.** Nothing should break in the middle of
somebody's session.

Verify after deploy:

```bash
curl -s -o /dev/null -w "%{http_code}\n" \
  -H "Origin: https://tracker.bestrongagain.com" \
  https://app.bestrongagain.com/api/health
# and confirm the allow-origin header comes back:
curl -sI -H "Origin: https://tracker.bestrongagain.com" \
  https://app.bestrongagain.com/api/health | grep -i access-control-allow-origin
```

If that header is absent, stop. Do not touch DNS.

### Step 3 — Add the domain in Netlify (Glen does this, not Claude)

This is a dashboard setting, not code.

Add `tracker.bestrongagain.com` to the `WorkoutTracker` Netlify site as an
**alias**, and leave **"redirect to primary domain" OFF**.

> **This is the setting that can actually hurt people.** If the custom domain
> becomes primary, Netlify 301s `bestrongagain.netlify.app` to it. On iOS a
> standalone PWA that navigates off its own origin drops out of standalone mode
> into an in-app browser view. Every client who already added the tracker to
> their home screen gets a degraded icon and a visible URL bar.
>
> As an alias with no redirect, both hostnames serve the same build. Existing
> installs keep working untouched. New people get a URL you can say out loud.
> There is no cost to running both indefinitely and no forced migration day.

One known and acceptable consequence: `localStorage` is origin-scoped, so
`gwt_saved_credentials` (`WorkoutTracker/src/App.jsx:1130`) does not travel to
the new domain. Anyone who *chooses* to switch re-enters their access code and
email **once**.

That is the entire blast radius. Programs and logs live in Postgres keyed by
code + email, untouched. And `App.jsx:849-861` re-hydrates the onboarding flags
from the server record, so they will **not** be re-shown the welcome
walkthrough, the consent flow or the pain questionnaire:

> *"Seen once is now seen everywhere, which is the whole point."*

### Step 4 — Only after DNS actually resolves

Confirm first:

```bash
curl -sI https://tracker.bestrongagain.com | head -1
```

Then, and not before, update the two links:

- `backend/email_helper.py:12` — `TRACKER_URL = "https://bestrongagain.netlify.app"`
  → the new domain.
- `apps-page/apps.json:183` — the `tracker` entry's `"url"`.

**Why this is last:** changing `TRACKER_URL` before the domain resolves points
every access-code and magic-link email at a dead host. It does not break the
tracker, so nothing alerts you — you find out when a new client says the link
did not work.

### Step 5 — apps-page rebuild, with one verification

`apps-page` regenerates `apps.html` via `./build.sh`. **This is the build that
has already bitten you once.** From `apps-page/HANDOFF.md`: Windows produced a
different `apps.html` than the Mac, because git checked `tracker.svg` out with
CRLF and `build.sh` base64-encodes the icon bytes straight into the page, so the
CRLFs ended up inside the data URI.

That is fixed — `apps-page/.gitattributes` now pins `*.svg -text`,
`*.png binary`, `apps.html -text`, `*.sh text eol=lf`, and its own comment notes
that autocrlf is on for the Windows checkout. But the fix has **not been proven
on Windows**; the currently deployed page is still the Mac-built one, extracted
with `git show HEAD:apps.html` and md5-checked against the server.

So: build it on Windows, then md5 it against a Mac build **once**. After that
you will know, and it stops mattering which machine builds it.

---

## Known trap in this repo (not blocking, worth closing)

`bsa-coach-platform` has **no `.gitattributes`**, and the Mac has
`core.autocrlf` unset. The line-ending fix was applied to `apps-page` only.

This repo ships `scripts/run_backup.sh`, `scripts/pi-kiosk/install.sh`,
`scripts/pi-kiosk/bsa-pi-install.sh` and three `.service` units — exactly the
files where a stray `\r` fails in ways that look nothing like line endings
(bash reads the `\r` as part of the last word on the line).

Python does not care about CRLF, so this does **not** affect the `app.py` or
`email_helper.py` edits above. But it is live for the Pi kiosk work. Copying
`apps-page/.gitattributes` into this repo would close it.

---

## Checklist

- [ ] Branch confirmed with Glen
- [ ] `GMAIL_APP_PASSWORD` checked on EC2 / spam folder searched → email may need nothing
- [ ] CORS line added to `backend/app.py:42`
- [ ] Committed **and pushed** (golden rule: git must match what is live)
- [ ] Backend deployed to EC2 + restarted, outside training hours
- [ ] `access-control-allow-origin` verified by curl
- [ ] Netlify alias added, **redirect-to-primary OFF**
- [ ] `tracker.bestrongagain.com` resolves
- [ ] `TRACKER_URL` updated, deployed
- [ ] `apps.json` updated, `apps.html` rebuilt, md5 verified, deployed
- [ ] Old `bestrongagain.netlify.app` still loads and still logs a workout

---

# Part 2 — "Can I still build workouts in the workout builder?"

**Yes. That is the entire design, and it stays true for a native app.**

The path today:

```
workoutbuilder  →  save-program.php   →  workout_programs.program_data (Postgres)
                                                      ↓
                                            load-program.php
                                                      ↓
                                          tracker (PWA, or a future iOS app)
```

`program_data` is **data, not code** —
`{ name, daysPerWeek, hiddenDays, totalWeeks, blocks: [...] }`. A native iOS app
calling the same `load-program.php` with the same access code receives the
identical JSON the PWA receives.

So: **new workouts, new weeks, new programs, changed sets and reps, client
overrides — all of it reaches the app with no App Store submission.** You keep
using the builder exactly as you do now. App Review would only ever be involved
when the *app itself* changes, never when a workout changes.

### The one real caveat, and it is fixable

The exercise **library** is not on that path today. `exerciseSwapIndex.json`
(1,649 exercises, each with its Cloudflare video uid) is a **build-time
artifact**, imported statically at `WorkoutTracker/src/App.jsx:15` and
`components/program/ExerciseCard.jsx:7`. It is generated by
`scripts/generate-swap-index.mjs`, which reads
`../../workoutbuilder/src/data/exerciseLibrary.js` — a **sibling repo on disk**.

On the web that is fine: re-run the script, push, Netlify rebuilds. In a native
app, a bundled index would mean **an App Store submission to add one exercise** —
one to three days of review to make a new lift swappable.

**Fix it before writing the iOS app, not after:** add a
`GET /api/workout/exercise-index` that serves the same JSON from the server,
cache it on the device, refresh on launch, ship a copy in the bundle as the
offline fallback. Then the library updates like everything else.

Start from what this repo already has rather than inventing a second source:
`src/data/exercise_manifest.json` — 2,060 exercises flattened from the builder's
libraries, regenerated by `scripts/build_exercise_manifest.js` (see `CLAUDE.md`).
That is a superset of the tracker's 1,649-entry swap index. Decide deliberately
which one the endpoint serves; **do not let a third copy of the exercise list
come into existence.** Rule #9 — guard against drift between two
implementations, pinned fixture, both sides change in one commit.

Note also `CLAUDE.md`'s warning that `workoutbuilder-tkd/` on the Desktop is a
**stale clone** — never build the manifest from it.

There is already precedent for this shape — `useTrackerAPI.js:104-105` fetches
per-coach video overrides from `/api/media/tracker-overrides` and falls back to
the bundled videos on failure. Same pattern, one level down.

---

# Part 3 — The iOS app (Mac, later)

## Do not do this yet

Fix the URL first and watch for two weeks. If clients still cannot find the
tracker once the link actually works, the native build is clearly justified and
you will know why. If they find it fine, you saved three weeks and Apple's cut.

## Do not merge the repos

`react-trainer-dashboard` (3,978 LOC) and `workoutbuilder` (7,745 LOC) are 100%
trainer-facing — client lists, 1RM editors, program builders. Merging them into
a client app means immediately writing the exclusions back out. Those stay as
web tools. The iOS app is a **client app only**.

## Scope

**In:** sign in with access code + email · today's workout · log sets, reps,
weight · watch the exercise video · history.

**Out (stays on the web):** the 53-node pain chatbot, travel workouts, the belt
progression game, friend chat, TV cast, kiosk mode, print view, the program
builder, the trainer dashboard.

## Architecture

Thin client against the API that already exists. No new backend, no CloudKit,
no second source of truth.

- `load-program.php`, `log-workout.php`, `get-weekly-stats.php`,
  `lookup-user.php` — all already live, all already serving the PWA.
- Videos: **near zero work.** 931 videos on Cloudflare Stream, none require
  signed URLs, HLS returns 200. `AVPlayer` takes the URL directly — about ten
  lines. Note the PWA uses the `iframe.videodelivery.net` embed; native should
  use the HLS manifest on `customer-hy3lgophk94jhjoi.cloudflarestream.com`.
  Same uid, different wrapper.
- Add `GET /api/workout/exercise-index` first (Part 2).

## Effort — honestly

The tracker is **23,642 LOC across 77 files**. A full native port is months and
is not the plan. Scoped as above it is roughly a third of `App.jsx` plus
`ExerciseCard` and `TrackingInputs`: **2–3 focused weeks to a submittable 1.0**,
at the pace of the last six apps.

## Two costs to price in before starting

**1. Drift.** Rule #9. Percentage-based sets, 1RM math, tonnage, the up/down
recommendation arrows — those rules would then exist in JavaScript *and* Swift,
both against one API. That is the real long-term bill, not the build. Mitigation:
keep every number the server already computes on the server, and have the app
render unknown block types plainly rather than hiding them — degrade to
something plain, never something wrong.

**2. Apple's cut.** The apps page sells this at **$20/month**. A subscription
inside a native app requires IAP at 15–30% — $3–6 per client per month, forever,
against ~3% on Stripe today.

The way out: a **free, sign-in-only** app for people already signed up at the
gym. No pricing shown, no purchase link, no path to subscribe in the app. This
is legitimate and common, and it fits the real situation — clients are onboarded
in person, not acquired from App Store search. App Review will need a **demo
account in the review notes**, or it gets rejected under 2.1 for being
un-reviewable.

## What the App Store actually buys

One thing, and it is the strongest argument in favour: **you stop having to
explain anything.** "Search Be Strong Again on the App Store" is a sentence that
works the first time. "Go to this URL, tap the share icon, scroll down, tap Add
to Home Screen" is not, and never will be.

That is worth real money and real weeks. It is just worth checking first whether
a working link solves it, because right now the link does not work.

## Open questions for that session

- Does the prescribed exercise's video resolve through the bundled swap index,
  or is the uid carried in `program_data`? `ExerciseCard.jsx:1127` builds the
  URL from `swappedVideo` only — confirm where the *unswapped* video comes from
  before designing the offline story.
- Sign-in: keep the email + access-code model (deliberately public, not JWT —
  see the comments in `challenges.py:431,491`), or move to the JWT auth in
  `backend/auth.py`? The PWA uses the former.
- Offline: how much of a workout must be loggable with no signal, and does it
  queue and sync? Rule #1 says the first screen never blocks on a network call.
