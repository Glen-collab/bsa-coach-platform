# Video Use Waiver + Coach Exercise Proposals

Two small features layered on top of the video override system (see `VIDEO_OVERRIDE_SYSTEM.md`).

## Video Use Waiver

**What it does:** Blocks any coach from uploading a video until they've accepted a one-time legal waiver granting Be Strong Again a perpetual, worldwide, royalty-free, sublicensable license to use their content across the platform.

### Data model

Migration `002_video_waiver.sql` adds two columns to `users`:

```sql
video_waiver_accepted_at  TIMESTAMPTZ,
video_waiver_version      TEXT
```

### Version bumping

`VIDEO_WAIVER_VERSION` is a string constant in `backend/media.py` (currently `2026-04-18-v1`). If material terms change, bump the version — any user whose `video_waiver_version` doesn't match will be re-prompted on next upload.

### Enforcement

- **Frontend:** `MediaLibrary.jsx` fetches `/api/media/waiver/status` on mount. If not accepted, shows a yellow banner + blocks uploads. First drop attempt opens `VideoWaiverModal`.
- **Backend:** `/api/media/upload-url` returns `403 { code: "waiver_required" }` if the user hasn't accepted. Defense in depth — a client that bypasses the modal still can't upload.

### Endpoints

- `GET /api/media/waiver/status` → `{ accepted, accepted_at, accepted_version, current_version }`
- `POST /api/media/waiver/accept` → records acceptance + returns new status

### Waiver Terms Summary

- Perpetual, worldwide, royalty-free, sublicensable license to BSA/Glen
- Covers: tracker, dashboard, marketing, social, training programs, derivative products
- Coach retains ownership, warrants they have rights to the content
- Coach can remove individual videos (`status='removed'`) but license to already-produced derivatives survives
- BSA can flag/remove at discretion
- Governed by State of Wisconsin law

Full text is in `src/components/VideoWaiverModal.jsx`.

---

## Coach Exercise Proposals

**What it does:** Lets coaches propose exercises not in the bundled JS libraries (`exerciseLibrary`, `martialArtsLibrary`, `mobilityExercises`, `warmupExercises`). Admin reviews and approves; approved exercises show up in every coach's Media Library with a "community" badge and can be uploaded against like any bundled exercise.

### Data model

Migration `003_custom_exercises.sql`:

```sql
CREATE TABLE custom_exercises (
  id                  SERIAL PRIMARY KEY,
  proposed_by_user_id UUID NOT NULL REFERENCES users(id) ON DELETE SET NULL,
  name                TEXT NOT NULL,
  category            TEXT,
  subcategory         TEXT,
  source_library      TEXT NOT NULL DEFAULT 'custom',
  description         TEXT,
  status              TEXT NOT NULL DEFAULT 'pending'
                        CHECK (status IN ('pending','approved','rejected','removed')),
  admin_notes         TEXT,
  approved_by_user_id UUID REFERENCES users(id),
  approved_at         TIMESTAMPTZ,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

Partial unique index on `(LOWER(name), source_library) WHERE status IN ('pending','approved')` — blocks duplicate active proposals but allows re-proposing a previously rejected/removed name.

### Flow

1. Coach in MediaLibrary clicks **"+ Propose Exercise"** → opens `ProposeExerciseModal` → submits (name, library, category, notes) → row created with `status='pending'`
2. Admin opens Admin Dashboard → **"Exercise Requests"** tab (tab label includes pending count) → sees proposal with coach name + notes → **Approve** or **Reject**
3. On approve → `status='approved'`, `approved_by_user_id + approved_at` set
4. MediaLibrary on all coaches' machines calls `/api/media/custom-exercises/approved` → merges approved rows into the browseable list with a blue "community" badge
5. Coaches can now drag videos onto the new exercise like any bundled one

### Endpoints

| Endpoint | Auth | Purpose |
|---|---|---|
| `POST /api/media/custom-exercises` | user | Coach proposes |
| `GET /api/media/custom-exercises/approved` | public | List approved (for MediaLibrary merge) |
| `GET /api/media/custom-exercises/mine` | user | Coach's own proposals w/ status |
| `GET /api/media/admin/custom-exercises?status=pending` | admin | Admin feed |
| `POST /api/media/admin/custom-exercises/decide` | admin | Approve/reject/remove/re-open |

### Status transitions

- `pending` → Approve → `approved`
- `pending` → Reject → `rejected`
- `approved` → Remove → `removed` (hides from coaches' libraries)
- `rejected` / `removed` → Re-open → `pending`

### Why merge on the client?

The bundled manifest (1872 exercises) is static and ships with the app. Approved custom exercises are dynamic per-tenant. Merging client-side avoids a backend round trip for the main list and lets the approved set update without redeploying.

---

## Related files

- `migrations/002_video_waiver.sql` + `003_custom_exercises.sql`
- `backend/media.py` — all endpoints
- `src/components/VideoWaiverModal.jsx` — waiver UI
- `src/components/ProposeExerciseModal.jsx` — proposal form
- `src/pages/MediaLibrary.jsx` — coach UI wiring both features
- `src/pages/AdminDashboard.jsx` — admin "Exercise Requests" tab
- `src/utils/api.jsx` — client methods
