// GameModeCard — admin-only retro emulator launcher on the GymTV page.
// Lets Glen (admin) flip a specific Pi from the workout TV view into a
// NES or SNES arcade. Scaffold for now — buttons render but the actual
// launch happens once the Pi-side RetroPie + bsa-mode-switcher daemon
// is installed (tracked in bsa-tv-kiosk/docs/RETRO_GAMES_PLAN.md).
//
// When Pi-side is live, swap the alert() in handleLaunch for a real
// api.kioskDeviceSetGameMode(deviceId, system) call.

import { useState } from 'react';

const styles = (isMobile) => ({
  card: {
    background: 'linear-gradient(135deg, #1e1b4b 0%, #312e81 50%, #1e1b4b 100%)',
    borderRadius: '14px',
    padding: isMobile ? '14px' : '20px',
    marginBottom: '16px',
    color: '#fff',
    boxShadow: '0 4px 14px rgba(30, 27, 75, 0.3)',
  },
  header: {
    display: 'flex', alignItems: 'center', gap: '10px',
    marginBottom: '6px',
  },
  title: {
    fontSize: isMobile ? '16px' : '18px',
    fontWeight: '800',
    background: 'linear-gradient(135deg, #fbbf24, #f59e0b)',
    WebkitBackgroundClip: 'text', backgroundClip: 'text',
    color: 'transparent',
  },
  adminBadge: {
    fontSize: '9px', fontWeight: '700', letterSpacing: '1px',
    background: 'rgba(251, 191, 36, 0.2)', color: '#fbbf24',
    padding: '2px 6px', borderRadius: '4px',
    textTransform: 'uppercase',
  },
  sub: {
    fontSize: '12px', color: 'rgba(255,255,255,0.6)',
    marginBottom: '14px', lineHeight: '1.4',
  },
  deviceRow: {
    background: 'rgba(0,0,0,0.25)',
    border: '1px solid rgba(255,255,255,0.08)',
    borderRadius: '10px',
    padding: '12px',
    marginBottom: '10px',
  },
  deviceName: {
    fontSize: '14px', fontWeight: '700',
    marginBottom: '4px',
  },
  deviceState: {
    fontSize: '11px',
    color: 'rgba(255,255,255,0.55)',
    marginBottom: '10px',
  },
  buttonRow: {
    display: 'flex', flexWrap: 'wrap', gap: '6px',
  },
  systemBtn: {
    flex: 1, minWidth: '90px',
    padding: '10px 12px',
    borderRadius: '8px',
    border: '1px solid rgba(255,255,255,0.15)',
    background: 'rgba(255,255,255,0.06)',
    color: '#fff',
    fontSize: '13px', fontWeight: '700',
    cursor: 'pointer',
  },
  stopBtn: {
    padding: '10px 14px',
    borderRadius: '8px',
    border: '1px solid rgba(220,38,38,0.4)',
    background: 'rgba(220,38,38,0.15)',
    color: '#fecaca',
    fontSize: '13px', fontWeight: '700',
    cursor: 'pointer',
  },
  empty: {
    fontSize: '12px', color: 'rgba(255,255,255,0.5)',
    fontStyle: 'italic', padding: '10px 0',
  },
  setupNote: {
    background: 'rgba(251, 191, 36, 0.1)',
    border: '1px solid rgba(251, 191, 36, 0.3)',
    borderRadius: '8px',
    padding: '8px 12px',
    fontSize: '11px',
    color: 'rgba(255, 230, 180, 0.85)',
    marginTop: '12px',
    lineHeight: '1.4',
  },
});

export default function GameModeCard({ devices = [], isMobile }) {
  const s = styles(isMobile);
  const [busyDeviceId, setBusyDeviceId] = useState(null);

  // Placeholder until the Pi-side launcher is wired. When it is, swap
  // these alerts for real api.kioskDeviceSetGameMode(deviceId, system).
  const handleLaunch = (device, system) => {
    setBusyDeviceId(device.id);
    setTimeout(() => setBusyDeviceId(null), 800);
    alert(
      `Game Mode — ${system} launch on "${device.display_name}"\n\n` +
      `Pi-side install required: see\n` +
      `Glen-collab/bsa-tv-kiosk/docs/RETRO_GAMES_PLAN.md\n\n` +
      `(After RetroPie + bsa-mode-switcher are set up, this button will ` +
      `flip the Pi from workout view to ${system} game grid.)`
    );
  };
  const handleStop = (device) => {
    setBusyDeviceId(device.id);
    setTimeout(() => setBusyDeviceId(null), 800);
    alert(`Game Mode — stop on "${device.display_name}" (placeholder).`);
  };

  return (
    <div style={s.card}>
      <div style={s.header}>
        <span style={{ fontSize: '20px' }}>🎮</span>
        <h2 style={s.title}>Game Mode</h2>
        <span style={s.adminBadge}>Admin</span>
      </div>
      <p style={s.sub}>
        Flip a kiosk Pi from the workout TV into a retro arcade (NES / SNES).
        Use during gym off-hours or when kids need a break between sets.
      </p>

      {devices.length === 0 ? (
        <div style={s.empty}>No Pi devices registered yet.</div>
      ) : (
        devices.map((dev) => (
          <div key={dev.id} style={s.deviceRow}>
            <div style={s.deviceName}>{dev.display_name}</div>
            <div style={s.deviceState}>
              Now showing: <b>{dev.program_name || 'Idle'}</b> · serial …{dev.device_serial?.slice(-6) || '????'}
            </div>
            <div style={s.buttonRow}>
              <button
                style={s.systemBtn}
                disabled={busyDeviceId === dev.id}
                onClick={() => handleLaunch(dev, 'NES')}
              >▶ NES</button>
              <button
                style={s.systemBtn}
                disabled={busyDeviceId === dev.id}
                onClick={() => handleLaunch(dev, 'SNES')}
              >▶ SNES</button>
              <button
                style={s.stopBtn}
                disabled={busyDeviceId === dev.id}
                onClick={() => handleStop(dev)}
              >⏹ Stop</button>
            </div>
          </div>
        ))
      )}

      <div style={s.setupNote}>
        🟡 <b>Pi-side install required.</b> RetroPie + the bsa-mode-switcher
        daemon need to be installed on each Pi for these buttons to do
        anything. Setup steps in <code>bsa-tv-kiosk/docs/RETRO_GAMES_PLAN.md</code>.
      </div>
    </div>
  );
}
