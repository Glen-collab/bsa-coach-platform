// GymTV.jsx — coach-facing kiosk control panel (per-device).
// Flip programs in/out of the kiosk lineup, then pick an active program for each
// registered Pi device. Pis self-register on first boot via CPU serial.

import { useEffect, useState, useMemo } from 'react';
import { useAuth } from '../hooks/useAuth';
import { api } from '../utils/api';
import useMediaQuery from '../hooks/useMediaQuery';

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
  const [programs, setPrograms] = useState([]);
  const [devices, setDevices] = useState([]);
  const [loading, setLoading] = useState(true);
  const [renamingId, setRenamingId] = useState(null);
  const [renameValue, setRenameValue] = useState('');

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
      <p style={s.sub}>
        Every Pi self-registers by its CPU serial. Name each device, flip programs into your kiosk lineup, then pick an active program per TV.
      </p>

      {/* Pi configuration URL */}
      <div style={s.piUrlBox}>
        <div style={s.piUrlLabel}>Pi Kiosk URL (${'$'}SERIAL is auto-filled by Pi's startup script)</div>
        <div style={s.piUrlValue}>{piUrl}</div>
        <p style={{ fontSize: '12px', color: '#666', margin: '6px 0 0' }}>
          Pi's startup reads <code>/proc/cpuinfo</code> and substitutes its serial. First boot auto-registers below.
        </p>
      </div>

      {/* DEVICES */}
      <div style={s.section}>
        <div style={s.sectionTitle}>Your Devices ({devices.length})</div>
        {devices.length === 0 ? (
          <div style={s.empty}>No devices registered yet. Boot a Pi pointed at the URL above and it'll show up here.</div>
        ) : (
          devices.map((dev) => {
            const isRenaming = renamingId === dev.id;
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
                      <div style={s.deviceName}>{dev.display_name}</div>
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

                {dev.access_code ? (
                  <div style={s.activeBanner}>
                    <span><span style={s.activeLabel}>On TV now:</span> {dev.program_name} <span style={{ color: '#888' }}>(Code {dev.access_code})</span></span>
                    <button style={{ ...s.smallBtn, ...s.btnGhost }} onClick={() => setDeviceProgram(dev.id, null)}>Clear</button>
                  </div>
                ) : (
                  <div style={s.idleBanner}>Idle — pick a program below.</div>
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
                    <option value="wod">WOD Only (single day, fullwidth)</option>
                    <option value="wod_scaled">WOD + Scaled (Rx + regression)</option>
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
                          <div style={s.tileName}>{p.program_name || 'Untitled'}</div>
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
      </div>

      {/* Full programs list */}
      <div style={s.section}>
        <div style={s.sectionTitle}>All Your Programs ({programs.length})</div>
        <p style={{ fontSize: '13px', color: '#666', marginBottom: '10px' }}>
          Flip the toggle to add a program to your kiosk lineup (shared across all your TVs).
        </p>
        {programs.length === 0 ? (
          <div style={s.empty}>No programs built yet.</div>
        ) : (
          programs.map((p) => (
            <div key={p.id} style={s.listItem}>
              <div style={s.listName}>
                {p.program_name || 'Untitled'}
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
      </div>
    </div>
  );
}
