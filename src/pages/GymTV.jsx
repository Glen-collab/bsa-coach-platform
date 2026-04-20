// GymTV.jsx — coach-facing kiosk control panel.
// Flip programs on/off the kiosk lineup, then tap a tile to make it the active
// program on any Pi TV running with ?pi=<coach_id>.

import { useEffect, useState, useMemo } from 'react';
import { useAuth } from '../hooks/useAuth';
import { api } from '../utils/api';
import useMediaQuery from '../hooks/useMediaQuery';

const buildStyles = (isMobile) => ({
  page: { maxWidth: '1000px', margin: '0 auto', padding: isMobile ? '16px 12px' : '32px 24px' },
  title: { fontSize: isMobile ? '22px' : '28px', fontWeight: '800', marginBottom: '4px' },
  sub: { fontSize: '14px', color: '#666', marginBottom: '18px', lineHeight: '1.5' },
  piUrlBox: {
    background: '#f0f7ff', border: '1px solid #d0e3f7', borderRadius: '10px',
    padding: '12px 16px', marginBottom: '20px',
  },
  piUrlLabel: { fontSize: '11px', fontWeight: '700', color: '#1565c0', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '4px' },
  piUrlValue: { fontSize: '13px', color: '#0d3a6b', wordBreak: 'break-all', fontFamily: 'ui-monospace,Consolas,monospace' },
  section: { background: '#fff', borderRadius: '14px', padding: isMobile ? '14px' : '20px', marginBottom: '16px', boxShadow: '0 2px 10px rgba(0,0,0,0.05)' },
  sectionTitle: { fontSize: isMobile ? '16px' : '18px', fontWeight: '700', color: '#1a1a2e', marginBottom: '12px' },
  empty: { color: '#888', fontSize: '14px', padding: '14px', background: '#f8f9fa', borderRadius: '10px', textAlign: 'center' },

  tilesGrid: {
    display: 'grid',
    gridTemplateColumns: isMobile ? 'repeat(2, 1fr)' : 'repeat(auto-fill, minmax(200px, 1fr))',
    gap: '12px',
  },
  tile: {
    position: 'relative',
    padding: '18px 14px', border: '2px solid #e5e7eb', borderRadius: '12px',
    background: '#fafbfd', cursor: 'pointer', textAlign: 'left',
    transition: 'all 120ms',
    minHeight: '90px',
  },
  tileActive: {
    border: '2px solid #16a34a',
    background: 'linear-gradient(135deg, #ecfdf5, #d1fae5)',
    boxShadow: '0 4px 12px rgba(22,163,74,0.2)',
  },
  tileName: { fontSize: '14px', fontWeight: '700', color: '#1a1a2e', marginBottom: '4px', lineHeight: '1.3' },
  tileCode: { fontSize: '11px', color: '#888', fontWeight: '600', letterSpacing: '0.5px', textTransform: 'uppercase' },
  tileBadge: {
    position: 'absolute', top: '8px', right: '8px',
    background: '#16a34a', color: '#fff', fontSize: '10px', fontWeight: '700',
    padding: '3px 8px', borderRadius: '6px', letterSpacing: '0.5px',
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

  clearBtn: {
    padding: '8px 16px', border: '1px solid #e5e7eb', borderRadius: '8px',
    background: '#fff', color: '#666', fontSize: '13px', cursor: 'pointer',
  },
});

export default function GymTV() {
  const isMobile = useMediaQuery('(max-width: 640px)');
  const s = buildStyles(isMobile);
  const { user } = useAuth();
  const [programs, setPrograms] = useState([]);
  const [activeId, setActiveId] = useState(null);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    try {
      const r = await api.kioskMyPrograms();
      setPrograms(r.programs || []);
      setActiveId(r.active_kiosk_program_id);
    } catch (e) {
      alert('Failed to load programs: ' + e.message);
    }
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const kioskLineup = useMemo(() => programs.filter((p) => p.show_on_kiosk), [programs]);

  const toggleKiosk = async (p, show) => {
    try {
      await api.kioskToggle(p.id, show);
      setPrograms((prev) => prev.map((x) => x.id === p.id ? { ...x, show_on_kiosk: show } : x));
    } catch (e) {
      alert(e.message);
    }
  };

  const setActive = async (programId) => {
    try {
      await api.kioskSetActive(programId);
      setActiveId(programId);
    } catch (e) {
      alert(e.message);
    }
  };

  if (loading) return <div style={{ textAlign: 'center', padding: '60px', color: '#888' }}>Loading...</div>;

  const piUrl = `https://bestrongagain.netlify.app/tv/static?pi=${user?.id || ''}`;

  return (
    <div style={s.page}>
      <h1 style={s.title}>Gym TV</h1>
      <p style={s.sub}>
        Pick which programs appear on your gym's Pi-powered TV. Flag programs below, then tap a tile to make it the one currently showing.
      </p>

      {/* Pi configuration URL */}
      <div style={s.piUrlBox}>
        <div style={s.piUrlLabel}>Your Pi's Kiosk URL</div>
        <div style={s.piUrlValue}>{piUrl}</div>
        <p style={{ fontSize: '12px', color: '#666', margin: '6px 0 0' }}>
          Point your Pi at this URL (in <code>~/.config/openbox/autostart</code>). The TV polls this page every minute and switches to whatever program you've selected below.
        </p>
      </div>

      {/* Active lineup (tiles) */}
      <div style={s.section}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
          <div style={s.sectionTitle}>Kiosk Lineup ({kioskLineup.length})</div>
          {activeId && (
            <button style={s.clearBtn} onClick={() => setActive(null)}>Clear active program</button>
          )}
        </div>
        {kioskLineup.length === 0 ? (
          <div style={s.empty}>No programs flagged yet. Flip some on in the list below.</div>
        ) : (
          <div style={s.tilesGrid}>
            {kioskLineup.map((p) => {
              const isActive = p.id === activeId;
              return (
                <button
                  key={p.id}
                  onClick={() => setActive(p.id)}
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

      {/* Full programs list with kiosk toggle */}
      <div style={s.section}>
        <div style={s.sectionTitle}>All Your Programs ({programs.length})</div>
        <p style={{ fontSize: '13px', color: '#666', marginBottom: '10px' }}>
          Flip the toggle to add a program to your Gym TV lineup.
        </p>
        {programs.length === 0 ? (
          <div style={s.empty}>No programs built yet. Go to the Workout Builder to create one.</div>
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
