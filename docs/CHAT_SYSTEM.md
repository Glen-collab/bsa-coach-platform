# BSA FriendChat / Messaging System

Member-to-member DMs inside the workout tracker, with coach broadcasts
to a tribe. Built around three goals Glen named explicitly:

1. **Feels like Instagram / Facebook DMs** — message-board inbox sorted
   by recent activity, blue bubbles for sent, gray for received,
   typeahead search to find people, request → accept flow.
2. **No second sign-in** — if a client signed up for the program,
   they're trusted enough to chat. The tracker auto-issues their JWT
   on load-program; the chat skips its email-magic-link gate.
3. **"Tom from MySpace"** — every new BSA signup lands already
   friended to Glen (admin) with messaging consent stamped, so the
   first chat-open shows their coach at the top of the inbox.

## Where things live

| Layer | Repo / file | What it does |
|---|---|---|
| Auth helpers | `bsa-coach-platform/backend/auth.py` | `register` + magic-link both call `auto_friend_admin` + `auto_accept_messaging_consent` so the new row lands "Tom-ready" |
| Auto-JWT on program load | `bsa-coach-platform/backend/workout_api.py` `load_program` | Looks up / lazy-creates a `users` row keyed by the tracker email, friends Glen, stamps consent, mints a JWT, ships `bsa_token` + `bsa_user` in the response |
| Friends API | `bsa-coach-platform/backend/social.py` | `/friends/search-by-name` typeahead, `/friends/list` with last-message preview + dedupe via `DISTINCT ON`, `/friends/respond` accept/decline, `/friends/exit-game-mode` (kiosk path, separate doc) |
| Messages API | `bsa-coach-platform/backend/social.py` | `/messages/send`, `/messages/thread/<friend_id>`, `/messages/unread-count` (now totals unread DMs + pending requests), `/messages/mark-read` |
| Broadcast | `bsa-coach-platform/backend/social.py` `broadcast_send` | Coach blast — one INSERT into `user_messages` per recipient, `is_broadcast=true`. One direction of friendship row inserted (was both, fixed 2026-05-14) |
| Tracker UI | `WorkoutTracker/src/components/social/FriendChat.jsx` | The chat bubble, the message board, the + Find modal, the thread view |
| Auth bridge | `WorkoutTracker/src/App.jsx` | Writes the auto-issued `bsa_token` + `bsa_user` to localStorage on every `loadProgram`, fires a `bsa-auth-changed` event so FriendChat rehydrates without a remount |

## Data flow — typical session

```
Client opens tracker with email + access code
   │
   ▼
POST /api/workout/load-program.php  (workout_api.py)
   • finds / lazily creates the users row keyed by email
   • auto_friend_admin(cur, user_id)         [Tom]
   • auto_accept_messaging_consent(cur, user_id)
   • mints JWT, returns bsa_token + bsa_user
   │
   ▼
App.jsx writes localStorage.bsa_token + bsa_user
   dispatches window 'bsa-auth-changed'
   │
   ▼
FriendChat.jsx rehydrates `me`, hasToken flips true
   │
   ▼
Chat bubble visible with red-dot badge
   = unread DMs + pending requests
   │
   ▼  (user taps bubble)
GET /social/consent/status  (already accepted via auto-consent)
GET /social/friends/list
   • returns DISTINCT-ON friends each with:
       unread count
       last_message: { preview, sent_at, from_me, is_broadcast }
   • sorted by most recent message (alphabetical for the rest)
   │
   ▼
Conversation list paints — Instagram-style
   each row: avatar, name, last preview, relative time, unread chip
   ↑ "as Glen Rogers" subtitle in the header tells the user which
     account they're chatting from (separate identity from tracker)
```

## Auth strategy

Two identity systems exist side-by-side:

- **Tracker** — email + access code. Stateless. Used by `load-program`,
  `log-workout`, anything that doesn't need stable identity.
- **Chat** — JWT. Stable `users.id`. Required for friendships and
  message ownership.

The chat used to require its own email magic-link sign-in. As of
2026-05-14, `load-program` mints a JWT for free during the program
load and the tracker stashes it in `localStorage.bsa_token`. The
magic-link signup screen is dead code in normal flow — it still
exists as fallback if someone visits the chat with no tracker session
behind it, but no one hits it in practice.

## "Tom from MySpace" — implementation

`auto_friend_admin(cur, new_user_id)` (in `auth.py`):

```python
SELECT id FROM users WHERE LOWER(email) = LOWER(TRAINER_EMAIL) LIMIT 1
↓
INSERT INTO user_friendships (requester_id, recipient_id, status, accepted_at)
VALUES (admin_id, new_user_id, 'accepted', NOW())
ON CONFLICT (requester_id, recipient_id) DO NOTHING
```

Called from:
- `auth.py` `register` (password flow)
- `auth.py` `magic-link` (email-only flow)
- `workout_api.py` `load_program` (the live path most users hit)

`auto_accept_messaging_consent(cur, user_id)`:

```sql
UPDATE users
SET messaging_consent_at = COALESCE(messaging_consent_at, NOW())
WHERE id = %s
```

Run alongside the friendship insert. The "One last thing — A coach
may read your chats" disclosure screen is now bypassed by default
(Glen wanted it gone — disclosure language is moved into the welcome
email and ToS).

## Conversation-list query

`/friends/list` returns each friend with their most recent message,
in DESC time order:

```sql
-- 1. accepted friends, dedupe via DISTINCT ON in case both directions exist
SELECT DISTINCT ON (u.id)
       f.id AS friendship_id, f.status, f.accepted_at,
       u.id, u.first_name, u.last_name, u.email
FROM user_friendships f
JOIN users u ON u.id = CASE
    WHEN f.requester_id = %s THEN f.recipient_id
    ELSE f.requester_id
END
WHERE (f.requester_id = %s OR f.recipient_id = %s)
  AND f.status = 'accepted'
ORDER BY u.id, f.accepted_at NULLS LAST

-- 2. last_message preview per friend
SELECT DISTINCT ON (other_id)
       other_id, body, sent_at,
       from_user_id = %s AS from_me,
       is_broadcast
FROM (
    SELECT
        CASE WHEN from_user_id = %s THEN to_user_id ELSE from_user_id END AS other_id,
        body, sent_at, from_user_id, is_broadcast
    FROM user_messages
    WHERE (from_user_id = %s AND to_user_id = ANY(friend_ids))
       OR (to_user_id   = %s AND from_user_id = ANY(friend_ids))
) sub
ORDER BY other_id, sent_at DESC
```

Client-side render rules (`FriendChat.jsx`):

- `from_me: true` → preview prefixed with **"You: "**
- `is_broadcast: true` (received) → preview prefixed with **"Coach: "**
- otherwise → bare preview

## UI rules

| State | Treatment |
|---|---|
| Chat bubble badge | Total of unread DMs + pending friend requests (`/messages/unread-count` returns `{ unread, pending_requests, total }`) |
| Header subtitle | `as <displayName(me)>` — chat identity is separate from tracker, this surfaces which inbox the user is looking at |
| Sent message bubble | `linear-gradient(135deg, #0a84ff, #0066cc)` iMessage blue |
| Received DM bubble | `#f0f0f0` light gray |
| Received broadcast | Same gray bubble + **📣 Coach** badge above |
| + Find modal | Overlays the conversation list (absolute-positioned inside the panel), back-arrow returns with state intact |
| Body scroll | `document.body.style.overflow = 'hidden'` while panel open — stops iOS bleeding touch events into the workout page underneath |
| Friends-loaded "flash" | `friends` state starts at `null` instead of `[]`; "Loading..." renders until the list resolves so "No friends yet" never flashes |
| Consent flash | `consented` is tri-state (`null | false | true`); the consent screen only renders after the status fetch confirms `false` |

## Search

`/friends/search-by-name?q=…`:

- Min 2 chars
- LIKE %q% on `first_name` OR `last_name` (case-insensitive)
- LIMIT 10
- Scope: any user with `role IN ('member','coach','admin')` — no
  same-coach restriction (Glen's call: full Facebook-style cross-
  network search)
- LEFT JOINs `user_friendships` so each match carries its current
  state relative to the caller, used to render the right button:

| friendship_status | button shown |
|---|---|
| `accepted` | **Friends** (disabled) |
| `pending`, requester=me | **Requested** (disabled) |
| `pending`, recipient=me | **Accept** (calls `/friends/respond`) |
| `blocked` | **Blocked** (disabled) |
| _no row_ | **Add** (calls `/friends/request`) |

The search box also filters the conversation list client-side as a
secondary use — same query, two effects.

## displayName helper

Tracker signups via load-program produce rows where `first_name` is
the email's local part if the user_name field was empty. The
`displayName(user)` helper on the client capitalizes pieces and
falls back gracefully:

```js
displayName({first_name: 'carterctomich', last_name: ''})
  → 'Carterctomich'

displayName({first_name: 'Casey', last_name: 'Sodolski'})
  → 'Casey Sodolski'

displayName({first_name: '', last_name: '', email: 'foo@bar.com'})
  → 'Foo'
```

Used everywhere a person's name is rendered (conversation rows,
search results, thread header).

## Backfills (one-shot SQL run 2026-05-14)

Three jobs ran against production to bring the existing roster up to
date — all idempotent / safe to re-run:

1. **41 BSA accounts** auto-created from `workout_user_position`
   entries that had no matching `users` row. First/last names derived
   from the latest non-"User" `user_name` per email; fallback to the
   email's local part. Each gets auto-friended with Glen + consent
   stamped.
2. **Pair-direction duplicate friendships** deleted — broadcasts used
   to insert both `(me, rid)` and `(rid, me)`, leaving every friend
   showing twice in the inbox.
3. **Messaging consent** stamped for any pre-2026-05-14 user that
   still had `messaging_consent_at IS NULL`.
4. **Name cleanup** — 11 placeholder names + 5 "User" rows corrected
   manually from Glen's input.
5. **Duplicate accounts** deleted (scott22allen, nolan.mcintyre32,
   wisconsinbarbell) — kept the active-workout email per pair.

Final BSA user count after cleanup: **43**.

## Known caveats

- The fallback email magic-link sign-in screen is dead in the normal
  flow but lives in `FriendChat.jsx`. If we ever want a true Sign Out
  + Sign In As Someone Else flow it's already there.
- Tracker users who load programs from the same browser as Glen (e.g.
  Glen testing a client's program) keep Glen's chat JWT until the
  next load-program. That's correct — Glen's identity is whatever
  tracker email was last loaded.
- Coaches other than Glen DO exist in the schema (`role = 'coach'`).
  None of the auto-friend / broadcast logic special-cases them
  beyond the role check in `broadcast_send`. If a second coach ever
  wants their clients auto-friended TO them, the helper would need
  to accept a coach-id arg.
- `displayName` capitalization is per-word; "macIntyre" would render
  "Macintyre". Cosmetic.

## Quick test recipes

### Verify load-program ships a token

```bash
curl -s -X POST https://app.bestrongagain.com/api/workout/load-program.php \
  -H 'Content-Type: application/json' \
  -d '{"email":"<tracker_email>","code":"<access_code>"}' \
  | python3 -c 'import sys,json; d=json.load(sys.stdin); print("token:", bool(d["data"].get("bsa_token")))'
```

### See the friend list a given email gets

```bash
# Get the token from load-program first, then:
curl -s https://app.bestrongagain.com/api/social/friends/list \
  -H "Authorization: Bearer $TOKEN" \
  | python3 -m json.tool
```

### Search-by-name from CLI

```bash
curl -s "https://app.bestrongagain.com/api/social/friends/search-by-name?q=Jayce" \
  -H "Authorization: Bearer $TOKEN" \
  | python3 -m json.tool
```
