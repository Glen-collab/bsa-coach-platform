# Media API Reference

All endpoints live under `/api/media/*` on the coach platform Flask backend (EC2, blueprint registered in `app.py`).

Base URL: `https://app.bestrongagain.com/api/media/`

Authentication: most endpoints require a JWT in `Authorization: Bearer <token>` (from `/api/auth/login`). Admin endpoints additionally require `role == 'admin'` on the JWT. The **`tracker-overrides`** endpoint is intentionally unauthenticated because the workouttracker uses access codes, not JWT.

---

## POST /upload-url

Mint a one-time Cloudflare Direct Creator Upload URL. The browser uploads bytes directly to Cloudflare using this URL; the Cloudflare API token never leaves the server.

**Auth:** required (any role)

**Request:**
```json
{ "media_type": "video", "max_duration_seconds": 600 }
```

**Response:**
```json
{
  "uploadURL": "https://upload.cloudflarestream.com/<token>",
  "uid": "1b7e2472bca69e2dc2a2fc2702467a41"
}
```

Browser PUT the file to `uploadURL`, then call `/register` with `uid`.

---

## POST /register

Record a completed upload in `trainer_media`. Upserts via `UNIQUE (trainer_id, exercise_name, media_type)` — a re-upload replaces the previous one.

**Auth:** required (any role)

**Request:**
```json
{
  "exercise_name": "Lat Pulldown",
  "category": "Back",
  "source_library": "exerciseLibrary",
  "media_type": "video",
  "cloudflare_uid": "128a30afb5d866ae963c114af07ca093",
  "duration_seconds": 42
}
```

**Response:**
```json
{
  "success": true,
  "media": { "id": 2, "exercise_name": "Lat Pulldown", "status": "live", ... }
}
```

---

## GET /my-uploads

Returns the authenticated user's own uploads (status ≠ removed).

**Auth:** required

**Response:**
```json
{ "count": 2, "uploads": [ { ... }, { ... } ] }
```

---

## POST /delete

Soft-delete (status = 'removed'). The row stays in the DB for audit.

**Auth:** required

**Request:**
```json
{ "exercise_name": "Lat Pulldown", "media_type": "video" }
```

---

## POST /tracker-overrides (public)

Returns the merged video-override map for a given user email. Called by the workouttracker on program load.

**Auth:** NONE (tracker has no JWT)

**Request:**
```json
{ "email": "wsphillips728@gmail.com" }
```

**Response:**
```json
{
  "count": 1,
  "has_coach": true,
  "user_has_own_uploads": false,
  "overrides": {
    "Lat Pulldown": "https://iframe.videodelivery.net/128a30afb5d866ae963c114af07ca093"
  }
}
```

**Priority ordering** (highest wins):
1. User's own uploads (if viewer is themselves a coach/admin)
2. User's coach's uploads (via `users.referred_by_id`)
3. `featured_global` uploads (platform-wide overrides)

If the email isn't found in `users`, only `featured_global` overrides are returned. Anonymous trial codes never match.

---

## GET /admin/all

Admin feed listing every coach upload across the platform.

**Auth:** required + `role == 'admin'`

**Query params:** `?status=live|flagged|removed` (optional), `?coach=<uuid>` (optional)

**Response:**
```json
{
  "count": 5,
  "uploads": [
    {
      "id": 2,
      "trainer_id": "53702390-…",
      "first_name": "Glen", "last_name": "Rogers", "email": "…",
      "exercise_name": "Lat Pulldown",
      "source_library": "exerciseLibrary",
      "media_type": "video",
      "cloudflare_uid": "128a30af…",
      "status": "live",
      "featured_global": false,
      "uploaded_at": "2026-04-18T…"
    }
  ]
}
```

---

## POST /admin/feature

Toggle `featured_global` on a row (promote/unpromote a coach upload to platform-wide visibility).

**Auth:** admin

**Request:** `{ "id": 2, "featured_global": true }`

---

## POST /admin/flag

Set status to `live | flagged | removed`.

**Auth:** admin

**Request:** `{ "id": 2, "status": "flagged" }`

---

## GET /admin/cloudflare-list

Proxies Cloudflare Stream's list API to let admin browse every video in the Cloudflare Stream account (not just the ones tracked in `trainer_media`). Useful for auditing what was uploaded outside the coach UI.

**Auth:** admin

**Query params:** `?search=<name>` (Cloudflare-side search), `?limit=200`

**Response:**
```json
{
  "count": 200,
  "videos": [
    {
      "uid": "128a30af…",
      "name": "Lat Pulldown",
      "thumbnail": "https://cloudflarestream.com/…/thumbnails/…",
      "duration": 42,
      "size": 8523921,
      "status_state": "ready",
      "created": "2026-04-18T…",
      "preview": "https://cloudflarestream.com/…/watch",
      "watch_url": "https://watch.cloudflarestream.com/128a30af…"
    }
  ]
}
```

---

## Error Shape

All endpoints return the standard Flask JSON error shape on failure:
```json
{ "error": "Authentication required" }
```
with HTTP status codes: 400 (bad input), 401 (no JWT), 403 (wrong role), 404 (not found), 500 (server error), 502 (Cloudflare upstream failure).
