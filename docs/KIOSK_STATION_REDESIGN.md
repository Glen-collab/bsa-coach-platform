# Kiosk-Station UX Redesign — member-dropdown wrapper

Planning doc — paused mid-discussion 2026-05-10. Not yet implemented.

## Problem

Today's flow when a coach taps "View Workout" on the dashboard's
RemoteControl with `?kiosk=1`:

1. Tablet opens the WorkoutTracker
2. **Member picker screen** (`KioskPickerScreen.jsx`) shows a list of
   names — coach hands tablet to athlete, athlete taps their name
3. Full WorkoutTracker UI loads for that athlete (with videos,
   recommendations, drop sets, percentages, etc.)
4. Athlete logs their workout
5. After save, returns to the member picker for the next person

**The pain Glen flagged:** when one athlete's tracker is on screen,
the videos and exercises ARE visible — but to switch members the
flow has to bounce all the way back to the picker screen, which
loses the always-on-screen-videos value of the tablet. Coach also
loses the "single shared workout view" mental model.

## Goal

Keep the always-visible workout view (videos, exercises, all the
existing tracker features) AND make member-switching one tap from
inside the tracker — without throwing the tablet back to a separate
picker screen on every member change.

Glen's framing: "keep the workout tracker meat and have a different
wrapper look to it for ease of picking athletes — name dropdown
where the 'cast to tv' button would be."

## Proposed shape

Reuse `ProgramView.jsx` + all its descendants verbatim. In
`?kiosk=1` mode, replace the top action area (where Cast-to-TV pill
+ chatbot button live today) with a single pill:

```
🏋️ Logging:  Smith, J. ▾
```

- **First load:** no member picked → render existing
  `KioskPickerScreen` as the inline picker (or as a fullscreen
  takeover; TBD by feel).
- **After first pick:** tracker renders normally for that athlete.
  The "Switch member" pill is always visible at the top.
- **Tap pill → dropdown** of all members under this coach (same data
  the picker uses today). Tap a name → tracker quietly re-runs
  `handleLoadProgramFromAPI` for that email. Workout content stays
  on screen during the swap; just data + tracking inputs reset.
- **After log workout:** stay on the same view, switch dropdown
  back to "pick someone" (or auto-clear), keep videos visible.
- **Chatbot + FriendChat** still hidden in kiosk mode (already done).

## Implementation sketch

Files to touch:

- `workouttracker/src/App.jsx`
  - Drop the `screen === 'access' && isKioskStation → KioskPickerScreen`
    branch when a member's already loaded.
  - Render the kiosk wrapper bar inside the program view when
    `isKioskStation`.
- `workouttracker/src/components/program/ProgramView.jsx`
  - New top-of-page slot for the kiosk wrapper bar (only rendered
    when isKioskStation).
- `workouttracker/src/components/access/KioskMemberSwitcher.jsx` (new)
  - Pill button that opens a dropdown of members from
    `/api/kiosk/members?coach=...` (existing endpoint).
  - On select, calls a parent-supplied `onSwitchMember(member)` which
    triggers the program reload with the new email.
- Lifecycle: re-running `handleLoadProgramFromAPI` already handles
  resetting `trackingData`, `recommendations`, etc. Just need to
  trigger it without going through the access screen.

## Tradeoffs to think through before building

| Tradeoff | Today's design | Proposed design |
|---|---|---|
| Privacy between members on shared tablet | Picker screen between members is a natural reset | Switching mid-view exposes prior member's saved 1RMs / weight history briefly until the new program loads |
| Half-finished entries | Each member starts in clean picker state | A coach swapping members mid-entry could lose draft inputs unless we add auto-save-on-switch |
| Dev complexity | Two surfaces (picker + tracker), already built | One surface, smaller code change but tracker's state machine wasn't designed to "swap users" mid-session — needs careful state-reset audit |
| Coach mental model | "Pick a name, hand them the tablet" | "Workout's always up; tap to switch who's logging" |

## Business angle

Glen flagged this as potentially a coach-tier upcharge — "shared gym
station" feature for studios that want a wall-mounted tablet logging
station. Acceptable to build the feature unconditionally now and
gate it behind `coach.tier >= 'pro'` later when monetization is
ready. No paywall infrastructure needed for V1.

## Alternative considered

**Drop the picker entirely; just a dropdown on the tracker.** Cleaner
mental model but loses the "fresh session for first-time use" benefit
the picker gives today. Decided to keep both — picker on first load,
dropdown after.

## Decision deferred

Picking back up later. When ready, work order is roughly:

1. New `KioskMemberSwitcher.jsx` component (~80 lines)
2. Wire into `App.jsx` as the kiosk-mode top-bar replacement
3. Test member-switch state reset (auto-save-on-switch logic)
4. Hide the original picker after first selection (still entry point)
5. Privacy review: confirm what's visible during the brief swap window

Estimated 3-4 hours of focused work.
