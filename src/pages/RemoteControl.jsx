// RemoteControl.jsx — phone-first "TV remote" page for a single gym kiosk.
// Big Week / Day scrollers + a "View Workout" CTA that opens the tracker
// pre-jumped to the current week+day so a coach (or anyone using a tablet
// AS the kiosk) can browse exercises with videos without QR-scanning.

import { useEffect, useState, useMemo, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { api } from '../utils/api';
import { useAuth } from '../hooks/useAuth';
import useMediaQuery from '../hooks/useMediaQuery';

const buildStyles = (isMobile) => ({
  page: {
    minHeight: '100vh',
    background: 'linear-gradient(180deg, #0f172a 0%, #1e293b 100%)',
    color: '#fff',
    padding: isMobile ? '14px 14px 28px' : '24px 32px 48px',
    boxSizing: 'border-box',
  },
  topBar: {
    display: 'flex', alignItems: 'center', gap: '10px',
    marginBottom: '20px',
  },
  backBtn: {
    background: 'rgba(255,255,255,0.08)',
    border: '1px solid rgba(255,255,255,0.15)',
    color: '#e2e8f0',
    padding: '8px 14px', borderRadius: '10px',
    fontSize: '14px', fontWeight: '600', cursor: 'pointer',
    display: 'flex', alignItems: 'center', gap: '6px',
  },
  topTitle: {
    fontSize: '13px', textTransform: 'uppercase', letterSpacing: '2px',
    color: 'rgba(255,255,255,0.6)', fontWeight: '700',
  },

  hero: {
    background: 'rgba(255,255,255,0.05)',
    border: '1px solid rgba(255,255,255,0.1)',
    borderRadius: '16px',
    padding: '18px 20px', marginBottom: '20px',
  },
  deviceName: { fontSize: '13px', color: 'rgba(255,255,255,0.55)', marginBottom: '4px' },
  programName: { fontSize: '22px', fontWeight: '800', color: '#fff', lineHeight: '1.2' },
  programCode: {
    fontSize: '12px', color: 'rgba(255,255,255,0.5)',
    marginTop: '4px', fontFamily: 'ui-monospace,Consolas,monospace', letterSpacing: '1px',
  },

  remotePanel: {
    background: '#0b1220',
    border: '1px solid rgba(255,255,255,0.12)',
    borderRadius: '20px',
    padding: '22px 18px',
    marginBottom: '20px',
    boxShadow: '0 6px 24px rgba(0,0,0,0.4) inset',
  },
  scrollerBlock: { textAlign: 'center', marginBottom: '20px' },
  scrollerLabel: {
    fontSize: '11px', textTransform: 'uppercase', letterSpacing: '2px',
    color: 'rgba(255,255,255,0.55)', fontWeight: '700', marginBottom: '8px',
  },
  scrollerRow: { display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '14px' },
  scrollerVal: {
    fontSize: '34px', fontWeight: '900', color: '#fff',
    minWidth: '120px', textAlign: 'center',
    fontVariantNumeric: 'tabular-nums',
  },
  scrollerBtn: {
    width: '64px', height: '64px', borderRadius: '50%',
    border: 'none',
    background: 'linear-gradient(180deg, #f8fafc, #cbd5e1)',
    color: '#0f172a',
    fontSize: '24px', fontWeight: '900', cursor: 'pointer',
    boxShadow: '0 3px 8px rgba(0,0,0,0.4)',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
  },
  scrollerBtnDisabled: {
    background: 'rgba(255,255,255,0.1)', color: 'rgba(255,255,255,0.3)',
    boxShadow: 'none', cursor: 'not-allowed',
  },

  ctaBtn: {
    display: 'block', width: '100%',
    background: 'linear-gradient(135deg, #f59e0b, #d97706)',
    color: '#1a1a2e', border: 'none', borderRadius: '14px',
    padding: '18px',
    fontSize: '17px', fontWeight: '900',
    cursor: 'pointer', letterSpacing: '0.4px',
    boxShadow: '0 4px 12px rgba(217, 119, 6, 0.4)',
  },
  hint: {
    textAlign: 'center', fontSize: '12px',
    color: 'rgba(255,255,255,0.4)', marginTop: '14px',
  },

  // Leaderboard sub-flow
  divider: {
    height: '1px', background: 'rgba(255,255,255,0.08)',
    margin: '24px 0 18px',
  },
  sectionHead: {
    fontSize: '12px', textTransform: 'uppercase', letterSpacing: '2px',
    color: 'rgba(255,255,255,0.55)', fontWeight: 700, marginBottom: '10px',
  },
  modeToggleRow: {
    display: 'flex', background: 'rgba(0,0,0,0.25)',
    border: '1px solid rgba(255,255,255,0.1)', borderRadius: '12px',
    padding: '4px', marginBottom: '14px', gap: '4px',
  },
  modeBtn: {
    flex: 1, padding: '12px 8px',
    background: 'transparent', color: 'rgba(255,255,255,0.6)',
    border: 'none', borderRadius: '10px',
    fontSize: '14px', fontWeight: 700, cursor: 'pointer',
    transition: 'all 120ms',
  },
  modeBtnActive: {
    background: 'linear-gradient(135deg, #fbbf24, #f59e0b)',
    color: '#1a1a2e',
    boxShadow: '0 2px 6px rgba(217, 119, 6, 0.35)',
  },
  secondaryBtn: {
    display: 'block', width: '100%',
    background: 'rgba(255,255,255,0.08)', color: '#fff',
    border: '1px solid rgba(255,255,255,0.18)',
    borderRadius: '12px', padding: '14px',
    fontSize: '15px', fontWeight: 700, cursor: 'pointer',
  },

  metricBlock: { marginBottom: '14px' },
  metricLabel: {
    fontSize: '11px', textTransform: 'uppercase', letterSpacing: '2px',
    color: 'rgba(255,255,255,0.55)', fontWeight: 700, marginBottom: '8px',
  },
  metricChipRow: { display: 'flex', flexWrap: 'wrap', gap: '6px' },
  // Fixed 3-across grid for the (long) metric list — even columns, long
  // labels ellipsis rather than wrap/cut off.
  metricChipGrid: { display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '6px' },
  metricChipFill: {
    width: '100%', boxSizing: 'border-box', textAlign: 'center',
    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0,
  },
  metricChip: {
    padding: '8px 10px', borderRadius: '999px',
    background: 'rgba(255,255,255,0.08)', color: 'rgba(255,255,255,0.85)',
    border: '1px solid rgba(255,255,255,0.18)',
    fontSize: '12px', fontWeight: 700, cursor: 'pointer',
    letterSpacing: '0.3px',
  },
  metricChipActive: {
    background: 'linear-gradient(135deg, #fbbf24, #f59e0b)',
    color: '#1a1a2e',
    border: '1px solid rgba(0,0,0,0)',
  },
  metricEmpty: {
    fontSize: '12px', color: 'rgba(255,255,255,0.4)', padding: '6px 0',
  },
  loading: { textAlign: 'center', padding: '40px', color: 'rgba(255,255,255,0.5)' },
  errorBox: {
    background: 'rgba(220,38,38,0.15)', border: '1px solid rgba(220,38,38,0.4)',
    borderRadius: '10px', padding: '12px 14px', color: '#fecaca',
    fontSize: '13px', marginBottom: '16px',
  },
});

const TRACKER_BASE     = 'https://bestrongagain.netlify.app';
const LEADERBOARD_BASE = 'https://leaderboard.bestrongagain.com';

export default function RemoteControl() {
  const { deviceId } = useParams();
  const navigate = useNavigate();
  const isMobile = useMediaQuery('(max-width: 640px)');
  const { user } = useAuth();
  const s = buildStyles(isMobile);

  const [device, setDevice] = useState(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  // Available leaderboard metrics + groups + years — fetched directly
  // from the leaderboard backend (CORS-allow-listed). Lets the coach
  // lock the TV to a single metric, gender, group, or recording year.
  const [metrics, setMetrics] = useState([]);
  const [groups,  setGroups]  = useState([]);
  const [years,   setYears]   = useState([]);
  useEffect(() => {
    fetch(`${LEADERBOARD_BASE}/api/metrics`).then(r => r.json()).then(setMetrics).catch(() => {});
    fetch(`${LEADERBOARD_BASE}/api/leaderboard/groups`).then(r => r.json()).then(setGroups).catch(() => {});
    fetch(`${LEADERBOARD_BASE}/api/leaderboard/years`).then(r => r.json()).then(setYears).catch(() => {});
  }, []);

  const load = useCallback(async () => {
    try {
      const r = await api.kioskMyDevices();
      const found = (r.devices || []).find((d) => String(d.id) === String(deviceId));
      if (!found) {
        setErr('Device not found.');
      } else {
        setDevice(found);
      }
    } catch (e) {
      setErr(e.message || 'Failed to load device.');
    } finally {
      setLoading(false);
    }
  }, [deviceId]);

  useEffect(() => { load(); }, [load]);

  const layout = device?.layout || 'two_day';
  // Step by 1 always — even in two-day layout, coach may want to land
  // on day pairs like 2-3 or 3-4 (overlapping each other) instead of
  // jumping in disjoint 1-2 → 3-4 chunks. Tap twice to step 2 if needed.
  const dayStep = 1;
  const week = device?.view_week || 1;
  const startDay = device?.view_start_day || 1;

  const dayLabel = useMemo(() => {
    if (layout === 'two_day') return `${startDay}-${startDay + 1}`;
    return String(startDay);
  }, [layout, startDay]);

  const setView = async (nextWeek, nextStartDay) => {
    const w = Math.max(1, nextWeek);
    const sd = Math.max(1, nextStartDay);
    // Optimistic so the UI feels snappy — server confirms shortly.
    setDevice((prev) => prev ? { ...prev, view_week: w, view_start_day: sd } : prev);
    try {
      await api.kioskDeviceSetView(deviceId, w, sd);
    } catch (e) {
      setErr(e.message || 'Failed to update.');
      load();
    }
  };

  // "View Workout" → opens the workout-browse view at /tv/static?tablet=1
  // pre-jumped to the same week/day the gym TV is showing. Same two-day
  // workout layout, plus tappable play buttons on every exercise that has
  // a demo video (fullscreen overlay), plus a "← Back to Remote" button
  // that returns to this page. No member identity, no input boxes — pure
  // browse + watch surface for the gym tablet. Members log on their own
  // phone via QR; that drives app adoption.
  const openWorkout = () => {
    if (!device?.access_code) return;
    const coachCode = (user?.referral_code || '').trim().toUpperCase();
    const params = new URLSearchParams({
      tablet: '1',
      code:   device.access_code,
      week:   String(week),
      day:    String(startDay),
      from:   window.location.href,
    });
    if (coachCode) params.set('coach', coachCode);
    if (layout === 'wod') params.set('layout', 'wod');
    const url = `${TRACKER_BASE}/tv/static?${params.toString()}`;
    window.open(url, '_blank', 'noopener');
  };

  // Display-mode toggles (workout vs youth-leaderboard scoreboard). Each
  // Pi is independent — coach can flip one TV to the leaderboard during a
  // test day while the other gym TVs keep showing workouts.
  const isLeaderboardMode = device?.display_mode === 'leaderboard';
  const lockedMetricId = device?.display_metric_id || null;
  // Multi-metric rotation subset (CSV in the device row → number array). Empty = auto-rotate all.
  const selectedMetricIds = (device?.display_metric_ids || '').split(',').map(Number).filter(Boolean);
  const lockedGender   = device?.display_gender   || null;  // 'M' | 'F' | 'A' | null
  const lockedGroup    = device?.display_group    || null;
  const lockedYear     = device?.display_year     || null;  // '2026' | null (= all-time)

  // Update display state — flip mode, lock to a metric, etc. Optimistic
  // local update so the UI feels snappy; rollback on failure.
  // IMPORTANT: use `'key' in patch` (not `patch.key ?? fallback`) for every
  // field so an explicit null in the patch actually clears the value.
  // Otherwise tapping "Auto" (which sends { gender: null }) silently kept
  // the previous gender — same trap for group/metric_id.
  const setDisplay = async (patch) => {
    const next = {
      mode:       'mode'       in patch ? patch.mode       : (device?.display_mode      ?? 'workout'),
      metric_id:  'metric_id'  in patch ? patch.metric_id  : (device?.display_metric_id ?? null),
      metric_ids: 'metric_ids' in patch ? patch.metric_ids : selectedMetricIds,
      gender:     'gender'     in patch ? patch.gender     : (device?.display_gender    ?? null),
      group:      'group'      in patch ? patch.group      : (device?.display_group     ?? null),
      year:       'year'       in patch ? patch.year       : (device?.display_year      ?? null),
    };
    setDevice((prev) => prev ? {
      ...prev,
      display_mode:       next.mode,
      display_metric_id:  next.metric_id,
      display_metric_ids: (next.metric_ids || []).join(','),
      display_gender:     next.gender,
      display_group:      next.group,
      display_year:       next.year,
    } : prev);
    try {
      await api.kioskDeviceSetDisplay(deviceId, next);
    } catch (e) {
      setErr(e.message || 'Failed to update display.');
      load();
    }
  };

  const openTestStation = () => {
    // Pass the current remote-control URL so the test station's "Back"
    // button can return here. Also pre-fill the metric if the TV is
    // currently locked to one — killer flow: lock TV to 40yd, open test
    // station, it's already on 40yd, athletes log → live updates on TV.
    const from = encodeURIComponent(window.location.href);
    const params = new URLSearchParams({ from: window.location.href });
    if (lockedMetricId) params.set('metric_id', lockedMetricId);
    window.open(`${LEADERBOARD_BASE}/test-station?${params.toString()}`, '_blank', 'noopener');
  };

  if (loading) {
    return (
      <div style={s.page}>
        <div style={s.topBar}>
          <button style={s.backBtn} onClick={() => navigate('/gym-tv')}>{'← Back'}</button>
        </div>
        <div style={s.loading}>Loading…</div>
      </div>
    );
  }

  return (
    <div style={s.page}>
      <div style={s.topBar}>
        <button style={s.backBtn} onClick={() => navigate('/gym-tv')}>{'← Back'}</button>
        <span style={s.topTitle}>Remote</span>
      </div>

      {err && <div style={s.errorBox}>{err}</div>}

      <div style={s.hero}>
        <div style={s.deviceName}>{device?.display_name || 'Device'}</div>
        {device?.program_name ? (
          <>
            <div style={s.programName}>{device.program_name}</div>
            <div style={s.programCode}>CODE {device.access_code}</div>
          </>
        ) : (
          <div style={s.programName}>No program on TV</div>
        )}
      </div>

      <div style={s.remotePanel}>
        <div style={s.scrollerBlock}>
          <div style={s.scrollerLabel}>Week</div>
          <div style={s.scrollerRow}>
            <button
              style={{ ...s.scrollerBtn, ...(week <= 1 ? s.scrollerBtnDisabled : {}) }}
              disabled={week <= 1}
              onClick={() => setView(week - 1, 1)}
              aria-label="Previous week"
            >{'◀'}</button>
            <div style={s.scrollerVal}>{week}</div>
            <button
              style={s.scrollerBtn}
              onClick={() => setView(week + 1, 1)}
              aria-label="Next week"
            >{'▶'}</button>
          </div>
        </div>

        <div style={s.scrollerBlock}>
          <div style={s.scrollerLabel}>{layout === 'two_day' ? 'Days' : 'Day'}</div>
          <div style={s.scrollerRow}>
            <button
              style={{ ...s.scrollerBtn, ...(startDay <= 1 ? s.scrollerBtnDisabled : {}) }}
              disabled={startDay <= 1}
              onClick={() => setView(week, startDay - dayStep)}
              aria-label="Previous day"
            >{'◀'}</button>
            <div style={s.scrollerVal}>{dayLabel}</div>
            <button
              style={s.scrollerBtn}
              onClick={() => setView(week, startDay + dayStep)}
              aria-label="Next day"
            >{'▶'}</button>
          </div>
        </div>
      </div>

      <button
        type="button"
        onClick={openWorkout}
        disabled={!device?.access_code}
        style={{
          ...s.ctaBtn,
          opacity: device?.access_code ? 1 : 0.4,
          cursor: device?.access_code ? 'pointer' : 'not-allowed',
        }}
      >
        ▶ View Workout (with videos)
      </button>

      <div style={s.divider} />
      <div style={s.sectionHead}>📊 Leaderboard</div>

      <div style={s.modeToggleRow}>
        <button
          type="button"
          onClick={() => setDisplay({ mode: 'workout' })}
          style={{ ...s.modeBtn, ...(!isLeaderboardMode ? s.modeBtnActive : {}) }}
        >
          Workouts
        </button>
        <button
          type="button"
          onClick={() => setDisplay({ mode: 'leaderboard' })}
          style={{ ...s.modeBtn, ...(isLeaderboardMode ? s.modeBtnActive : {}) }}
        >
          Leaderboard
        </button>
      </div>

      {/* Metric picker — only shown in Leaderboard mode. Auto-rotate (null
          metric_id) is the default; tap a specific metric to lock the TV
          to it for a test day. The same metric also pre-fills the test
          station so live updates land on the same scoreboard the TV is
          showing. */}
      {isLeaderboardMode && (
        <div style={s.metricBlock}>
          <div style={s.metricLabel}>What's on the TV</div>
          <div style={{ fontSize: '12px', color: '#94a3b8', margin: '0 2px 8px', lineHeight: 1.4 }}>
            <b>Auto-rotate</b> cycles every metric (top 7 each). Tap metrics to light them
            up and show <b>only those</b> — one locks to it (full list), several rotate
            through your picks.
          </div>
          <div style={s.metricChipGrid}>
            <button
              type="button"
              onClick={() => setDisplay({ metric_ids: [], metric_id: null })}
              style={{ ...s.metricChip, ...s.metricChipFill, ...(selectedMetricIds.length === 0 ? s.metricChipActive : {}) }}
            >
              ⟳ Auto-rotate
            </button>
            {metrics.map((m) => {
              const on = selectedMetricIds.includes(m.id);
              return (
                <button
                  key={m.id}
                  type="button"
                  title={m.label}
                  onClick={() => {
                    const nextIds = on
                      ? selectedMetricIds.filter((x) => x !== m.id)
                      : [...selectedMetricIds, m.id];
                    setDisplay({ metric_ids: nextIds, metric_id: null });
                  }}
                  style={{ ...s.metricChip, ...s.metricChipFill, ...(on ? s.metricChipActive : {}) }}
                >
                  {on ? '✓ ' : ''}{m.label}
                </button>
              );
            })}
            {metrics.length === 0 && (
              <span style={s.metricEmpty}>(loading metrics from leaderboard…)</span>
            )}
          </div>

          {/* Gender filter — Auto-rotate (default, flips Boys↔Girls each
              cycle), All (everyone in one ranked list), Boys, Girls. */}
          <div style={{ ...s.metricLabel, marginTop: '12px' }}>Who's on the TV</div>
          <div style={s.metricChipRow}>
            <button
              type="button"
              onClick={() => setDisplay({ gender: null })}
              style={{ ...s.metricChip, ...(!lockedGender ? s.metricChipActive : {}) }}
            >
              ⟳ Auto (B↔G)
            </button>
            <button
              type="button"
              onClick={() => setDisplay({ gender: 'A' })}
              style={{ ...s.metricChip, ...(lockedGender === 'A' ? s.metricChipActive : {}) }}
            >
              All
            </button>
            <button
              type="button"
              onClick={() => setDisplay({ gender: 'M' })}
              style={{ ...s.metricChip, ...(lockedGender === 'M' ? s.metricChipActive : {}) }}
            >
              Boys
            </button>
            <button
              type="button"
              onClick={() => setDisplay({ gender: 'F' })}
              style={{ ...s.metricChip, ...(lockedGender === 'F' ? s.metricChipActive : {}) }}
            >
              Girls
            </button>
          </div>

          {/* Group filter — only renders when training groups exist. */}
          {groups.length > 0 && (
            <>
              <div style={{ ...s.metricLabel, marginTop: '12px' }}>Group</div>
              <div style={s.metricChipRow}>
                <button
                  type="button"
                  onClick={() => setDisplay({ group: null })}
                  style={{ ...s.metricChip, ...(!lockedGroup ? s.metricChipActive : {}) }}
                >
                  All groups
                </button>
                {groups.map((g) => (
                  <button
                    key={g}
                    type="button"
                    onClick={() => setDisplay({ group: g })}
                    style={{ ...s.metricChip, ...(lockedGroup === g ? s.metricChipActive : {}) }}
                  >
                    {g}
                  </button>
                ))}
              </div>
            </>
          )}

          {/* Year filter — All-time (= each athlete's best ever, the
              default) plus chips for every year that has results. Lets
              the coach show "this year's records" vs "all-time records"
              on the TV. */}
          <div style={{ ...s.metricLabel, marginTop: '12px' }}>Year</div>
          <div style={s.metricChipRow}>
            <button
              type="button"
              onClick={() => setDisplay({ year: null })}
              style={{ ...s.metricChip, ...(!lockedYear ? s.metricChipActive : {}) }}
            >
              All-time
            </button>
            {years.map((y) => (
              <button
                key={y}
                type="button"
                onClick={() => setDisplay({ year: y })}
                style={{ ...s.metricChip, ...(lockedYear === String(y) ? s.metricChipActive : {}) }}
              >
                {y}
              </button>
            ))}
          </div>
        </div>
      )}

      <button type="button" onClick={openTestStation} style={s.secondaryBtn}>
        🎯 Open Test Station (data entry)
      </button>

      <div style={s.hint}>
        {isLeaderboardMode
          ? lockedMetricId
            ? 'TV is locked to one metric — live updates as the test station saves.'
            : 'TV is auto-rotating through every metric.'
          : 'TV updates within ~60 seconds of each tap.'}
      </div>
    </div>
  );
}
