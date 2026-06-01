# 1-on-1 Training Mode — Plan

Status: **planning → building** · Started 2026-06-01 · Owner: Glen

## The idea in one line
Give the trainer a **digital version of their paper workout sheet**: from the
Coach Dashboard, tap **"1-on-1 Training"**, pick a client (or a 2–3 person
group), and that client's existing workout tracker opens on the iPad so the
trainer logs weights/reps as they go — exactly like pen-to-pad. Nothing in the
tracker or dashboards is rebuilt; we reuse what's already shipped.

## Who it's for
Trainers doing **one-on-one** (or small-group, 2–3 people) personal training who
today carry a paper sheet for all 4 days and fill it in by pen. The client does
**not** need the app. The trainer is the operator.

## What is explicitly NOT being built
- No new tracker. We reuse the existing WorkoutTracker logging UI.
- No new member dashboard. The member view already shows coach notes, session
  count, and the monthly challenge.
- No "premium magic-link dashboard that shows numbers" tier. That idea was
  raised and dropped — see Tiers below. "Buying the app" is the line between
  notes-only and seeing-the-numbers.

## Placement (decided)
- **Button: Coach Dashboard only** (`bsa-coach-platform/src/pages/CoachDashboard.jsx`),
  coach-authenticated. **Not** next to the Gym TV "Remote Control" button —
  that's TV/kiosk-specific and irrelevant to a trainer with no gym screen.
- **Not** on the tracker. The tracker is client-facing; the button launches
  *into* it in a client-picker mode.

## The tier ladder
| Tier | Who logs | What the client sees | Pays |
|------|----------|----------------------|------|
| **Free member** | — | Coach notes, session count, monthly challenge. **No numbers.** | gym membership |
| **1-on-1 (concierge)** | **Trainer**, on the iPad | Same as free: coach notes, sessions, challenge. **No numbers** (no app). | the training price |
| **$20/mo self-serve** | Client, on own phone | Everything incl. the numbers the trainer logged; can train/log offsite | $20/mo |

Key rule: **the volume/tonnage/number cards on the member dashboard stay gated to
paying app clients.** A 1-on-1 client without the app never sees numbers even
though the trainer has been logging them. Verify this gate exists; add it if not.

## Reference scenario — "Debbie"
1. Glen builds a program, puts Debbie's **name + email** on it, code `XYZ`.
2. On the iPad, Glen opens **1-on-1 Training**, taps **Debbie** → her program
   auto-loads (client-first; no retyping email/code).
3. Glen logs her weights as they train. Data saves to **Debbie's** record
   (her code/email bucket — isolated, never mixed with other clients/group).
4. Debbie leaves. Glen opens the trainer dashboard, drops a **note** on today's
   session (how she felt / observations) → it appears on Debbie's member dashboard.
5. Debbie checks her dashboard later and reads Glen's notes.

## How Debbie gets into her dashboard (already built)
Passwordless **magic-link login** — `auth.py` already has
`POST /magic-link/request` → `POST /magic-link/consume`:
- Debbie enters her **email** on the login → gets a "Sign in to Be Strong Again"
  email with a one-tap link → lands in her read-only member dashboard.
- The endpoint **auto-creates her user record** if it doesn't exist. No password,
  no registration. Same mechanism chosen for FriendChat.
- **Nicety (B):** auto-fire that magic-link as a welcome the moment the trainer
  adds a 1-on-1 client: *"Glen set up your dashboard — tap here."*

### The one invariant that makes it all connect
**The email on the program == the email Debbie signs in with.** That email is the
join between "what the trainer logged" and "what shows on her dashboard." So the
1-on-1 picker must **reuse each client's stored email/code automatically** — the
trainer never retypes it, so it can't drift and orphan the data.

## What already exists and gets reused
- **`KioskPickerScreen`** (WorkoutTracker) — already lists "clients under this
  coach," loads a selected person's workout, logs, returns to picker. Launched
  via `?kiosk=1&coach=<referral_code>&...`. This is the engine.
- **Coach client roster** — already on CoachDashboard.
- **Logging → client record** — `log-workout` already saves volume_stats to the
  client's bucket; their dashboard reads it.
- **Chatbot notes** — trainer→member note flow already works.
- **Magic-link auth** — already built (above).

## The build
### (A) Trainer side — core
1. **"1-on-1 Training" button/card** on CoachDashboard (coach-only).
2. **Client-first picker**: list the coach's clients (+ optional 2–3 person
   groups). Difference from the existing kiosk flow, which is *program-first*:
   here, picking the **client** auto-loads **her** program (each client has her
   own code). Reuse/extend `KioskPickerScreen`.
3. Tap client → her tracker opens in the normal logging UI → trainer fills it,
   adds chatbot notes, logs. Routes to her code/email.
4. Picker auto-uses each client's stored email/code (enforce the invariant).

### (B) Fast follow — nicety
- Auto-send the magic-link welcome email when a 1-on-1 client is added.

### Build order
1. Single-client first (get it usable on the floor).
2. Add the small-group (2–3) selection after Glen has run it once.
3. Then (B) welcome email.

## Open questions / to verify during build
- Does `KioskPickerScreen`'s coach-clients data include each client's **own
  program code** (client-first), or only names for one shared program? If only
  shared, add/extend the endpoint to return per-client code+email.
- Confirm the member dashboard **numbers gate** (hidden unless paying app).
- Deploy: coach-platform = build + scp to EC2 then push (per deploy rules);
  tracker = push to main → Netlify. Keep BSA/Polly separation; scope every op.

## Cross-repo
- `bsa-coach-platform` — the button (CoachDashboard), magic-link, member view, coach-clients API.
- `WorkoutTracker` — the picker (`KioskPickerScreen`) + tracker logging UI.
