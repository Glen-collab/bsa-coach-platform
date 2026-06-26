// GymTV.jsx — coach-facing kiosk control panel (per-device).
// Flip programs in/out of the kiosk lineup, then pick an active program for each
// registered Pi device. Pis self-register on first boot via CPU serial.

import { useEffect, useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { api } from '../utils/api';
import useMediaQuery from '../hooks/useMediaQuery';
import GameModeCard from '../components/GameModeCard';

const buildStyles = (isMobile) => ({
  page: { maxWidth: '1100px', margin: '0 auto', padding: isMobile ? '16px 12px' : '32px 24px' },
  title: { fontSize: isMobile ? '22px' : '28px', fontWeight: '800', marginBottom: '4px' },
  sub: { fontSize: '14px', color: '#666', marginBottom: '18px', lineHeight: '1.5' },
  piUrlBox: {
    background: '#f0f7ff', border: '1px solid #d0e3f7', borderRadius: '10px',
    padding: '12px 16px', marginBottom: '20px',
  },
  piUrlLabel: { fontSize: '11px', fontWeight: '700', color: '#1565c0', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '4px' },
  piUrlValue: { fontSize: '12px', color: '#0d3a6b', wordBreak: 'break-all', fontFamily: 'ui-monospace,Consolas,monospace' },
  section: { background: '#fff', borderRadius: '14px', padding: isMobile ? '14px' : '20px', marginBottom: '16px', boxShadow: '0 2px 10px rgba(0,0,0,0.05)' },
  sectionTitle: { fontSize: isMobile ? '16px' : '18px', fontWeight: '700', color: '#1a1a2e', marginBottom: '12px' },
  empty: { color: '#888', fontSize: '14px', padding: '14px', background: '#f8f9fa', borderRadius: '10px', textAlign: 'center' },

  // Device card
  deviceCard: {
    background: '#fff', border: '2px solid #e5e7eb', borderRadius: '14px',
    padding: isMobile ? '14px' : '18px', marginBottom: '14px',
  },
  deviceHeader: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '10px', marginBottom: '12px' },
  deviceName: { fontSize: isMobile ? '15px' : '17px', fontWeight: '700', color: '#1a1a2e' },
  deviceNameInput: { fontSize: '15px', fontWeight: '700', padding: '4px 8px', border: '1px solid #d1d5db', borderRadius: '6px', minWidth: '180px' },
  deviceMeta: { fontSize: '12px', color: '#888', display: 'flex', gap: '10px', flexWrap: 'wrap' },
  deviceActions: { display: 'flex', gap: '6px' },
  activeBanner: {
    background: 'linear-gradient(135deg, #ecfdf5, #d1fae5)',
    border: '1px solid #86efac', borderRadius: '10px',
    padding: '10px 14px', marginBottom: '12px', fontSize: '13px',
    display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '8px', flexWrap: 'wrap',
  },
  activeLabel: { color: '#065f46', fontWeight: '700' },
  idleBanner: {
    background: '#fef3c7', border: '1px solid #fde68a', borderRadius: '10px',
    padding: '10px 14px', marginBottom: '12px', fontSize: '13px', color: '#92400e',
  },

  tilesGrid: {
    display: 'grid',
    gridTemplateColumns: isMobile ? 'repeat(2, 1fr)' : 'repeat(auto-fill, minmax(180px, 1fr))',
    gap: '10px',
  },
  tile: {
    position: 'relative',
    padding: '14px 12px', border: '2px solid #e5e7eb', borderRadius: '10px',
    background: '#fafbfd', cursor: 'pointer', textAlign: 'left',
    minHeight: '72px',
    transition: 'all 120ms',
  },
  tileActive: {
    border: '2px solid #16a34a',
    background: 'linear-gradient(135deg, #ecfdf5, #d1fae5)',
    boxShadow: '0 4px 12px rgba(22,163,74,0.2)',
  },
  tileName: { fontSize: '13px', fontWeight: '700', color: '#1a1a2e', marginBottom: '4px', lineHeight: '1.3' },
  tileCode: { fontSize: '10px', color: '#888', fontWeight: '600', letterSpacing: '0.5px', textTransform: 'uppercase' },
  tileBadge: {
    position: 'absolute', top: '6px', right: '6px',
    background: '#16a34a', color: '#fff', fontSize: '9px', fontWeight: '700',
    padding: '2px 6px', borderRadius: '4px', letterSpacing: '0.5px',
  },

  listItem: {
    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
    padding: '10px 12px', borderBottom: '1px solid #f0f0f0',
    gap: '12px',
  },
  listName: { flex: '1 1 200px', fontSize: '14px', color: '#222', minWidth: 0 },
  listCode: { fontSize: '11px', color: '#888', fontWeight: '600', marginLeft: '8px' },
  toggle: {
    padding: '6px 14px', borderRadius: '8px', border: 'none',
    fontSize: '12px', fontWeight: '600', cursor: 'pointer',
    minWidth: '80px',
  },
  toggleOn: { background: '#16a34a', color: '#fff' },
  toggleOff: { background: '#e5e7eb', color: '#444' },
  // Big phone-friendly button that opens the dedicated remote page.
  remoteCta: {
    display: 'block', width: '100%',
    padding: '14px', marginBottom: '14px',
    background: 'linear-gradient(135deg, #1e293b, #334155)',
    color: '#fff', border: 'none', borderRadius: '12px',
    fontSize: '16px', fontWeight: '700', cursor: 'pointer',
    boxShadow: '0 2px 8px rgba(15, 23, 42, 0.15)',
    letterSpacing: '0.3px',
  },
  // Bottom setup-info box (Pi URL, registration help). Collapsed by
  // default so it doesn't dominate the page on every visit.
  setupSummary: {
    cursor: 'pointer', fontSize: '13px', fontWeight: '600',
    color: '#475569', padding: '4px 0',
  },
  setupBody: {
    background: '#f0f7ff', border: '1px solid #d0e3f7', borderRadius: '10px',
    padding: '12px 16px', marginTop: '8px',
  },
  setupValue: { fontSize: '12px', color: '#0d3a6b', wordBreak: 'break-all', fontFamily: 'ui-monospace,Consolas,monospace', marginTop: '6px' },
  setupNote: { fontSize: '12px', color: '#666', margin: '6px 0 0' },
  smallBtn: { padding: '4px 10px', borderRadius: '6px', border: 'none', fontSize: '11px', fontWeight: '600', cursor: 'pointer' },
  btnGhost: { background: '#f3f4f6', color: '#666' },
  btnDanger: { background: '#fee2e2', color: '#991b1b' },
});

function timeAgo(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  const diff = Math.floor((Date.now() - d.getTime()) / 1000);
  if (diff < 60) return 'just now';
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

export default function GymTV() {
  const isMobile = useMediaQuery('(max-width: 640px)');
  const s = buildStyles(isMobile);
  const { user } = useAuth();
  const navigate = useNavigate();
  const [programs, setPrograms] = useState([]);
  const [devices, setDevices] = useState([]);
  const [loading, setLoading] = useState(true);
  const [renamingId, setRenamingId] = useState(null);
  const [renameValue, setRenameValue] = useState('');
  const [powerBusy, setPowerBusy] = useState({});   // device_serial -> 'shutdown'|'reboot'
  const [powerMsg, setPowerMsg] = useState({});      // device_serial -> status message

  const load = async () => {
    try {
      const [p, d] = await Promise.all([api.kioskMyPrograms(), api.kioskMyDevices()]);
      setPrograms(p.programs || []);
      setDevices(d.devices || []);
    } catch (e) {
      alert('Failed to load: ' + e.message);
    }
    setLoading(false);
  };
  useEffect(() => { load(); }, []);

  // Tab-back refresh so renames done elsewhere (e.g. RemoteControl) show
  // up here without a manual reload. Also keeps device last-seen timestamps
  // fresh when Glen returns to this tab.
  useEffect(() => {
    const onFocus = () => load();
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, []);

  const kioskLineup = useMemo(() => programs.filter((p) => p.show_on_kiosk), [programs]);

  const toggleKiosk = async (p, show) => {
    try {
      await api.kioskToggle(p.id, show);
      setPrograms((prev) => prev.map((x) => x.id === p.id ? { ...x, show_on_kiosk: show } : x));
    } catch (e) { alert(e.message); }
  };
  const setDeviceProgram = async (deviceId, programId) => {
    try {
      await api.kioskDeviceSetActive(deviceId, programId);
      load();
    } catch (e) { alert(e.message); }
  };
  const startRename = (dev) => { setRenamingId(dev.id); setRenameValue(dev.display_name); };
  const cancelRename = () => { setRenamingId(null); setRenameValue(''); };
  const saveRename = async (id) => {
    try {
      await api.kioskRenameDevice(id, renameValue);
      setRenamingId(null);
      load();
    } catch (e) { alert(e.message); }
  };
  const deleteDevice = async (dev) => {
    if (!confirm(`Remove ${dev.display_name}? The Pi will re-register itself the next time it boots.`)) return;
    try {
      await api.kioskDeleteDevice(dev.id);
      load();
    } catch (e) { alert(e.message); }
  };
  // Per-device shutdown / reboot (queues a command the Pi pulls on its next
  // poll). Mirrors the Gym TV Power card, just scoped to one device here.
  const sendPower = async (kind, dev) => {
    const serial = dev.device_serial;
    const name = dev.display_name || 'this TV';
    const ok = window.confirm(kind === 'shutdown'
      ? `Shut down “${name}” now? It halts within ~10s — power it back on to use it again.`
      : `Reboot “${name}” now? It comes back up on its own in about a minute.`);
    if (!ok) return;
    setPowerBusy((b) => ({ ...b, [serial]: kind }));
    setPowerMsg((m) => ({ ...m, [serial]: null }));
    try {
      const res = await (kind === 'shutdown' ? api.kioskShutdown(serial) : api.kioskPiReboot(serial));
      setPowerMsg((m) => ({ ...m, [serial]: res?.success
        ? (kind === 'shutdown' ? 'Shutdown queued — give it 10–15s, then unplug.' : 'Reboot queued — back up in about a minute.')
        : (res?.message || 'Command failed.') }));
    } catch (e) {
      setPowerMsg((m) => ({ ...m, [serial]: e.message || 'Network error.' }));
    } finally {
      setPowerBusy((b) => ({ ...b, [serial]: null }));
    }
  };
  const setDeviceLayout = async (deviceId, layout) => {
    try {
      await api.kioskDeviceSetLayout(deviceId, layout);
      load();
    } catch (e) { alert(e.message); }
  };

  if (loading) return <div style={{ textAlign: 'center', padding: '60px', color: '#888' }}>Loading...</div>;

  const piUrl = `https://bestrongagain.netlify.app/tv/static?pi=${user?.id || ''}&device=\${SERIAL}`;

  return (
    <div style={s.page}>
      <h1 style={s.title}>Gym TV</h1>
      <p style={s.sub}>Pick what plays on each gym TV. Tap Remote Control to drive week & day from your phone.</p>

      {/* DEVICES — collapsible. The device picker is the main use case,
          so it's default-open. Collapse to compress the page when juggling
          multiple Pis. */}
      <details style={s.section} open>
        <summary style={{ ...s.sectionTitle, cursor: 'pointer', userSelect: 'none' }}>
          Your Devices ({devices.length})
        </summary>
        {devices.length === 0 ? (
          <div style={s.empty}>No devices registered yet. Boot a Pi pointed at the URL above and it'll show up here.</div>
        ) : (
          [...devices].sort((a, b) => {
            const aOn = a.last_seen_at && (Date.now() - new Date(a.last_seen_at).getTime()) < 120000;
            const bOn = b.last_seen_at && (Date.now() - new Date(b.last_seen_at).getTime()) < 120000;
            if (aOn && !bOn) return -1;
            if (!aOn && bOn) return 1;
            return 0;
          }).map((dev) => {
            const isRenaming = renamingId === dev.id;
            const isOnline = dev.last_seen_at && (Date.now() - new Date(dev.last_seen_at).getTime()) < 120000;
            if (!isOnline) {
              return (
                <details key={dev.id} style={{ ...s.deviceCard, opacity: 0.6, borderColor: '#e5e7eb' }}>
                  <summary style={{ cursor: 'pointer', userSelect: 'none', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <span style={{ display: 'inline-block', width: '8px', height: '8px', borderRadius: '50%', background: '#ef4444' }} />
                      <span style={s.deviceName}>{dev.display_name}</span>
                      <span style={{ fontSize: '11px', color: '#ef4444', fontWeight: '700' }}>Not Connected</span>
                    </div>
                    <span style={{ fontSize: '11px', color: '#888' }}>last seen {timeAgo(dev.last_seen_at)}</span>
                  </summary>
                  <div style={{ paddingTop: '12px' }}>
                    <div style={s.deviceMeta}>
                      <span>serial: {dev.device_serial?.slice(-8) || 'unknown'}</span>
                    </div>
                    <div style={{ ...s.deviceActions, marginTop: '8px' }}>
                      <button style={{ ...s.smallBtn, ...s.btnGhost }} onClick={() => startRename(dev)}>Rename</button>
                      <button style={{ ...s.smallBtn, ...s.btnDanger }} onClick={() => deleteDevice(dev)}>Delete</button>
                    </div>
                  </div>
                </details>
              );
            }
            return (
              <div key={dev.id} style={s.deviceCard}>
                <div style={s.deviceHeader}>
                  <div>
                    {isRenaming ? (
                      <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
                        <input
                          autoFocus
                          value={renameValue}
                          onChange={(e) => setRenameValue(e.target.value)}
                          onKeyDown={(e) => { if (e.key === 'Enter') saveRename(dev.id); if (e.key === 'Escape') cancelRename(); }}
                          style={s.deviceNameInput}
                        />
                        <button style={{ ...s.smallBtn, background: '#16a34a', color: '#fff' }} onClick={() => saveRename(dev.id)}>Save</button>
                        <button style={{ ...s.smallBtn, ...s.btnGhost }} onClick={cancelRename}>Cancel</button>
                      </div>
                    ) : (
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <span style={{ display: 'inline-block', width: '8px', height: '8px', borderRadius: '50%', background: '#22c55e' }} />
                        <span style={s.deviceName}>{dev.display_name}</span>
                        <span style={{ fontSize: '11px', color: '#22c55e', fontWeight: '700' }}>Connected</span>
                      </div>
                    )}
                    <div style={s.deviceMeta}>
                      <span>serial: {dev.device_serial?.slice(-8) || 'unknown'}</span>
                      <span>· last seen {timeAgo(dev.last_seen_at)}</span>
                    </div>
                  </div>
                  {!isRenaming && (
                    <div style={s.deviceActions}>
                      <button style={{ ...s.smallBtn, ...s.btnGhost }} onClick={() => startRename(dev)}>Rename</button>
                      <button style={{ ...s.smallBtn, ...s.btnDanger }} onClick={() => deleteDevice(dev)}>Delete</button>
                    </div>
                  )}
                </div>

                {dev.display_mode === 'leaderboard' ? (
                  <div style={{ ...s.activeBanner, background: 'linear-gradient(135deg, #fef3c7, #fde68a)', border: '1px solid #fbbf24' }}>
                    <span><span style={{ ...s.activeLabel, color: '#92400e' }}>On TV now:</span> 📊 Leaderboard{dev.display_metric_id ? ' (locked metric)' : ' (auto-rotating)'}</span>
                  </div>
                ) : dev.display_mode && dev.display_mode.startsWith('game_') ? (
                  <div style={{ ...s.activeBanner, background: 'linear-gradient(135deg, #ede9fe, #ddd6fe)', border: '1px solid #8b5cf6' }}>
                    <span><span style={{ ...s.activeLabel, color: '#5b21b6' }}>On TV now:</span> 🎮 {dev.display_mode.replace('game_', '').toUpperCase()} Arcade</span>
                  </div>
                ) : dev.access_code ? (
                  <div style={s.activeBanner}>
                    <span><span style={s.activeLabel}>On TV now:</span> {dev.program_name}{dev.program_nickname ? <span style={{ color: '#667eea', fontWeight: 600 }}> · {dev.program_nickname}</span> : null} <span style={{ color: '#888' }}>(Code {dev.access_code})</span></span>
                    <button style={{ ...s.smallBtn, ...s.btnGhost }} onClick={() => setDeviceProgram(dev.id, null)}>Clear</button>
                  </div>
                ) : (
                  <div style={s.idleBanner}>Idle — pick a program below.</div>
                )}

                {/* Big phone-friendly Remote Control button — opens the
                    dedicated remote page where the coach can drive the TV
                    week/day from their phone, no IR remote needed. */}
                {dev.access_code && (
                  <button
                    type="button"
                    onClick={() => navigate(`/gym-tv/remote/${dev.id}`)}
                    style={s.remoteCta}
                  >
                    📱 Remote Control
                  </button>
                )}

                {/* Per-device power — shut down or reboot just this Pi. */}
                <div style={{ display: 'flex', gap: '8px', marginBottom: '8px', flexWrap: 'wrap' }}>
                  <button
                    type="button"
                    disabled={!!powerBusy[dev.device_serial]}
                    onClick={() => sendPower('shutdown', dev)}
                    style={{ ...s.smallBtn, flex: 1, color: '#fff', background: 'linear-gradient(135deg,#1a1a2e,#2d2d4a)', opacity: powerBusy[dev.device_serial] ? 0.6 : 1 }}
                  >
                    {powerBusy[dev.device_serial] === 'shutdown' ? 'Sending…' : '⏻ Shutdown'}
                  </button>
                  <button
                    type="button"
                    disabled={!!powerBusy[dev.device_serial]}
                    onClick={() => sendPower('reboot', dev)}
                    style={{ ...s.smallBtn, flex: 1, color: '#fff', background: 'linear-gradient(135deg,#667eea,#764ba2)', opacity: powerBusy[dev.device_serial] ? 0.6 : 1 }}
                  >
                    {powerBusy[dev.device_serial] === 'reboot' ? 'Sending…' : '↻ Reboot'}
                  </button>
                </div>
                {powerMsg[dev.device_serial] && (
                  <div style={{ fontSize: '12px', color: '#065f46', background: '#ecfdf5', padding: '6px 10px', borderRadius: 6, marginBottom: '12px' }}>
                    {powerMsg[dev.device_serial]}
                  </div>
                )}

                {/* Layout picker — how the TV arranges the workout on screen */}
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '12px', flexWrap: 'wrap' }}>
                  <span style={{ fontSize: '12px', fontWeight: '700', color: '#444', textTransform: 'uppercase', letterSpacing: '0.5px' }}>View Mode:</span>
                  <select
                    value={dev.layout || 'two_day'}
                    onChange={(e) => setDeviceLayout(dev.id, e.target.value)}
                    style={{ padding: '6px 10px', border: '1px solid #d1d5db', borderRadius: '8px', fontSize: '13px', background: '#fff' }}
                  >
                    <option value="two_day">Two-Day View (today + tomorrow)</option>
                    <option value="wod">Today's Grind (single day, fullwidth)</option>
                    <option value="wod_scaled">Grind + Scaled (Rx + regression)</option>
                  </select>
                </div>


                {kioskLineup.length === 0 ? (
                  <div style={{ fontSize: '13px', color: '#888' }}>No programs in your kiosk lineup yet — scroll down and flip some on.</div>
                ) : (
                  <div style={s.tilesGrid}>
                    {kioskLineup.map((p) => {
                      const isActive = p.id === dev.active_program_id;
                      return (
                        <button
                          key={p.id}
                          onClick={() => setDeviceProgram(dev.id, p.id)}
                          style={{ ...s.tile, ...(isActive ? s.tileActive : {}) }}
                        >
                          {isActive && <span style={s.tileBadge}>ON TV</span>}
                          <div style={s.tileName}>
                            {p.program_name || 'Untitled'}
                            {p.program_nickname ? <span style={{ fontWeight: 600, color: '#667eea' }}> · {p.program_nickname}</span> : null}
                          </div>
                          <div style={s.tileCode}>Code {p.access_code}</div>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })
        )}
      </details>

      {/* Full programs list — collapsible because the list grows fast and
          starts dominating the page after a coach has built 20+ programs.
          Default-closed: the daily workflow is "tap a tile on the device
          card above," not "browse the whole catalog." */}
      <details style={s.section} id="programs-list">
        <summary style={{ ...s.sectionTitle, cursor: 'pointer', userSelect: 'none' }}>
          All Your Programs ({programs.length})
        </summary>
        <p style={{ fontSize: '13px', color: '#666', margin: '10px 0' }}>
          Flip the toggle to add a program to your kiosk lineup (shared across all your TVs).
        </p>
        {programs.length === 0 ? (
          <div style={s.empty}>No programs built yet.</div>
        ) : (
          programs.map((p) => (
            <div key={p.id} style={s.listItem}>
              <div style={s.listName}>
                {p.program_name || 'Untitled'}
                {p.program_nickname ? <span style={{ fontWeight: 600, color: '#667eea' }}> · {p.program_nickname}</span> : null}
                <span style={s.listCode}>{p.access_code}</span>
              </div>
              <button
                style={{ ...s.toggle, ...(p.show_on_kiosk ? s.toggleOn : s.toggleOff) }}
                onClick={() => toggleKiosk(p, !p.show_on_kiosk)}
              >
                {p.show_on_kiosk ? 'On Kiosk' : 'Add'}
              </button>
            </div>
          ))
        )}
      </details>

      {/* Game Mode — admin-only retro emulator launcher. Flips a kiosk Pi
          from the workout TV view into a NES/SNES arcade for the gym's
          rest periods or after-hours kid time. Discreet by design (only
          Glen sees it for now); coach role doesn't render this. */}
      {user?.role === 'admin' && <GameModeCard devices={devices} isMobile={isMobile} onChange={load} />}

      {/* Setup info — collapsed by default; only useful when first installing
          a new Pi. Lives at the bottom of the page so it doesn't clutter the
          daily-use surface. */}
      <details style={{ marginTop: '8px' }}>
        <summary style={s.setupSummary}>⚙️ Pi setup info (only needed when installing a new TV)</summary>
        <div style={s.setupBody}>
          <p style={{ fontSize: '13px', color: '#444', margin: 0 }}>
            Every Pi self-registers by its CPU serial when it first boots. The
            startup script substitutes <code>$&#123;SERIAL&#125;</code> from{' '}
            <code>/proc/cpuinfo</code> below, then the new device shows up at
            the top of the page.
          </p>
          <div style={s.setupValue}>{piUrl}</div>
          <p style={s.setupNote}>
            Need a fresh Pi? See the{' '}
            <a href="https://github.com/Glen-collab/bsa-tv-kiosk" target="_blank" rel="noreferrer">
              bsa-tv-kiosk
            </a>{' '}
            repo for the install script.
          </p>
        </div>
      </details>
    </div>
  );
}
