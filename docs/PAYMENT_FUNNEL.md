# BSA Payment Funnel — Live MVP

End-to-end paid signup → first workout. Wired live on 2026-05-14.
Single $20 charge takes a stranger from `app.bestrongagain.com` to a
working tracker session with a real program loaded. No manual coach
intervention required between Stripe and the first set.

## Full flow

```
LANDING (TBD on app.bestrongagain.com)
    │
    ▼ "Get Started"
/register/GLENM7NUS?tier=basic
    │
    ▼ form submit
auth.py register
    • INSERT users (role=member, referred_by_id=GLEN)
    • auto_friend_admin (Tom-from-MySpace)
    • auto_accept_messaging_consent
    │
    ▼ auto-redirect (Register.jsx)
/api/stripe/checkout (POST, tier=basic)
    • creates Stripe Checkout Session
    • metadata: { user_id, coach_id, tier }
    • returns checkout_url
    │
    ▼ window.location.href = checkout_url
Stripe Hosted Checkout ($20/mo)
    │
    ▼ card submit → success
Stripe redirect → /dashboard?subscribed=true
    │
    ▼ webhook fires (asynchronous, ~1-2s)
POST /api/stripe/webhook  checkout.session.completed
    handle_checkout_completed():
      • INSERT subscriptions (tier=basic, status=active, $20)
      • UPDATE users SET stripe_customer_id = <cus_...>
      • UPDATE users SET active_kiosk_program_id = <program 7741 id>
        (only if not already assigned by a coach)
      • commission_engine.calculate_commissions + pay_commission
      • send_subscription_email
    │
    ▼ user lands on /dashboard
MemberDashboard.jsx
    • on mount → GET /api/auth/me
      → returns fresh user state + tier + active_access_code
    • renders Current Tier: basic (was stale "Free")
    • renders "Open Workout Tracker" with
      `?email=<email>&name=<first>&code=7741`
    │
    ▼ click button
tracker (bestrongagain.netlify.app)
    • reads email + code from URL
    • auto-calls /api/workout/load-program.php
    • backend lazily creates BSA chat user, auto-friends Glen, stamps
      messaging_consent_at, mints chat JWT, returns bsa_token/bsa_user
    • tracker stores bsa_token in localStorage (chat auto-login)
    │
    ▼ first-time-only screens (one each)
consent → questionnaire
    │
    ▼
Beginner Adult program — week 1, day 1
```

## Stripe configuration

### Live mode keys (deployed to `/opt/bestrongagain/.env`)

| Var | Source |
|---|---|
| `STRIPE_SECRET_KEY` | Stripe Dashboard → Developers → API keys → live secret |
| `STRIPE_PUBLISHABLE_KEY` | Same page, publishable key |
| `STRIPE_WEBHOOK_SECRET` | The endpoint's signing secret (see Webhook below) |
| `STRIPE_PRICE_BASIC` | Live product BSA Basic, $20/mo recurring |
| `STRIPE_PRICE_COACHED` | Live product BSA Coached, $200/mo recurring |
| `STRIPE_PRICE_ELITE` | Live product BSA Elite, $400/mo recurring |

### Live webhook destination

```
URL:    https://app.bestrongagain.com/api/stripe/webhook
Name:   BSA Platform Subscriptions
Events: checkout.session.completed
        invoice.payment_succeeded
        customer.subscription.deleted
Scope:  Your account (not Connected accounts)
```

### Account state

- `charges_enabled: true` (verified via `/v1/account`)
- `payouts_enabled: true`
- `business_profile.name: Polly Connect` ← same Stripe account as Polly
  product. **Add a per-charge `statement_descriptor` like `BSA*BASIC`**
  on the Checkout creation if you want bank statements to read as BSA
  instead of "Polly Connect". Cosmetic; doesn't affect functionality.

### Connect setup

Skipped intentionally. The platform-only flow (no Express accounts)
is what's live. When you onboard your second real coach, decide
between Express (matches existing code's commission engine) or
Standard (Stripe carries liability). Existing `/connect/onboard`
endpoint is wired for Express if needed.

## Database

### subscriptions (table already existed, now populated)

```
id                  UUID         PK
user_id             UUID         FK users
coach_id            UUID         FK users (the referring coach)
tier                TEXT         basic | coached | elite
status              TEXT         active | trialing | past_due | cancelled
stripe_subscription_id  TEXT     sub_...
stripe_price_id     TEXT         price_...
amount_cents        INTEGER      2000 | 20000 | 40000
current_period_start TIMESTAMPTZ
current_period_end   TIMESTAMPTZ
```

### users — relevant columns

- `stripe_customer_id` — stamped on webhook (was always NULL before)
- `active_kiosk_program_id` — stamped to program 7741 by webhook
  unless coach pre-assigned something else

There is NO `tier` column on users. Tier lives on `subscriptions`.
The dashboard joins both via the new `/auth/me` endpoint.

## /api/auth/me

GET, requires JWT. Returns:

```json
{
  "id":              "<uuid>",
  "email":           "...",
  "first_name":      "...",
  "last_name":       "...",
  "role":            "member|coach|admin",
  "referral_code":   "...",
  "stripe_customer": "cus_..." | null,
  "active_program_id":   "<uuid>" | null,
  "active_access_code":  "7741" | null,
  "active_program_name": "Beginner Adult" | null,
  "tier":                "basic" | "coached" | "elite" | null,
  "subscription_status": "active" | "trialing" | "past_due" | null
}
```

Implemented via a LEFT JOIN LATERAL on `subscriptions` for the most
recent non-cancelled row + LEFT JOIN on `workout_programs` for the
program's access code. Called by `MemberDashboard.jsx` on mount;
falls back to localStorage `user` if the call fails.

## Bug log — fixed today

| # | Symptom | Root cause | Fix |
|---|---|---|---|
| 1 | Webhook 500: `AttributeError: get` on StripeObject | Stripe's `StripeObject` doesn't support Python's `.get()` — call routes through `__getattr__("get")` which raises | Added `_md()` helper using bracket access + `"key" in obj` membership check |
| 2 | Webhook never fired in production | Live-mode webhook endpoint not registered in Stripe dashboard. Test-mode was set, live was not | Created `BSA Platform Subscriptions` destination in Live mode; copied signing secret into `.env` |
| 3 | MemberDashboard always showed "Free" tier | `MemberDashboard.jsx` read `user?.tier` but `users` table has no `tier` column. Tier lives on `subscriptions` | New `/auth/me` JOINs to `subscriptions`; dashboard calls it on mount |
| 4 | After payment, tracker prompted for access code | Webhook didn't assign a program to the new user | Webhook now sets `users.active_kiosk_program_id = <program 7741>` (Beginner Adult); dashboard passes `?code=7741` to tracker URL |
| 5 | Webhooks erroring on WordPress URL `bestrongagain.com/wp-json/bsa-wb/...` | Old WooCommerce webhook from a previous integration, doesn't handle these events | **Disable that destination** in Stripe Dashboard → Webhooks (not done yet — manual cleanup pending) |
| 6 | Stripe Connect "Marketplace" setup tempting at activation | The activation flow steers users into Connect even when not needed | Stayed out; activated regular account (charges_enabled=true). Connect can be re-enabled with proper Express config when second coach onboards |

## What's NOT done (next session)

### Highest priority — migrate the landing page

Move the marketing page from
`bestrongagain.com/workout-builder/` (WordPress + WooCommerce) to a
React route on **`app.bestrongagain.com`** so the entire funnel lives
in one stack we can iterate on.

The current WordPress flow:
- bestrongagain.com/workout-builder/ → "Get Started" → /checkout-page/ (WooCommerce, not Stripe)

The new flow we want:
- app.bestrongagain.com/ (Landing.jsx already exists) → CTA → /register/GLENM7NUS?tier=basic
  → Stripe Checkout → /dashboard?subscribed=true → tracker

Glen's design notes for the new landing:
- Look + feel similar to current `/dashboard` (the post-login member
  view) — same colors, same card style, same gradient.
- More seamless than the current WordPress page. Fewer clicks to a
  program.
- A direct path from "I'm interested" to "I'm working out" in <60s.

The existing `Landing.jsx` in this repo has the pricing copy and
"At-Home / The One Who Left / DIY / Serious Athlete" framing — that's
the content base. Polish the design + flow to match Glen's mental
model.

### Other open items

- Statement descriptor on Stripe Checkout so bank receipts read `BSA*BASIC` instead of "Polly Connect".
- Disable the legacy `bestrongagain.com/wp-json/bsa-wb/...` webhook destination — currently 400-erroring every event.
- Decide on the long-term WordPress fate. The `/workout-builder/` page has SEO content; either redirect → new landing, or keep as a content marketing piece with the CTA pointing at the new flow.
- Member-side "Share with a friend" (no commission) if you want a way for them to invite without the "earn" promise.
- Email-after-payment with the access code (currently the dashboard is the only place to find it).
- Coach onboarding flow for real coaches signing up to refer clients (Express account creation already wired at `/connect/onboard`; needs a UI).

## Smoke test recipe (current state)

```bash
# 1. Confirm Stripe account live + ready
curl -s https://api.stripe.com/v1/account -u sk_live_...:
# → charges_enabled: true, payouts_enabled: true

# 2. Confirm live prices wired
psql $DATABASE_URL -c "SELECT * FROM subscriptions WHERE status='active' ORDER BY current_period_start DESC LIMIT 3"

# 3. Run an actual payment in an incognito tab
open https://app.bestrongagain.com/register/GLENM7NUS?tier=basic
# Use real card, then refund in Stripe Dashboard → Payments

# 4. After payment, verify /me returns tier=basic
# (need JWT — easier: log into dashboard, see Current Tier card)
```

## Deploy

Backend:
```
scp backend/auth.py backend/stripe_routes.py ec2-user@3.19.135.182:/tmp/
ssh ec2-user@3.19.135.182 \
  "sudo mv /tmp/auth.py /opt/bestrongagain/auth.py && \
   sudo mv /tmp/stripe_routes.py /opt/bestrongagain/stripe_routes.py && \
   sudo systemctl restart bestrongagain.service"
```

Frontend:
```
npm run build
scp -r dist/* ec2-user@3.19.135.182:/tmp/coach-new/
ssh ec2-user@3.19.135.182 \
  "sudo rm -rf /var/www/bestrongagain/assets && \
   sudo cp -r /tmp/coach-new/* /var/www/bestrongagain/"
```
