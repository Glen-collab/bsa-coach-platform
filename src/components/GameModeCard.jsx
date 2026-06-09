// GameModeCard — admin-only retro emulator launcher on the GymTV page.
// Lets Glen (admin) flip a specific Pi from the workout TV view into a
// NES or SNES arcade. Posts mode='game_nes' | 'game_snes' to the
// existing /api/kiosk/device/set-display endpoint; the Pi-side kiosk
// agent polls /tv-config every 60s, notices the mode change, and
// execs the mode-switcher script which kills Chromium and launches
// RetroArch with the right core. Stop reverts to mode='workout'.

import { useState } from 'react';
import { api } from '../utils/api.jsx';

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
  pickerBtn: {
    padding: '10px 14px',
    borderRadius: '8px',
    border: '1px solid rgba(56,189,248,0.4)',
    background: 'rgba(56,189,248,0.15)',
    color: '#bae6fd',
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

export default function GameModeCard({ devices = [], isMobile, onChange }) {
  const s = styles(isMobile);
  const [busyDeviceId, setBusyDeviceId] = useState(null);
  // Default-collapsed — Game Mode is an occasional admin flip, not the
  // daily workflow. Header stays visible so Glen can see/expand it fast.
  const [open, setOpen] = useState(false);

  // Maps the UI label to the backend mode. The Stop button reverts the
  // device to 'workout' which both clears game mode and restores the
  // normal workout-TV behavior.
  const SYSTEM_TO_MODE = { NES: 'game_nes', SNES: 'game_snes', N64: 'game_n64', GBA: 'game_gba' };

  const setMode = async (device, mode, label) => {
    setBusyDeviceId(device.id);
    try {
      await api.kioskDeviceSetDisplay(device.id, { mode });
      onChange?.();
    } catch (e) {
      alert(`Failed to ${label} on "${device.display_name}": ${e.message}`);
    } finally {
      setBusyDeviceId(null);
    }
  };
  const handleLaunch = (device, system) => setMode(device, SYSTEM_TO_MODE[system], `launch ${system}`);
  const handleStop   = (device)         => setMode(device, 'workout', 'stop game mode');

  const handleLoadGame = async (device) => {
    setBusyDeviceId(device.id);
    try {
      await api.kioskPiQuitGame();
    } catch (e) {
      alert(`Failed to load picker on "${device.display_name}": ${e.message}`);
    } finally {
      setBusyDeviceId(null);
    }
  };

  return (
    <div style={s.card}>
      <div
        style={{ ...s.header, cursor: 'pointer', userSelect: 'none', justifyContent: 'space-between' }}
        onClick={() => setOpen((v) => !v)}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setOpen((v) => !v); } }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <span style={{ fontSize: '20px' }}>🎮</span>
          <h2 style={s.title}>Game Mode</h2>
          <span style={s.adminBadge}>Admin</span>
        </div>
        <span style={{ color: '#fbbf24', fontSize: 14, transform: open ? 'rotate(90deg)' : 'rotate(0deg)', transition: 'transform 0.15s' }}>▶</span>
      </div>
      {!open && (<></>)}
      {open && (<>
      <p style={s.sub}>
        Flip a kiosk Pi from the workout TV into a retro arcade.
        Use during gym off-hours or when kids need a break between sets.
      </p>

      {devices.length === 0 ? (
        <div style={s.empty}>No Pi devices registered yet.</div>
      ) : (
        devices.map((dev) => {
          const inGameMode = dev.display_mode?.startsWith('game_');
          const MODE_LABELS = { game_nes: 'NES', game_snes: 'SNES', game_n64: 'N64', game_gba: 'GBA' };
          const nowShowing = inGameMode
            ? `🎮 ${MODE_LABELS[dev.display_mode] || dev.display_mode}`
            : (dev.program_name || 'Idle');
          const systems = (dev.available_systems || 'nes,snes').split(',').map(s => s.trim().toUpperCase());
          return (
          <div key={dev.id} style={s.deviceRow}>
            <div style={s.deviceName}>{dev.display_name}</div>
            <div style={s.deviceState}>
              Now showing: <b>{nowShowing}</b> · serial …{dev.device_serial?.slice(-6) || '????'}
            </div>
            <div style={s.buttonRow}>
              {systems.map(sys => (
                <button
                  key={sys}
                  style={s.systemBtn}
                  disabled={busyDeviceId === dev.id}
                  onClick={() => handleLaunch(dev, sys)}
                >▶ {sys}</button>
              ))}
              <button
                style={s.pickerBtn}
                disabled={busyDeviceId === dev.id || !inGameMode}
                onClick={() => handleLoadGame(dev)}
                title="Kill the running game and drop back to the picker without leaving arcade mode"
              >🎮 Load Game</button>
              <button
                style={s.stopBtn}
                disabled={busyDeviceId === dev.id || !inGameMode}
                onClick={() => handleStop(dev)}
              >⏹ Stop</button>
            </div>
          </div>
          );
        })
      )}

      <div style={s.setupNote}>
        🟡 <b>Pi-side install required.</b> Backend wired — Pi needs
        RetroArch + ROMs + the kiosk-agent mode-switcher hook to honor
        these. Setup steps in <code>bsa-tv-kiosk/docs/RETRO_GAMES_PLAN.md</code>.
      </div>
      </>)}
    </div>
  );
}
