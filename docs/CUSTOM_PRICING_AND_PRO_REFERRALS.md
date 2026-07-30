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
2. The $5.99 figures above are what a **different** coach selling at $5.99 would leave on the table — 13¢. They do **not** describe Glen's own gym members.

### Why the table doesn't apply to Glen's own clients

When Glen is both the selling coach and the platform, all three slices come back to him: 80% via his Connect transfer, 10% platform fee, and the unclaimed upline 10%. His real take on a $5.99 gym member is **$5.99 − $0.47 Stripe = $5.52**, not 13¢. The margin problem only exists when the 80% leaves for someone else.

**Decided 2026-07-30:** the `tracker` $5.99 tier is **Glen's in-person gym rate and is not offered to other coaches.** Other coaches use `basic` $20 and up, or their own custom price subject to the floor. Later, trainers who want the full suite (Raspberry Pi kiosks, gym TV, hardware, the whole build) get charged directly for the amenities, and *that* is what buys them the ability to offer $5.99 to their own clients.

That decision is what makes coach-set pricing safe. Enforce it in code, not just policy — `tracker` must be rejected for any coach other than the platform owner, or the floor is trivially bypassed by pointing clients at the cheap tier.

> If Glen later wants sub-$20 coaches without the hardware deal, the percentage model can't fund it and it has to become a flat per-active-client fee.

> Verify against your real Stripe rate before setting the floor. Stripe Billing adds ~0.5% on recurring if enabled, and Connect Express has per-payout and possibly per-active-account fees. Every one of those comes out of Glen's slice, not the coach's. The floor should be set from your actual net, not this table.

**If you want coaches pricing freely at low numbers**, the percentage model can't fund it. The alternative is a flat platform fee per active client (say $4/client/mo) taken off the top, with the coach keeping the rest. That decouples your revenue from their pricing decision entirely. It's a bigger change to `commission_engine.py` and I'd only do it if you actually want sub-$20 coaches.

---

## 0b. The coach's 80% is never actually paid

Found while tracing the payout path on 2026-07-30, verified against production.

`calculate_commissions()` builds exactly two records: a `PLATFORM` row (10%, which `save_commissions()` then **skips inserting** — it's tracking only) and an upline row (10%). **There is no row for the selling coach's 80%, and no code anywhere transfers it.** The comment at `commission_engine.py:71` — *"Don't add the coach themselves — they keep their 80%"* — would be true under **direct charges**, where the coach is merchant of record and the money lands in their account. But checkout runs on the **platform account**, so the coach keeps nothing. The full charge sits in Glen's Stripe balance.

Production state, confirmed by query:

- **0 of 6** commission rows have ever had a `stripe_transfer_id`. **No Stripe Transfer has ever executed.**
- The two 80% rows that do exist came from `006_backfill_jace_commission.sql` and a manual insert — not from the engine.
- 2 coaches, 1 completed Connect onboarding, 53 members.

**This is invisible today because Glen is both the platform and the only selling coach** — money staying in his balance is where he wants it anyway. It breaks the first time another coach makes a sale: they will be owed 80% that no code path produces or pays.

Deployed `/opt/bestrongagain/` matches the repo byte-for-byte (md5 verified), so this is the live behaviour, not local drift.

**This is a prerequisite for everything below.** Coach-set pricing and clinician referrals are both features about paying people correctly; neither means anything until the 80% leg exists. Order of work:

1. Correct amount (§1, done — the change is in `resolve_subscription_price`)
2. **Record and pay the coach's 80%** — add a `depth_from_earner = 0` commission row for the selling coach in `calculate_commissions()`, so the existing `pay_commission()` Transfer machinery picks it up unchanged
3. Then custom pricing, then pro referrals

**Decided 2026-07-30: one-week free trial, then a monthly payout cycle.** The immediate `pay_commission()` loop that currently runs right after `save_commissions()` goes away; commissions accumulate as `status='pending'` and a monthly job settles them. Easier to reconcile, and reversible when a charge is disputed.

### 0c. Two bugs that block step 2 — found while checking the trial path

**Commissions fire twice on the first month, by luck of event ordering.** `checkout.session.completed` and `invoice.payment_succeeded` are *both* handled (`stripe_routes.py:324–328`) and *both* call `calculate_commissions()`. Stripe does not guarantee order:

- invoice event first → `handle_invoice_paid` finds no `subscriptions` row yet → returns → checkout then commissions once. **Total: 1.**
- checkout event first → commissions once → invoice event then finds the row → commissions **again. Total: 2.**

Production has exactly one upline row per subscription (4 rows, 4 subscriptions), so the invoice event has been landing first every time so far. That is luck, not design, and it becomes a double payout the moment transfers actually execute.

**Checkout commissions on money that hasn't arrived.** `handle_checkout_completed` commissions the subscription's *price* with no check that anything was collected. With a one-week trial, checkout completes having collected **$0**, and a full month's commission is recorded against it — payable at month end even if the client cancels during the trial.

**Both have the same fix, and it's the right architecture anyway: commission only on `invoice.payment_succeeded`.** That event means money actually moved. Remove the commission block from `handle_checkout_completed` entirely and let the first invoice carry it. Trials then commission nothing until the first real payment, and the double-fire race disappears because only one event path can create rows.

The `amount_paid <= 0` guard shipped 2026-07-30 already prevents the *invoice* side from commissioning a $0 trial cycle. The checkout side is still open and must be closed before trials go live.

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

### The fix that unlocks everything — DONE 2026-07-30

`handle_checkout_completed()` already called `stripe.Subscription.retrieve()` and then ignored it for the amount. Now it uses it, via `resolve_subscription_price(stripe_sub, tier)`, which returns what Stripe actually billed and falls back to the tier table if Stripe's shape is ever unexpected — so it is never worse than the old hardcoded behaviour. Covered branches (all tested): normal tier, custom price, dashboard-edited price, metered price with `unit_amount = None`, zero amount, malformed payloads, and unknown-tier-plus-broken-Stripe (which now aborts loudly rather than writing a null amount that would poison every commission derived from it).

`handle_invoice_paid()` now commissions off the invoice's `amount_paid` rather than the amount cached at signup, so proration, a coach's price change, a coupon, or a partial refund all commission the money that actually moved.

Together these make the commission engine price-agnostic, because `calculate_commissions()` is already pure percentages off `sale_amount_cents` — it never looks at the tier. This was worth shipping on its own regardless of custom pricing: previously, editing a price in the Stripe dashboard silently desynced from `TIER_AMOUNTS` and nothing would have caught it.

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

The order is not negotiable — the enum step is what broke the $5.99 tier.

1. ~~**Read the amount from Stripe.**~~ **Done 2026-07-30.** Independent of everything else, correct on its own.
2. **Record and pay the coach's 80%** (§0b). Nothing below matters until this exists. Decide per-transaction vs monthly payout cycle first.
3. **`ALTER TYPE subscription_tier ADD VALUE 'custom'`**, deployed and verified in RDS, **before** any code references it. Migration `029_add_tracker_tier_enum.sql` exists because adding `tracker` without the enum value produced "charged but no subscription" — Stripe took the money, the insert threw, the webhook 500'd. Same trap, same shape. Postgres also won't let you use a new enum value in the same transaction that adds it.
4. `coach_prices` table + the two endpoints, with bounds enforced server-side, plus the rule that `tracker` is owner-only (§0).
5. Landing/Register de-pricing.
6. `pro` role + dashboard.

Each step is separately deployable and separately revertible.

---

## 5. Legal — two different risks, and the smaller one is HIPAA

**HIPAA is largely avoidable, and the current design already avoids it.** The tracker's existing "Summary for PT / Doctor" button (`WorkoutTracker` commits `df6a539`, `6875cda`, `738c8f4`) has exactly the right shape: the *client* generates the summary and the *client* sends it. The data is the individual's own record, shared at their direction. Individuals aren't covered entities, so that flow carries no HIPAA obligation for the platform.

That holds only as long as the arrow points one way. **The athlete shares out; professionals are invited viewers, never authors of clinical content.** The moment a physio or physician writes a diagnosis, clinical note, or treatment plan *into* the app about a patient, they're plausibly using it to handle PHI on their own behalf — which can make the platform a Business Associate, and that brings a signed BAA, encryption at rest and in transit, access audit logs, and breach notification. Make it a hard design rule now; it's cheap to hold and expensive to unwind.

**The referral fee is the larger exposure, and it isn't HIPAA at all.** A licensed provider taking a percentage tied to patients they send somewhere runs into anti-kickback and fee-splitting rules: the federal Anti-Kickback Statute and Stark Law where Medicare/Medicaid business is involved, and — more relevant here — **state fee-splitting statutes and PT/medical board ethics rules that often apply even to pure cash-pay arrangements**. This is state-specific; Wisconsin's rules are the ones that matter for you.

The good news is that **the safer structure is also the one that needs less code**: pay the pro for recruiting **trainers**, professional-to-professional, not for sending **patients**. That is precisely what `referred_by_id` already does — the pro's downline is trainers, and their commission is a percentage of a trainer's business, not a fee per patient delivered. Avoid any commission that keys on an individual patient the pro referred, avoid per-patient bonuses, and disclose the arrangement plainly to clients.

Worth one paid hour with a healthcare attorney in Wisconsin before launch — specifically on the referral fee, not on HIPAA. It's not a reason to delay building §1–§4.

---

## 6. Refunds and what the subscription actually promises

**The onboarding promise isn't a trick — it's true, so state it plainly.** The platform genuinely does contact every new subscriber: `send_subscription_email()` fires on checkout with their access code and assigned program. Writing "your subscription includes your program, full app access, and onboarding contact with your access code" is an accurate description of a service that already runs automatically. There's nothing to be uncomfortable about.

What causes refund demands is the *gap* between what a buyer thinks they bought and what arrives. So the protective move is not clever wording — it's saying explicitly what each tier does **and does not** include. If a $20 tier has no ongoing 1:1 contact, say that on the tier itself. A client who knew that up front rarely asks for money back; a client who assumed weekly check-ins always will. Being specific is what's actually "covered," and it reads as confident rather than evasive.

**A "no refunds" policy does not stop chargebacks.** Cardholders can dispute regardless of any term you write, and a Stripe dispute costs the disputed amount **plus a fee that you pay whether or not you win**. What actually wins disputes is evidence of delivery — and you already generate all of it: the signed waiver, the timestamped welcome email containing the access code, and login plus `workout_logs` timestamps proving the client used the product. Keep those retrievable per client; that's worth more than any policy sentence.

**The one-week free trial is the real fix.** Most refund requests come from people who paid before discovering the fit was wrong. A trial moves that decision to before the charge. Trial plus an obvious cancel path — the Stripe billing portal is already wired — is the standard, defensible setup, and it removes most of the pressure that made the waiver framing feel necessary.

**Refunds interact with coach payouts.** Under the monthly cycle, settle only commissions whose underlying invoice is paid and not refunded, and put a lag between the billing month and the payout run. Card disputes can arrive up to roughly 120 days out, so a lag can't eliminate the risk — but paying month N at the start of month N+1 catches the common early cancel-and-dispute case before the money has left. Never transfer against an invoice that has been refunded.
