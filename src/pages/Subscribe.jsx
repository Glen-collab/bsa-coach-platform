import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import useMediaQuery from '../hooks/useMediaQuery';

// PUBLIC subscribe page — the plan picker a paywalled member lands on.
//
// Before this, hitting the end of a free trial in the tracker sent them to
// /login. That is the worst possible moment to ask for a password: they arrived
// intending to pay and got a sign-in form instead, and most stopped there. The
// tracker already knows their email, so it comes along in the URL and the only
// thing left to do is pick a plan.
//
// Tiers mirror the member dashboard's hierarchy on purpose — three coaching
// plans up front, the tracker-only option as a quieter line underneath so it
// doesn't undercut them.
const API = 'https://app.bestrongagain.com/api';

const TIERS = [
  {
    key: 'basic',
    name: 'Basic',
    price: '$20',
    blurb: 'Your program in the app, tracked and saved.',
    perks: ['Your coach-built program', 'Log every set and rep', 'Progress charts + history'],
  },
  {
    key: 'coached',
    name: 'Coached',
    price: '$200',
    blurb: 'Everything in Basic, plus real coaching.',
    perks: ['Programming built around you', 'Check-ins with your coach', 'Adjustments as you progress'],
    featured: true,
  },
  {
    key: 'elite',
    name: 'Elite',
    price: '$400',
    blurb: 'Full concierge coaching.',
    perks: ['Everything in Coached', 'Priority access', 'Hands-on plan management'],
  },
];

export default function Subscribe() {
  const [params] = useSearchParams();
  const isMobile = useMediaQuery('(max-width: 640px)');
  const [email, setEmail] = useState((params.get('email') || '').trim());
  const [busy, setBusy] = useState('');
  const [err, setErr] = useState('');

  const start = async (tier) => {
    const addr = email.trim();
    if (!addr) { setErr('Enter the email your program is under.'); return; }
    setBusy(tier); setErr('');
    try {
      const res = await fetch(`${API}/stripe/checkout`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tier, email: addr }),
      });
      const data = await res.json().catch(() => ({}));
      if (data.checkout_url) { window.location.href = data.checkout_url; return; }
      setErr(data.message || data.error || 'Could not start checkout. Try again.');
    } catch {
      setErr('Could not reach the server. Check your connection and try again.');
    }
    setBusy('');
  };

  const s = {
    page: { minHeight: '100vh', background: 'linear-gradient(135deg,#0f172a,#1e293b)', color: '#fff',
            padding: isMobile ? '28px 16px 48px' : '48px 24px', fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif' },
    wrap: { maxWidth: '960px', margin: '0 auto' },
    h1: { fontSize: isMobile ? '25px' : '32px', fontWeight: 900, textAlign: 'center', margin: '0 0 8px' },
    sub: { textAlign: 'center', color: 'rgba(255,255,255,0.7)', fontSize: '15px', lineHeight: 1.5, margin: '0 0 22px' },
    emailWrap: { maxWidth: '420px', margin: '0 auto 26px' },
    label: { fontSize: '12px', fontWeight: 700, color: 'rgba(255,255,255,0.6)', display: 'block', marginBottom: '6px', letterSpacing: '0.5px' },
    input: { width: '100%', padding: '13px 14px', borderRadius: '10px', border: '2px solid rgba(255,255,255,0.15)',
             background: 'rgba(255,255,255,0.06)', color: '#fff', fontSize: '16px', boxSizing: 'border-box' },
    grid: { display: 'grid', gridTemplateColumns: isMobile ? '1fr' : 'repeat(3,1fr)', gap: '14px' },
    card: (f) => ({ background: f ? 'rgba(102,126,234,0.16)' : 'rgba(255,255,255,0.05)',
                    border: `1px solid ${f ? '#667eea' : 'rgba(255,255,255,0.12)'}`,
                    borderRadius: '14px', padding: '20px 18px', display: 'flex', flexDirection: 'column' }),
    tag: { fontSize: '10.5px', fontWeight: 800, letterSpacing: '1px', color: '#a5b4fc', marginBottom: '6px' },
    name: { fontSize: '19px', fontWeight: 800, marginBottom: '2px' },
    price: { fontSize: '30px', fontWeight: 900, marginBottom: '2px' },
    per: { fontSize: '12.5px', color: 'rgba(255,255,255,0.55)', marginBottom: '10px' },
    blurb: { fontSize: '13.5px', color: 'rgba(255,255,255,0.75)', lineHeight: 1.5, marginBottom: '12px' },
    perk: { fontSize: '13px', color: 'rgba(255,255,255,0.7)', lineHeight: 1.7 },
    btn: (f) => ({ marginTop: 'auto', padding: '13px', borderRadius: '10px', border: 'none', cursor: 'pointer',
                   background: f ? 'linear-gradient(135deg,#667eea,#764ba2)' : '#fff',
                   color: f ? '#fff' : '#1a1a2e', fontSize: '15px', fontWeight: 800 }),
    quiet: { textAlign: 'center', marginTop: '22px' },
    quietBtn: { background: 'none', border: 'none', color: '#a5b4fc', fontSize: '14px', fontWeight: 600,
                cursor: 'pointer', textDecoration: 'underline' },
    err: { maxWidth: '520px', margin: '0 auto 18px', background: 'rgba(239,68,68,0.15)', border: '1px solid rgba(248,113,113,0.5)',
           color: '#fecaca', borderRadius: '10px', padding: '11px 14px', fontSize: '13.5px', lineHeight: 1.5, textAlign: 'center' },
    foot: { textAlign: 'center', marginTop: '26px', fontSize: '12.5px', color: 'rgba(255,255,255,0.45)', lineHeight: 1.6 },
  };

  return (
    <div style={s.page}>
      <div style={s.wrap}>
        <h1 style={s.h1}>Keep your training going</h1>
        <p style={s.sub}>Pick the plan that fits. Cancel any time.</p>

        <div style={s.emailWrap}>
          <label style={s.label}>YOUR EMAIL</label>
          <input
            style={s.input}
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="the email your program is under"
            autoComplete="email"
          />
        </div>

        {err && <div style={s.err}>{err}</div>}

        <div style={s.grid}>
          {TIERS.map((t) => (
            <div key={t.key} style={s.card(t.featured)}>
              {t.featured && <div style={s.tag}>MOST POPULAR</div>}
              <div style={s.name}>{t.name}</div>
              <div style={s.price}>{t.price}</div>
              <div style={s.per}>per month</div>
              <div style={s.blurb}>{t.blurb}</div>
              <div style={{ marginBottom: '16px' }}>
                {t.perks.map((p) => <div key={p} style={s.perk}>✓ {p}</div>)}
              </div>
              <button style={s.btn(t.featured)} disabled={!!busy} onClick={() => start(t.key)}>
                {busy === t.key ? 'Opening checkout…' : `Choose ${t.name}`}
              </button>
            </div>
          ))}
        </div>

        {/* Tracker-only stays a quiet line, same as the member dashboard, so it
            doesn't compete with the coached plans. */}
        <div style={s.quiet}>
          <button style={s.quietBtn} disabled={!!busy} onClick={() => start('tracker')}>
            {busy === 'tracker' ? 'Opening checkout…' : 'Or just the Workout Tracker — $5.99/mo (no coaching)'}
          </button>
        </div>

        <div style={s.foot}>
          Secure checkout by Stripe. You'll go straight back to your workouts once it's done.
        </div>
      </div>
    </div>
  );
}
