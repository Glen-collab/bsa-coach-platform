import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';

// /magic?token=... — passwordless landing for a magic-link email (e.g. the
// 1-on-1 client welcome). Consumes the one-shot token for a JWT, signs the
// user in, and drops them on the right dashboard. Members → /member.
export default function MagicLogin() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const { login } = useAuth();
  const [error, setError] = useState('');

  useEffect(() => {
    const token = params.get('token');
    if (!token) { setError('This link is missing its sign-in code.'); return; }
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/auth/magic-link/consume', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token }),
        });
        const data = await res.json();
        if (cancelled) return;
        if (res.ok && data.success && data.token) {
          login(data.user, data.token);
          navigate(data.user?.role === 'member' ? '/member' : '/dashboard', { replace: true });
        } else {
          setError(data.error || 'This link has expired. Ask your trainer to resend it.');
        }
      } catch {
        if (!cancelled) setError('Network error — please try again.');
      }
    })();
    return () => { cancelled = true; };
  }, [params, login, navigate]);

  return (
    <div style={{
      minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: 'linear-gradient(180deg, #0f172a 0%, #1e293b 100%)', color: '#fff',
      fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif", padding: '24px',
    }}>
      <div style={{ textAlign: 'center', maxWidth: '420px' }}>
        {error ? (
          <>
            <h2 style={{ margin: '0 0 10px' }}>Couldn’t sign you in</h2>
            <p style={{ color: 'rgba(255,255,255,0.7)', lineHeight: 1.5, marginBottom: '16px' }}>{error}</p>
            <a href="/login" style={{ color: '#fbbf24', fontWeight: 700 }}>Go to sign in</a>
          </>
        ) : (
          <p style={{ color: 'rgba(255,255,255,0.7)', fontSize: '16px' }}>Signing you in…</p>
        )}
      </div>
    </div>
  );
}
