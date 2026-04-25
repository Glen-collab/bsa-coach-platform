// BroadcastCard.jsx — collapsible card on coach dashboard that lets a coach
// mass-message all their clients (referred members + tracker users on coach's
// programs who have accounts). Shows a live count of reachable clients.

import { useState, useEffect } from 'react';
import { api } from '../utils/api';

export default function BroadcastCard({ isMobile }) {
  const [open, setOpen] = useState(false);
  const [count, setCount] = useState(null);
  const [body, setBody] = useState('');
  const [sending, setSending] = useState(false);
  const [status, setStatus] = useState(null);

  const refreshCount = () => {
    api.broadcastAudience().then((r) => setCount(r.count ?? 0)).catch(() => setCount(0));
  };
  useEffect(() => { refreshCount(); }, []);

  const send = async () => {
    const txt = body.trim();
    if (!txt) { setStatus({ ok: false, msg: 'Type a message first.' }); return; }
    if (!confirm(`Send this to all ${count} of your clients?`)) return;
    setSending(true); setStatus(null);
    try {
      const r = await api.broadcastSend(txt);
      if (r.success) {
        setStatus({ ok: true, msg: `Sent to ${r.sent} client${r.sent === 1 ? '' : 's'}. They'll see it in their tracker chat.` });
        setBody('');
      } else {
        setStatus({ ok: false, msg: r.error || 'Send failed' });
      }
    } catch (e) {
      setStatus({ ok: false, msg: e.message || 'Send failed' });
    } finally {
      setSending(false);
    }
  };

  const s = {
    card: { background: '#fff', borderRadius: '14px', padding: isMobile ? '14px' : '20px', marginBottom: '16px', boxShadow: '0 2px 10px rgba(0,0,0,0.05)' },
    titleRow: { width: '100%', textAlign: 'left', background: 'none', border: 'none', cursor: 'pointer', padding: 0, display: 'flex', alignItems: 'center', justifyContent: 'space-between' },
    title: { fontSize: isMobile ? '16px' : '18px', fontWeight: 800, color: '#1a1a2e', margin: 0 },
    pill: { fontSize: '12px', background: '#0284c7', color: '#fff', padding: '3px 10px', borderRadius: '999px', marginLeft: '10px', fontWeight: 700 },
    sub: { fontSize: '12px', color: '#888', marginTop: '2px' },
    chev: { fontSize: '20px', color: '#888', transform: open ? 'rotate(180deg)' : 'none', transition: 'transform .15s' },
    textarea: { width: '100%', minHeight: '110px', padding: '12px', border: '1.5px solid #d1d5db', borderRadius: '8px', fontSize: '14px', fontFamily: 'inherit', boxSizing: 'border-box', resize: 'vertical' },
    count: { fontSize: '12px', color: '#666', marginTop: '6px' },
    btn: { marginTop: '12px', padding: '11px 18px', border: 'none', borderRadius: '8px', background: 'linear-gradient(135deg, #0284c7, #0369a1)', color: '#fff', fontSize: '14px', fontWeight: 800, cursor: sending ? 'wait' : 'pointer', opacity: sending ? 0.6 : 1 },
    status: { marginTop: '10px', padding: '10px 12px', borderRadius: '8px', fontSize: '13px', lineHeight: 1.4 },
    ok: { background: '#ecfdf5', color: '#065f46' },
    err: { background: '#fef2f2', color: '#b91c1c' },
  };

  return (
    <div style={s.card}>
      <button style={s.titleRow} onClick={() => setOpen((v) => !v)}>
        <div>
          <h3 style={s.title}>
            📣 Message All Clients
            {count != null && <span style={s.pill}>{count} will receive</span>}
          </h3>
          <div style={s.sub}>Tap to {open ? 'collapse' : 'expand'}</div>
        </div>
        <span style={s.chev}>▾</span>
      </button>
      {open && (
        <div style={{ marginTop: '14px' }}>
          <p style={{ fontSize: '13px', color: '#555', margin: '0 0 10px', lineHeight: 1.5 }}>
            This sends one message to <strong>every client on your roster with an account</strong> (referred members + tracker users signed in via email link).
            Each will see it in their 💬 chat bubble with a "from your coach" badge and can reply.
          </p>
          <textarea
            style={s.textarea}
            placeholder="e.g. Reminder: Saturday class at 9am. Bring water!"
            value={body}
            onChange={(e) => setBody(e.target.value.slice(0, 2000))}
            maxLength={2000}
          />
          <div style={s.count}>{body.length} / 2000</div>
          <button style={s.btn} disabled={sending || !body.trim()} onClick={send}>
            {sending ? 'Sending…' : `Send to ${count ?? '…'} clients`}
          </button>
          {status && <div style={{ ...s.status, ...(status.ok ? s.ok : s.err) }}>{status.msg}</div>}
        </div>
      )}
    </div>
  );
}
