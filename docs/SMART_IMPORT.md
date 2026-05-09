# Smart Import — paste-any-workout → structured program

A coach pastes raw text from anywhere (GPT response, magazine page, PDF screenshot summary, scribbles) into the workoutbuilder. The platform's `parse-import` endpoint hands the text to Claude with the BSA exercise manifest and returns a structured block list that drops straight into `useWorkoutState`. The coach refines from there.

Lowers new-coach activation cost from ~30 minutes of clicking to ~30 seconds of pasting. The 1872-exercise manifest is the moat — Claude maps semantically, but every name resolves back to a real library entry with a Cloudflare Stream video.

---

## Endpoint

`POST /api/workout/parse-import`

### Request body
```json
{
  "raw_text": "string (≤ 20000 chars, required)",
  "mode": "single | multi-day | expand   (default: single)",
  "expand_to_days": 2-7 (only used when mode=expand),
  "split_style": "auto | ppl | upper-lower | body-part   (only used when mode=expand)",
  "current_maxes": { "bench": 300, "squat": 405, ... }   // optional, lets the LLM sanity-check percentages
}
```

### Response
```json
{
  "success": true,
  "mode": "single | multi-day | expand",
  "days": [
    { "name": "Day 1 - Push", "blocks": [ ...block objects... ] },
    { "name": "Day 2 - Pull", "blocks": [ ... ] }
  ],
  "blocks": [...],          // legacy field — same as days[0].blocks
  "unmapped": [
    { "user_text": "Cable Row", "guesses": ["Seated Bar Row", "V-Bar Squat Row"] }
  ],
  "warnings": ["...free-text notes from the parser..."],
  "tokens_used": { "input": 18534, "output": 2468 }
}
```

### Errors
| Status | Body                                              | Cause                                  |
|--------|---------------------------------------------------|-----------------------------------------|
| 400    | `raw_text required`                               | Missing input                           |
| 400    | `raw_text too long (20000 char limit)`            | Over the cap                            |
| 400    | `mode must be one of [...]`                       | Bad `mode` value                        |
| 400    | `split_style must be one of [...]`                | Bad `split_style` value                 |
| 502    | `LLM call failed: <Claude error body>`            | Anthropic API problem                   |
| 500    | `Could not parse LLM response as JSON`            | Claude returned non-JSON (rare)         |

---

## Three modes

### `single` (default)
Text describes one workout day. Returns exactly one entry in `days`. The frontend drops the blocks into the current day in `useWorkoutState`.

### `multi-day`
Text describes 2+ days separated by headers like `Day 1 / Day 2 / Monday / Tuesday / Push Day / Pull Day`. The model splits on those headers and returns one entry per day. The frontend distributes them into successive day slots starting at `(currentWeek, currentDay)`.

### `expand`
Text describes ONE template day. The model uses it as Day 1 and **designs** additional complementary days to fill `expand_to_days` total. The split style controls the design pattern:

| `split_style`   | Pattern                                                                |
|-----------------|------------------------------------------------------------------------|
| `auto`          | Read the template, infer the program type, design accordingly          |
| `ppl`           | Push → Pull → Legs → Push → Pull → Legs → Rest                         |
| `upper-lower`   | Upper → Lower → Upper → Lower → Upper → Lower → Rest                   |
| `body-part`     | Chest → Back → Legs → Shoulders → Arms → Conditioning (truncated to N) |

Each generated day mirrors the template's intensity / equipment vibe / format with its own warmup → main work → cooldown structure.

---

## Block markers the prompt teaches coaches to use

```
STRAIGHT SET: Bench 5x5 @75%

SUPERSET:
A1) Incline DB Press 4x10
A2) Cable Row 4x12

TRISET:
B1) Lateral Raise 3x15
B2) DB Curl 3x12
B3) Tricep Pushdown 3x12

CIRCUIT / METCON / CHIPPER / AMRAP:
12 min AMRAP
- 10 burpees
- 15 KB swings

WARMUP / COOLDOWN / MOBILITY → use these for non-strength blocks
```

If markers are absent, the model infers from formatting (lettered exercises like A1/A2 → superset, time-capped block → conditioning/circuit, isolated exercise → straight-set).

Block types the model can emit (must match the workoutbuilder's `BlockTypeSelector` keys exactly):

`theme · warmup · mobility · movement · straight-set · superset · triset · circuit · conditioning · cooldown`

For `circuit` blocks, `circuitType` is also set when applicable: `AMRAP | EMOM | Tabata | For Time | Chipper`.

---

## Exercise mapping rules (in the system prompt)

1. Every exercise name must match a row in `backend/data/exercise_manifest.json` exactly. If the user typed "Goblet Squat" and the library has "Dumbbell Goblet Squat", the model returns the library version.
2. If no confident match exists, the model leaves the user's wording in `name` AND adds a row to top-level `unmapped` with library guesses for the coach to pick from.
3. **baseMax inference:** Bench → `bench`, any Squat → `squat`, Deadlift/RDL/Hinge → `deadlift`, Power Clean/Olympic/Snatch → `powerClean`, bodyweight movements (push-ups, pull-ups, lunges) → `bodyweight`, anything else → `manual`.
4. **Percentages:** "@70%" → `percentage: 70, manualWeight: null`. "@185 lbs" → `percentage: null, manualWeight: 185`. Reps only → both null.
5. **Sets:** "4x10 @70%" expands into 4 set objects each `{ reps: 10, percentage: 70, manualWeight: null, isWarmup: false }`. "5/5/3/3/1" → 5 sets with those reps.
6. **Cardio / time-capped moves:** Use `duration` + `durationUnit` instead of reps. e.g. "Plank 30 sec" → `{ duration: "30", durationUnit: "sec" }` and empty sets array.

---

## Backend mechanics

**Module:** `backend/workout_parser.py`
**Blueprint:** `parser_bp` registered at `/api/workout` in `backend/app.py`
**Model:** `claude-sonnet-4-5`
**LLM call:** direct REST via `requests` (no `anthropic` SDK dependency). API key in `/opt/bestrongagain/.env` as `ANTHROPIC_API_KEY` (same key as bsa-chatbot).
**Manifest cache:** `backend/data/exercise_manifest.json` is loaded once into module-level dicts on first request:
- `_EXERCISE_INDEX`: `lower(name) → manifest row`
- `_NAMES_BY_CATEGORY`: `category → [names...]`

**`max_tokens` budget:**
- `single`: 8000 (≈ 18.5k input + 2.5k output)
- `multi-day`/`expand`: 16000 (≈ 18.5k input + 7.5k output)

**Cost per parse (Sonnet 4.5):** ~$0.10 single, ~$0.30 multi-day.

**Enrichment after Claude returns:** every block gets default fields filled in (`notes`, `rounds`, `collapsed`, etc) and every exercise is re-resolved against the manifest. When a confident match exists, the canonical name is substituted, the Cloudflare Stream `youtube` URL is attached, and `matched: true` is set. Otherwise `matched: false` and the UI flags it yellow.

---

## Required infrastructure

Multi-day Claude calls take 30–60 seconds. Two timeouts had to be raised on EC2:

```
# /etc/systemd/system/bestrongagain.service
ExecStart=/opt/bestrongagain/venv/bin/gunicorn -w 2 -t 300 -b 127.0.0.1:5000 app:app
                                                       ^^^^

# /etc/nginx/conf.d/bestrongagain.conf — inside `location /api/`
proxy_read_timeout 300;
proxy_send_timeout 300;
proxy_connect_timeout 60;
```

Default gunicorn worker timeout is 30s and default nginx proxy_read_timeout is 60s — both kill multi-day requests before Claude responds.

---

## Health endpoint

`GET /api/workout/parse-import/health` (unauthenticated)

Returns `{ ok, exercises_loaded, categories: [...], anthropic_key_set }`. Useful for verifying the manifest loaded and the API key is wired after a deploy.

---

## Related docs

- **[`workoutbuilder/docs/SMART_IMPORT_UI.md`](../../workoutbuilder/docs/SMART_IMPORT_UI.md)** — frontend modal, mode picker, day-tab preview, and the `useWorkoutState.importBlocks` / `importMultiDay` hook actions that consume the response from this endpoint.
- **[`./GYM_ENTITY.md`](./GYM_ENTITY.md)** — the gym entity affects who owns the imported program (and therefore which coach voice the WorkoutTracker chatbot picks when a client loads it).
- **[`workouttracker/docs/CHATBOT_VOICE_AND_FREE_STARTER.md`](../../workouttracker/docs/CHATBOT_VOICE_AND_FREE_STARTER.md)** — explains how `coachConfig` is resolved on program load, which is the next step in the chain after a coach saves a Smart-Imported program.
- **[`./ARCHITECTURE.md`](./ARCHITECTURE.md)** — full BSA ecosystem map (which repo talks to which API).
