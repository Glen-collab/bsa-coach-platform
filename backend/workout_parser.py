"""
workout_parser.py — "Smart Import" for the workout builder.

Coach pastes raw text (from GPT, magazine, Instagram, napkin OCR, etc.) into
a textarea and we hand it to Claude with the full BSA exercise manifest.
Claude returns a structured program block list that drops straight into
useWorkoutState in the React builder. The coach refines from there.

Block markers the prompt teaches coaches to use:
  STRAIGHT SET, SUPERSET, TRISET, CIRCUIT, METCON, CHIPPER, AMRAP, EMOM,
  WARMUP, COOLDOWN, MOBILITY, THEME / NOTES

If markers are absent, the model infers from formatting (A1/A2 → superset,
a 12-min AMRAP block → conditioning/circuit, etc).

Endpoint:
  POST /api/workout/parse-import
  Body: { "raw_text": "...", "current_maxes": { "bench": 300, ... }? }
  Returns: { "success": true, "blocks": [...], "unmapped": [...],
             "warnings": [...], "tokens_used": {...} }
"""

import os
import json
import re
import requests
from flask import Blueprint, request, jsonify

parser_bp = Blueprint("workout_parser", __name__)

# ── Manifest cache ────────────────────────────────────────────────────
_MANIFEST_PATH = os.path.join(os.path.dirname(__file__), "data", "exercise_manifest.json")
_EXERCISE_INDEX = {}      # lower(name) → manifest row
_NAMES_BY_CATEGORY = {}   # "Chest" → ["Barbell Bench Press", ...]


def _load_manifest():
    global _EXERCISE_INDEX, _NAMES_BY_CATEGORY
    if _EXERCISE_INDEX:
        return
    with open(_MANIFEST_PATH, "r", encoding="utf-8") as f:
        manifest = json.load(f)
    for ex in manifest.get("exercises", []):
        name = ex.get("name")
        if not name:
            continue
        _EXERCISE_INDEX[name.lower().strip()] = ex
        cat = ex.get("category") or "Other"
        _NAMES_BY_CATEGORY.setdefault(cat, []).append(name)


def _exercise_catalog_for_prompt():
    """Compact catalog grouped by category — keeps token cost reasonable."""
    _load_manifest()
    parts = []
    for cat in sorted(_NAMES_BY_CATEGORY.keys()):
        names = _NAMES_BY_CATEGORY[cat]
        parts.append(f"## {cat} ({len(names)})\n" + ", ".join(names))
    return "\n\n".join(parts)


def _resolve_exercise(name):
    """Look up a Claude-suggested exercise name in the manifest."""
    if not name:
        return None
    return _EXERCISE_INDEX.get(name.lower().strip())


# ── Prompt ────────────────────────────────────────────────────────────
SYSTEM_PROMPT = """You are a workout-import parser for the Be Strong Again coaching platform.

A coach has pasted raw text describing a workout (one or more days). Your job is to convert that text into the platform's structured block schema, mapping every exercise to a name from the provided EXERCISE LIBRARY.

## Block types (use the exact `type` string)
- "theme"         — coach's notes / message for the day (text only, no exercises)
- "warmup"        — warm-up exercises (low load)
- "mobility"      — stretching / mobility flow
- "movement"      — movement prep / activation
- "straight-set"  — single exercise, multiple sets (e.g. "Squat 5x5")
- "superset"      — 2 exercises alternated (A1, A2)
- "triset"        — 3 exercises alternated (A1, A2, A3)
- "circuit"       — 4+ exercises in rotation (use this for METCON / CHIPPER / AMRAP / EMOM too)
- "conditioning"  — pure cardio / energy-system work (run, row, bike, ski)
- "cooldown"      — easy finisher / decompression

## Block JSON shape (return exactly this structure per block)
{
  "type": "<one of the types above>",
  "notes": "",
  "rounds": "",                    // e.g. "3", "AMRAP 12 min" — string
  "circuitType": null,             // or "AMRAP", "EMOM", "Tabata", "For Time", "Chipper"
  "timeLimit": "",                 // minutes, string
  "restBetweenRounds": "",
  "themeText": "",                 // only used when type == "theme"
  "exercises": [
    {
      "name": "<EXACT exercise name from the library>",
      "sets": [
        { "reps": <int>, "percentage": <int|null>, "manualWeight": <int|null>, "isWarmup": false }
      ],
      "scheme": "5-5-5",           // optional human-readable rep scheme
      "baseMax": "bench" | "squat" | "powerClean" | "deadlift" | "bodyweight" | "manual",
      "qualifier": "",             // "each side", "each arm", "x2 combo", etc — empty if not applicable
      "duration": "",              // for time-based moves: "30" (string seconds)
      "durationUnit": "sec"        // or "min"
    }
  ]
}

## Mapping rules
1. **Match exercise names EXACTLY to the library.** If "Goblet Squat" is in the user text and "Dumbbell Goblet Squat" exists in the library, return "Dumbbell Goblet Squat".
2. If you cannot find a confident match, set `"name"` to the user's original wording AND add an entry to the top-level `"unmapped"` array with `{ "user_text": "...", "guesses": ["lib name 1", "lib name 2"] }`.
3. **Block grouping:**
   - Lines marked `A1)` / `A2)` → superset; `A1)` / `A2)` / `A3)` → triset
   - The keywords STRAIGHT SET / SUPERSET / TRISET / CIRCUIT / METCON / CHIPPER / AMRAP / EMOM / WARMUP / COOLDOWN / MOBILITY in the text mark a new block — set the type accordingly
   - METCON, CHIPPER, AMRAP, EMOM all map to type "circuit" — set `circuitType` to the appropriate label
   - A bare exercise on its own line is a "straight-set" block
4. **baseMax inference:** Bench Press → "bench", any Squat → "squat", Deadlift/RDL/Hinge → "deadlift", Power Clean / Olympic / Snatch → "powerClean", bodyweight movements (push-ups, pull-ups, lunges) → "bodyweight". Anything else → "manual".
5. **Percentages:** If text says "@70%" use percentage 70 and leave manualWeight null. If text says "@185 lbs" use manualWeight 185 and percentage null. If only reps are given (no weight), leave both null.
6. **Sets:** Expand "4x10 @70%" into 4 set objects each `{reps:10, percentage:70, manualWeight:null, isWarmup:false}`. For "5/5/3/3/1" return 5 sets with those reps.
7. **Cardio / time-capped moves:** Use "duration" + "durationUnit" instead of reps. e.g. "Plank 30 sec" → `{ "duration": "30", "durationUnit": "sec" }` and empty sets array.

## Output
Return ONLY a JSON object — no prose, no code fences. Shape:
{
  "blocks": [ ...block objects in order... ],
  "unmapped": [ {"user_text":"...", "guesses":[...]} ],
  "warnings": [ "free-text notes about anything ambiguous" ]
}

Below is the EXERCISE LIBRARY you must map names against. Use exact spelling.

EXERCISE LIBRARY:
"""


def _call_claude(raw_text, current_maxes=None):
    api_key = os.environ.get("ANTHROPIC_API_KEY")
    if not api_key:
        raise RuntimeError("ANTHROPIC_API_KEY not set")

    catalog = _exercise_catalog_for_prompt()
    sys_prompt = SYSTEM_PROMPT + catalog

    user_msg = "Coach pasted:\n\n" + raw_text.strip()
    if current_maxes:
        user_msg += f"\n\nCoach's 1RMs (use for percentage sanity): {json.dumps(current_maxes)}"
    user_msg += "\n\nReturn the JSON now."

    r = requests.post(
        "https://api.anthropic.com/v1/messages",
        headers={
            "x-api-key": api_key,
            "anthropic-version": "2023-06-01",
            "content-type": "application/json",
        },
        json={
            "model": "claude-sonnet-4-5",
            "max_tokens": 8000,
            "system": sys_prompt,
            "messages": [{"role": "user", "content": user_msg}],
        },
        timeout=90,
    )
    r.raise_for_status()
    data = r.json()
    text = "".join(b.get("text", "") for b in data.get("content", []) if b.get("type") == "text")
    usage = data.get("usage", {})
    return text, usage


def _extract_json(text):
    """Claude usually returns clean JSON, but strip code fences just in case."""
    t = text.strip()
    if t.startswith("```"):
        t = re.sub(r"^```(?:json)?\s*", "", t)
        t = re.sub(r"\s*```$", "", t)
    return json.loads(t)


def _enrich_blocks(blocks):
    """For each exercise the LLM returned, attach the canonical library
    metadata (cloudflare video UID, equipment, category) when we can
    confidently match the name. Blocks the LLM left in the user's wording
    just pass through with no video — those become the 'unmapped' yellow
    flags in the UI."""
    for block in blocks:
        # Normalise missing fields so the React builder doesn't crash
        block.setdefault("notes", "")
        block.setdefault("rounds", "")
        block.setdefault("collapsed", True)
        block.setdefault("circuitType", None)
        block.setdefault("timeLimit", "")
        block.setdefault("restBetweenRounds", "")
        block.setdefault("themeText", "")
        block.setdefault("exercises", [])
        for ex in block["exercises"]:
            meta = _resolve_exercise(ex.get("name"))
            ex.setdefault("sets", [])
            ex.setdefault("intent", [])
            ex.setdefault("equipment", [])
            ex.setdefault("movement", [])
            ex.setdefault("contraindications", [])
            ex.setdefault("qualifier", "")
            ex["matched"] = bool(meta)
            if meta:
                if meta.get("default_video_uid"):
                    ex["youtube"] = f"https://iframe.videodelivery.net/{meta['default_video_uid']}"
                ex["category"] = meta.get("category")
                ex["sourceLibrary"] = meta.get("source_library")
                # Use the canonical name to ensure tracker lookups work
                ex["name"] = meta.get("name", ex["name"])
            ex["setsCount"] = str(len(ex.get("sets", [])) or 1)
    return blocks


@parser_bp.route("/parse-import", methods=["POST"])
def parse_import():
    body = request.get_json(silent=True) or {}
    raw = (body.get("raw_text") or "").strip()
    maxes = body.get("current_maxes") or None

    if not raw:
        return jsonify({"error": "raw_text required"}), 400
    if len(raw) > 20000:
        return jsonify({"error": "raw_text too long (20000 char limit)"}), 400

    try:
        text, usage = _call_claude(raw, maxes)
    except requests.HTTPError as e:
        return jsonify({"error": f"LLM call failed: {e.response.text[:300]}"}), 502
    except Exception as e:
        return jsonify({"error": f"LLM call failed: {str(e)[:300]}"}), 502

    try:
        parsed = _extract_json(text)
    except Exception as e:
        return jsonify({
            "error": "Could not parse LLM response as JSON",
            "raw_response": text[:1500],
            "detail": str(e),
        }), 500

    blocks = parsed.get("blocks") or []
    unmapped = parsed.get("unmapped") or []
    warnings = parsed.get("warnings") or []

    blocks = _enrich_blocks(blocks)

    return jsonify({
        "success": True,
        "blocks": blocks,
        "unmapped": unmapped,
        "warnings": warnings,
        "tokens_used": {
            "input": usage.get("input_tokens"),
            "output": usage.get("output_tokens"),
        },
    })


@parser_bp.route("/parse-import/health", methods=["GET"])
def parse_import_health():
    _load_manifest()
    return jsonify({
        "ok": True,
        "exercises_loaded": len(_EXERCISE_INDEX),
        "categories": sorted(_NAMES_BY_CATEGORY.keys()),
        "anthropic_key_set": bool(os.environ.get("ANTHROPIC_API_KEY")),
    })
