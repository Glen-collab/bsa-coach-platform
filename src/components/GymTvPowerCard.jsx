// GymTvPowerCard — remote Pi power controls (Shutdown / Reboot).
// Both queue commands the Pi picks up within ~10 seconds via the
// bsa-kiosk-agent.service. Used on both CoachDashboard and AdminDashboard.

import { useState } from 'react';
import { api } from '../utils/api';

export default function GymTvPowerCard({ isMobile, s }) {
  const [busy, setBusy] = useState(null); // 'shutdown' | 'reboot' | null
  const [msg, setMsg]   = useState(null);

  const send = async (kind) => {
    const confirmText = kind === 'shutdown'
      ? 'Shut down the gym TV now? The Pi will halt within ~10 seconds.'
      : 'Reboot the gym TV now? The Pi will come back up on its own.';
    if (!window.confirm(confirmText)) return;
    setBusy(kind);
    setMsg(null);
    try {
      const res = kind === 'shutdown' ? await api.kioskShutdown() : await api.kioskPiReboot();
      if (res?.success) {
        setMsg(kind === 'shutdown'
          ? 'Shutdown queued. Give it 10–15 seconds, then unplug.'
          : 'Reboot queued. TV will come back up in about a minute.');
      } else {
        setMsg(res?.message || 'Command failed.');
      }
    } catch (e) {
      setMsg(e.message || 'Network error.');
    } finally {
      setBusy(null);
    }
  };

  return (
    <div style={s.card}>
      <div style={s.cardTitle}>Gym TV Power</div>
      <div style={{ fontSize: 13, color: '#666', marginBottom: 12, lineHeight: 1.4 }}>
        Graceful remote control for your Pi-powered gym TV. Use Shutdown before
        you leave for the night so the Pi halts cleanly instead of getting its
        power yanked.
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr 1fr' : 'auto auto 1fr', gap: 10, alignItems: 'center' }}>
        <button
          onClick={() => send('shutdown')}
          disabled={busy !== null}
          style={{ ...s.toolBtn, background: 'linear-gradient(135deg, #1a1a2e, #2d2d4a)', opacity: busy ? 0.6 : 1 }}
        >
          {busy === 'shutdown' ? 'Sending…' : 'Shutdown TV'}
        </button>
        <button
          onClick={() => send('reboot')}
          disabled={busy !== null}
          style={{ ...s.toolBtn, background: 'linear-gradient(135deg, #667eea, #764ba2)', opacity: busy ? 0.6 : 1 }}
        >
          {busy === 'reboot' ? 'Sending…' : 'Reboot TV'}
        </button>
        {msg && (
          <div style={{ fontSize: 12, color: '#065f46', background: '#ecfdf5', padding: '8px 12px', borderRadius: 8, gridColumn: isMobile ? '1 / -1' : 'auto' }}>
            {msg}
          </div>
        )}
      </div>
    </div>
  );
}
