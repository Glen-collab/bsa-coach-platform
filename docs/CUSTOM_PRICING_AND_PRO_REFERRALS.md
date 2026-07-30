# Coach-Set Pricing + Clinician Referrals — Design

**Status: proposal, nothing built.** Written 2026-07-30 against the code as it stands.

Two ideas that turn out to be one system: let trainers name their own price (and strip prices off the public site), and let physios/physicians earn off trainers they bring in. Both are changes to how an *amount* and a *referrer* are resolved. Neither needs a new commission engine.

---

## 0. The one thing to decide first

Glen is merchant of record. He collects the gross charge, pays Stripe's fee out of it, then transfers 80% to the coach and 10% to the upline. **His margin is not 10% — it's 10% minus the Stripe fee**, and the fixed 30¢ makes that brutal at low prices.

At standard US card pricing (2.9% + 30¢):

| Price/mo | Stripe fee | Coach 80% | Upline 10% | **Glen nets** | Effective margin |
|---|---|---|---|---|---|
| $5.99 | 0.47 | 4.79 | 0.60 | **$0.13** | 2.1% |
| $10 | 0.59 | 8.00 | 1.00 | **$0.41** | 4.1% |
| $15 | 0.73 | 12.00 | 1.50 | **$0.77** | 5.1% |
| $20 | 0.88 | 16.00 | 2.00 | **$1.12** | 5.6% |
| $50 | 1.75 | 40.00 | 5.00 | **$3.25** | 6.5% |
| $200 | 6.10 | 160.00 | 20.00 | **$13.90** | 7.0% |

**Break-even is $4.23/mo** when an upline is taking their 10% ($1.75 if there's no upline and Glen keeps 20%). Below that, every additional client *costs money*.

Two consequences:

1. **A price floor is mandatory, and it's not an arbitrary business rule — it's arithmetic.** Recommend **$19/mo minimum**, which nets ~$1.05/client/mo. Anything under ~$15 isn't worth carrying.
2. The existing **$5.99 tracker tier nets 13¢/month per subscriber**. That's fine as a loss-leader funnel into coaching, but it should be understood as one, not as a revenue line. It cannot absorb an upline *and* a payment-processing fee and still matter.

> Verify against your real Stripe rate before setting the floor. Stripe Billing adds ~0.5% on recurring if enabled, and Connect Express has per-payout and possibly per-active-account fees. Every one of those comes out of Glen's slice, not the coach's. The floor should be set from your actual net, not this table.

**If you want coaches pricing freely at low numbers**, the percentage model can't fund it. The alternative is a flat platform fee per active client (say $4/client/mo) taken off the top, with the coach keeping the rest. That decouples your revenue from their pricing decision entirely. It's a bigger change to `commission_engine.py` and I'd only do it if you actually want sub-$20 coaches.

---

## 1. Coach-set pricing

### What blocks it today

Five lines in `backend/stripe_routes.py`, all keyed off a hardcoded tier name:

| Line | Code | Problem |
|---|---|---|
| 177–180 | `if tier not in PRICE_IDS` | rejects anything not in the dict |
| 206 | `"price": PRICE_IDS[tier]` | can't point at a per-coach Price |
| **336** | **`amount_cents = TIER_AMOUNTS[tier]`** | **the linchpin** |
| 355 | `PRICE_IDS[tier]` → `stripe_price_id` | records the wrong price id |

Line 336 is the one that matters. That number is what gets written to `subscriptions.amount_cents` and then fed to `calculate_commissions()`. If it's wrong, **coaches get paid off a fiction** — and it fails silently, because nothing reconciles it against Stripe.

### The fix that unlocks everything

`handle_checkout_completed()` already calls `stripe.Subscription.retrieve()` on line 333 and then ignores it for the amount. Use it:

```python
stripe_sub = stripe.Subscription.retrieve(stripe_sub_id)
item = stripe_sub["items"]["data"][0]
amount_cents = item["price"]["unit_amount"]      # what Stripe actually billed
stripe_price_id = item["price"]["id"]
```

That single change makes the entire commission engine price-agnostic, because `calculate_commissions()` is already pure percentages off `sale_amount_cents` — it never looks at the tier. **Do this one first, on its own, before any custom-pricing feature.** It's strictly more correct for the four existing tiers too: today, editing a price in the Stripe dashboard silently desyncs from `TIER_AMOUNTS` and you'd never know.

### Schema

```sql
-- Ship this BEFORE the code. See §4.
ALTER TYPE subscription_tier ADD VALUE IF NOT EXISTS 'custom';

CREATE TABLE coach_prices (
  id                UUID PRIMARY KEY,
  coach_id          UUID NOT NULL REFERENCES users(id),
  price_cents       INTEGER NOT NULL,
  stripe_price_id   TEXT NOT NULL,
  currency          TEXT NOT NULL DEFAULT 'usd',
  is_active         BOOLEAN NOT NULL DEFAULT TRUE,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX ON coach_prices (coach_id) WHERE is_active;
```

History rows are kept, never updated. Changing a price deactivates the old row and inserts a new one with a fresh Stripe Price. **Grandfathering then costs nothing**: existing subscriptions keep billing their original `stripe_price_id`, because that's what Stripe has. Only new checkouts pick up the active row. Decide out loud whether you'll ever migrate existing subscribers — retrofitting that later is genuinely painful.

### Endpoints

```
PUT  /api/coaches/pricing          # coach sets their rate (auth required)
GET  /api/coaches/public/{code}    # PUBLIC — resolves a referral code for the signup page
```

`PUT /api/coaches/pricing` must:
- enforce `MIN_PRICE_CENTS`/`MAX_PRICE_CENTS` **server-side**, never trusting the client
- create one `stripe.Price` under a single shared "Coach Plan" Product
- deactivate the prior active row in a transaction

`GET /api/coaches/public/{code}` is unauthenticated, so it returns **only** display fields — coach name, price, blurb, photo. No email, no id, no stripe ids, no client counts. Rate-limit it; it's an enumeration surface over referral codes.

Max price matters as much as min. A coach billing $4,000/mo through your Stripe account is your chargeback and your reputation, since you're MoR.

---

## 2. Minimal landing, no public prices

Today `src/pages/Landing.jsx` hardcodes "$20" in the hero (line 315), the steps (333), the challenge CTA (291), and three tier cards (404+). `src/pages/Register.jsx:198–202` prints the price for each preset tier. `CoachPitch.jsx`, `GymFlyer.jsx`, `MemberDashboard.jsx`, `CoachDashboard.jsx`, and `BroadcastCard.jsx` also carry price strings — grep for `5.99` and `$20` before you call it done.

The shift: **price stops being a property of the platform and becomes a property of a coach.** The public site sells the idea; the number appears only once a specific coach is in context.

Cold traffic gets three doors instead of a price grid:

1. **"I have a coach's code"** → enter code → `GET /api/coaches/public/{code}` → *now* show that coach's name and price → register + checkout
2. **"I'm a trainer"** → coach application (exists)
3. **"I'm a PT or physician"** → new pro flow (§3)

`/register/{COACHCODE}` already carries the referral code and reads `?tier=`. Extend it: when the coach has an active custom price, resolve and display that instead of a tier name. The plumbing is there — `Register.jsx:82` already pulls `referralCode` from the URL.

Keep the $5.99 tracker as the one publicly-priced thing, since no coach is involved in it. Or hide it behind the trial. But note from §0 that it nets 13¢ — treat it as the top of the funnel, not a product line.

---

## 3. Clinician referrals — mostly already built

**This works today with zero commission-engine changes.** `get_upline_chain()` in `commission_engine.py:59–63` filters on `WHERE id = %s AND is_active = TRUE` — there is **no role filter**. So:

> A physio registers → recruits a trainer → the trainer signs up with the physio's referral code → `users.referred_by_id = physio_id` → **every sale that trainer ever makes pays the physio 10%, automatically, forever.**

That is exactly the described product. The money plumbing is done. `auth.py:130–134` already resolves any referral code to an upline, and `/connect/onboard` already creates Express accounts generically.

What's actually missing is role and UX, not money:

1. **A `pro` role.** Roles are plain strings (`admin | coach | member`) — `admin.py:155` promotes with `UPDATE users SET role='coach'`. Add `pro`. This matters because `coaches.py:202` and `:349` filter downline queries on `u.role = 'coach'`; a pro needs their own view, and shouldn't pollute coach trees.
2. **A pro dashboard** — trainers recruited, active clients under each, pending/paid commissions. It's a re-skin of the existing coach earnings view.
3. **A pro application flow** — clone `ApplyCoach.jsx`, capture license type and state.
4. **The landing door** from §2.

Estimate: this is the *small* piece of the three. Build it after §1's line-336 fix, because a pro earning 10% of a coach-set price depends on that amount being real.

---

## 4. Ship order

The order is not negotiable — step 1 is what broke the $5.99 tier.

1. **`ALTER TYPE subscription_tier ADD VALUE 'custom'`**, deployed and verified in RDS, **before** any code references it. Migration `029_add_tracker_tier_enum.sql` exists because adding `tracker` without the enum value produced "charged but no subscription" — Stripe took the money, the insert threw, the webhook 500'd. Same trap, same shape. Postgres also won't let you use a new enum value in the same transaction that adds it.
2. **Read the amount from Stripe** (line 336). Independent of everything else, correct on its own, deployable alone.
3. `coach_prices` table + the two endpoints, with bounds enforced server-side.
4. Landing/Register de-pricing.
5. `pro` role + dashboard.

Each step is separately deployable and separately revertible. Steps 1–2 are worth doing even if the rest never ships.

---

## 5. Legal — two different risks, and the smaller one is HIPAA

**HIPAA is largely avoidable, and the current design already avoids it.** The tracker's existing "Summary for PT / Doctor" button (`WorkoutTracker` commits `df6a539`, `6875cda`, `738c8f4`) has exactly the right shape: the *client* generates the summary and the *client* sends it. The data is the individual's own record, shared at their direction. Individuals aren't covered entities, so that flow carries no HIPAA obligation for the platform.

That holds only as long as the arrow points one way. **The athlete shares out; professionals are invited viewers, never authors of clinical content.** The moment a physio or physician writes a diagnosis, clinical note, or treatment plan *into* the app about a patient, they're plausibly using it to handle PHI on their own behalf — which can make the platform a Business Associate, and that brings a signed BAA, encryption at rest and in transit, access audit logs, and breach notification. Make it a hard design rule now; it's cheap to hold and expensive to unwind.

**The referral fee is the larger exposure, and it isn't HIPAA at all.** A licensed provider taking a percentage tied to patients they send somewhere runs into anti-kickback and fee-splitting rules: the federal Anti-Kickback Statute and Stark Law where Medicare/Medicaid business is involved, and — more relevant here — **state fee-splitting statutes and PT/medical board ethics rules that often apply even to pure cash-pay arrangements**. This is state-specific; Wisconsin's rules are the ones that matter for you.

The good news is that **the safer structure is also the one that needs less code**: pay the pro for recruiting **trainers**, professional-to-professional, not for sending **patients**. That is precisely what `referred_by_id` already does — the pro's downline is trainers, and their commission is a percentage of a trainer's business, not a fee per patient delivered. Avoid any commission that keys on an individual patient the pro referred, avoid per-patient bonuses, and disclose the arrangement plainly to clients.

Worth one paid hour with a healthcare attorney in Wisconsin before launch — specifically on the referral fee, not on HIPAA. It's not a reason to delay building §1–§4.
