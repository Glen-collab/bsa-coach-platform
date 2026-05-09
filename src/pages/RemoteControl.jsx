// RemoteControl.jsx — phone-first "TV remote" page for a single gym kiosk.
// Big Week / Day scrollers + a "View Workout" CTA that opens the tracker
// pre-jumped to the current week+day so a coach (or anyone using a tablet
// AS the kiosk) can browse exercises with videos without QR-scanning.

import { useEffect, useState, useMemo, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { api } from '../utils/api';
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
  loading: { textAlign: 'center', padding: '40px', color: 'rgba(255,255,255,0.5)' },
  errorBox: {
    background: 'rgba(220,38,38,0.15)', border: '1px solid rgba(220,38,38,0.4)',
    borderRadius: '10px', padding: '12px 14px', color: '#fecaca',
    fontSize: '13px', marginBottom: '16px',
  },
});

const TRACKER_BASE = 'https://bestrongagain.netlify.app';

export default function RemoteControl() {
  const { deviceId } = useParams();
  const navigate = useNavigate();
  const isMobile = useMediaQuery('(max-width: 640px)');
  const s = buildStyles(isMobile);

  const [device, setDevice] = useState(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');

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
  const dayStep = layout === 'two_day' ? 2 : 1;
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

  // "View Workout" → opens the tracker pre-jumped to this week/day so the
  // coach can browse exercise videos without scanning the TV's QR. New tab
  // so the remote stays put.
  const openWorkout = () => {
    if (!device?.access_code) return;
    const url = `${TRACKER_BASE}/?code=${encodeURIComponent(device.access_code)}&week=${week}&day=${startDay}`;
    window.open(url, '_blank', 'noopener');
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

      <div style={s.hint}>TV updates within ~60 seconds of each tap.</div>
    </div>
  );
}
