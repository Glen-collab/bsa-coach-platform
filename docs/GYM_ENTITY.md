# Multi-Coach Gym Entity

When two (or more) coaches own the same gym (e.g. "Legends Gym" with Ashley + Logan), they need:

1. A **shared video library** — Ashley films half the exercises, Logan films the other half, and ALL their clients see the pooled set
2. **Business continuity** — if a partner quits or dies, every client + program transfers to the surviving coach in one click without losing access codes or workout history

The gym entity solves both.

---

## Schema

`migrations/014_gyms.sql`

```sql
CREATE TABLE gyms (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name        TEXT NOT NULL,
  owner_id    UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE users ADD COLUMN gym_id UUID REFERENCES gyms(id) ON DELETE SET NULL;

CREATE INDEX idx_users_gym_id ON users (gym_id) WHERE gym_id IS NOT NULL;
```

A coach with `users.gym_id = NULL` is solo (Glen, default state for new coaches). Two coaches sharing the same `gym_id` are gym partners.

---

## Pooled video library

`/api/media/tracker-overrides` (in `backend/media.py`) is what the WorkoutTracker calls to find which exercise videos to swap in. It now layers by gym instead of just by single coach.

**Layering order** (later layers overwrite earlier ones for the same exercise name):

1. **Featured globals** — Glen's curated videos (`trainer_media.featured_global = TRUE`). The fallback for exercises nobody at the gym has filmed.
2. **All gym partners' uploads** — every other coach in the same gym as the client's primary coach. Their videos get pooled in.
3. **The client's primary coach** — wins on conflicts within the gym.
4. **The viewer's own uploads** — only relevant when a coach/admin is using the tracker themselves; their own library wins absolutely.

This means: at Legends Gym, Ashley films Bench Press → her clients see Ashley's video. Logan films Squat → BOTH Ashley's clients AND Logan's clients see Logan's squat video (because they share `gym_id`). Featured globals fill in any gaps.

**Response includes** `has_gym` and `gym_partner_count` for debugging.

---

## Admin endpoints

All require admin role. No frontend UI was built — manage via `curl` or psql.

| Endpoint                                                          | Purpose                                              |
|-------------------------------------------------------------------|------------------------------------------------------|
| `GET    /api/admin/gyms`                                          | List gyms with coach counts                          |
| `POST   /api/admin/gyms` `{name, owner_id?}`                      | Create gym; if `owner_id` given, also sets that coach's `gym_id` |
| `GET    /api/admin/gyms/<gym_id>/coaches`                         | List coaches in a gym                                |
| `POST   /api/admin/gyms/<gym_id>/coaches` `{coach_id}`            | Add an existing coach (updates their `users.gym_id`) |
| `DELETE /api/admin/gyms/<gym_id>/coaches/<coach_id>`              | Remove a coach (sets their `gym_id` back to NULL)    |
| `POST   /api/admin/coaches/<from_id>/transfer-to/<to_id>`         | **The "partner quit/died" button** — see below       |

---

## Coach transfer (business continuity)

`POST /api/admin/coaches/<from_coach_id>/transfer-to/<to_coach_id>`

Bulk reassigns every client + program from one coach to another in a single transaction:

- `users.referred_by_id` flips from `<from>` to `<to>` (clients move)
- `workout_programs.created_by` flips (handles BOTH the UUID form AND the historical email form via `_resolve_coach_uuid` semantics)

**What's preserved:**
- Access codes (clients don't have to re-log in)
- Workout history (`workout_logs`, `workout_user_position`)
- Program IDs (URLs and any external references still work)

**What changes from the client's perspective:**
- Next time they load their program, the `coachId` in the response now points to the new coach
- The chatbot's `coachConfig` lookup picks up the new coach's voice → tracker chatbot signs as the new coach
- AI Summary on the trainer dashboard signs as the new coach

**Response:**
```json
{
  "success": true,
  "clients_moved": 12,
  "programs_moved": 18,
  "from_email": "ashley@legendsgym.com",
  "to_email": "logan@legendsgym.com"
}
```

---

## Edge cases / known gaps

- **No gym pool for programs.** Programs stay per-coach. If gym partners want to share a program library too, they'd need either the existing template-library system (admin pre-clones) or a separate `is_gym_template` flag (not built yet).
- **Featured globals never get demoted.** Glen's library always sits underneath the gym pool as a fallback.
- **Coach transfer is one-way and bulk.** No per-client transfer UI exists — that would require selecting individual clients. SQL is the escape hatch if a partial move is ever needed.

---

## Memory hook

Project memory entry: `project_coach_platform.md` includes the gym entity in the platform overview. The transfer endpoint is the answer to Glen's "if someone dies or quits, how can we only have one person then?" question.
