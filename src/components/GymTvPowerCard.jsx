// GymTvPowerCard — remote Pi power controls (Shutdown / Reboot / Quit Game).
//
// Multi-device aware. Fetches the coach's registered Pis on mount and
// renders an "All TVs" broadcast row plus one row per Pi. Each row has
// its own Shutdown / Reboot buttons (Quit Game shows on the arcade-style
// rows only — wired the same way). Commands flow through the existing
// kiosk_commands queue with the device_serial column targeting a single
// Pi or NULL for broadcast. Used on both CoachDashboard and AdminDashboard.

import { useState, useEffect, useCallback } from 'react';
import { api } from '../utils/api';

function lastSeenLabel(iso) {
  if (!iso) return 'never seen';
  const seenAt = new Date(iso).getTime();
  if (!seenAt) return 'never seen';
  const mins = Math.floor((Date.now() - seenAt) / 60000);
  if (mins < 2)   return 'online';
  if (mins < 60)  return `last seen ${mins}m ago`;
  if (mins < 1440) return `last seen ${Math.floor(mins / 60)}h ago`;
  return `last seen ${Math.floor(mins / 1440)}d ago`;
}

function lastSeenColor(iso) {
  if (!iso) return '#9ca3af';
  const mins = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 2)  return '#059669';   // green — online
  if (mins < 30) return '#d97706';   // amber — recently
  return '#9ca3af';                  // gray — stale
}

export default function GymTvPowerCard({ isMobile, s }) {
  const [devices, setDevices] = useState([]);
  const [loadingDevices, setLoadingDevices] = useState(true);
  // busy: { [key]: 'shutdown' | 'reboot' }    key = device_serial or '__all'
  const [busy, setBusy] = useState({});
  // per-row status messages
  const [msgs, setMsgs] = useState({});
  // Default-collapsed so the power tools don't take up screen real estate
  // on the daily dashboard view. Coach taps the header to expand when
  // they actually need to shutdown / reboot a Pi.
  const [open, setOpen] = useState(false);

  const loadDevices = useCallback(async () => {
    setLoadingDevices(true);
    try {
      const res = await api.kioskMyDevices();
      setDevices(Array.isArray(res?.devices) ? res.devices : []);
    } catch {
      setDevices([]);
    } finally {
      setLoadingDevices(false);
    }
  }, []);

  useEffect(() => { loadDevices(); }, [loadDevices]);

  // When the user renames a device on the GymTV page and tabs back to
  // their admin dashboard, refresh so the new label shows up here too.
  // Without this, the old "New device (1956)" stays cached until manual
  // Refresh click — confusing rename UX across tabs.
  useEffect(() => {
    const onFocus = () => loadDevices();
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [loadDevices]);

  const send = async (kind, deviceSerial, label) => {
    const target = deviceSerial ? `“${label}”` : 'ALL of your gym TVs';
    const confirmText = kind === 'shutdown'
      ? `Shut down ${target} now? The Pi(s) will halt within ~10 seconds.`
      : `Reboot ${target} now? The Pi(s) will come back up on their own.`;
    if (!window.confirm(confirmText)) return;

    const key = deviceSerial || '__all';
    setBusy((b) => ({ ...b, [key]: kind }));
    setMsgs((m) => ({ ...m, [key]: null }));
    try {
      const fn = kind === 'shutdown' ? api.kioskShutdown : api.kioskPiReboot;
      const res = await fn(deviceSerial);
      if (res?.success) {
        setMsgs((m) => ({
          ...m,
          [key]: kind === 'shutdown'
            ? 'Shutdown queued. Give it 10–15 seconds, then unplug.'
            : 'Reboot queued. TV will come back up in about a minute.',
        }));
      } else {
        setMsgs((m) => ({ ...m, [key]: res?.message || 'Command failed.' }));
      }
    } catch (e) {
      setMsgs((m) => ({ ...m, [key]: e.message || 'Network error.' }));
    } finally {
      setBusy((b) => ({ ...b, [key]: null }));
    }
  };

  const rowStyle = {
    display: 'grid',
    gridTemplateColumns: isMobile ? '1fr' : '1fr auto auto',
    gap: 10,
    alignItems: 'center',
    padding: '10px 0',
    borderTop: '1px solid #e5e7eb',
  };

  const btnShutdown = {
    ...s.toolBtn,
    background: 'linear-gradient(135deg, #1a1a2e, #2d2d4a)',
  };
  // The All-TVs shutdown is a destructive broadcast — every gym TV at once.
  // Red + radioactive marker so it can't be mistaken for the per-device row
  // (which is dark navy) on a quick scan. Mild box-shadow + bolder weight
  // separate it visually from the rest of the controls.
  const btnShutdownAll = {
    ...s.toolBtn,
    background: 'linear-gradient(135deg, #dc2626, #991b1b)',
    color: '#fff',
    fontWeight: 800,
    boxShadow: '0 0 0 1px rgba(255,255,255,0.15) inset, 0 4px 10px rgba(220,38,38,0.35)',
    letterSpacing: '0.3px',
  };
  const btnReboot = {
    ...s.toolBtn,
    background: 'linear-gradient(135deg, #667eea, #764ba2)',
  };

  const onlineCount = devices.filter((d) => {
    if (!d.last_seen_at) return false;
    return (Date.now() - new Date(d.last_seen_at).getTime()) / 60000 < 2;
  }).length;

  return (
    <div style={s.card}>
      <div
        onClick={() => setOpen((v) => !v)}
        style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', cursor: 'pointer', userSelect: 'none' }}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setOpen((v) => !v); } }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 14, color: '#6b7280', width: 14, display: 'inline-block', transform: open ? 'rotate(90deg)' : 'rotate(0deg)', transition: 'transform 0.15s' }}>▶</span>
          <div style={s.cardTitle}>Gym TV Power</div>
          {!open && devices.length > 0 && (
            <span style={{ fontSize: 12, color: '#6b7280', fontWeight: 500 }}>
              · {devices.length} TV{devices.length === 1 ? '' : 's'}{onlineCount > 0 ? `, ${onlineCount} online` : ''}
            </span>
          )}
        </div>
        {open && (
          <button
            onClick={(e) => { e.stopPropagation(); loadDevices(); }}
            disabled={loadingDevices}
            style={{ fontSize: 12, color: '#6b7280', background: 'transparent', border: 'none', cursor: 'pointer', textDecoration: 'underline' }}
          >
            {loadingDevices ? 'Refreshing…' : 'Refresh'}
          </button>
        )}
      </div>
      {!open && (<></>)}
      {open && (<>
      <div style={{ fontSize: 13, color: '#666', marginBottom: 12, marginTop: 10, lineHeight: 1.4 }}>
        Graceful remote control for your Pi-powered gym TVs. Use Shutdown before
        you leave for the night so the Pi halts cleanly instead of getting its
        power yanked.
      </div>

      {/* All-TVs broadcast row */}
      <div style={{ ...rowStyle, borderTop: 'none', background: '#f9fafb', borderRadius: 8, padding: 12, marginBottom: 4 }}>
        <div>
          <div style={{ fontWeight: 700, color: '#111827' }}>All TVs</div>
          <div style={{ fontSize: 12, color: '#6b7280' }}>
            Broadcasts to every Pi on your coach code{devices.length ? ` (${devices.length})` : ''}.
          </div>
          {msgs.__all && (
            <div style={{ fontSize: 12, color: '#065f46', background: '#ecfdf5', padding: '6px 10px', borderRadius: 6, marginTop: 6 }}>
              {msgs.__all}
            </div>
          )}
        </div>
        <button
          onClick={() => send('shutdown', null, 'All TVs')}
          disabled={busy.__all || loadingDevices}
          style={{ ...btnShutdownAll, opacity: busy.__all ? 0.6 : 1 }}
          title="Shuts down EVERY gym TV at once"
        >
          {busy.__all === 'shutdown' ? 'Sending…' : '☢ Shutdown All'}
        </button>
        <button
          onClick={() => send('reboot', null, 'All TVs')}
          disabled={busy.__all || loadingDevices}
          style={{ ...btnReboot, opacity: busy.__all ? 0.6 : 1 }}
        >
          {busy.__all === 'reboot' ? 'Sending…' : 'Reboot All'}
        </button>
      </div>

      {/* Per-device rows */}
      {loadingDevices && devices.length === 0 && (
        <div style={{ fontSize: 13, color: '#6b7280', padding: '12px 0' }}>Loading devices…</div>
      )}
      {!loadingDevices && devices.length === 0 && (
        <div style={{ fontSize: 13, color: '#6b7280', padding: '12px 0' }}>
          No Pi devices registered yet. Plug a Pi in and open the kiosk URL — it will auto-register.
        </div>
      )}
      {devices.map((d) => {
        const key = d.device_serial;
        const label = d.display_name || `Pi …${(d.device_serial || '').slice(-4)}`;
        return (
          <div key={d.id} style={rowStyle}>
            <div>
              <div style={{ fontWeight: 600, color: '#111827' }}>{label}</div>
              <div style={{ fontSize: 12, color: lastSeenColor(d.last_seen_at) }}>
                {lastSeenLabel(d.last_seen_at)}
                {d.program_name ? ` · ${d.program_name}` : ''}
              </div>
              {msgs[key] && (
                <div style={{ fontSize: 12, color: '#065f46', background: '#ecfdf5', padding: '6px 10px', borderRadius: 6, marginTop: 6 }}>
                  {msgs[key]}
                </div>
              )}
            </div>
            <button
              onClick={() => send('shutdown', d.device_serial, label)}
              disabled={!!busy[key]}
              style={{ ...btnShutdown, opacity: busy[key] ? 0.6 : 1 }}
            >
              {busy[key] === 'shutdown' ? 'Sending…' : 'Shutdown'}
            </button>
            <button
              onClick={() => send('reboot', d.device_serial, label)}
              disabled={!!busy[key]}
              style={{ ...btnReboot, opacity: busy[key] ? 0.6 : 1 }}
            >
              {busy[key] === 'reboot' ? 'Sending…' : 'Reboot'}
            </button>
          </div>
        );
      })}
      </>)}
    </div>
  );
}
