import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { api } from '../utils/api';

const s = {
  page: { minHeight: 'calc(100vh - 60px)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '24px', background: 'linear-gradient(135deg, #f8f9fa, #e9ecef)' },
  card: { background: '#fff', borderRadius: '16px', padding: '40px 32px', maxWidth: '420px', width: '100%', boxShadow: '0 8px 30px rgba(0,0,0,0.1)' },
  title: { fontSize: '24px', fontWeight: '700', textAlign: 'center', marginBottom: '8px' },
  subtitle: { fontSize: '14px', color: '#888', textAlign: 'center', marginBottom: '28px' },
  label: { display: 'block', fontSize: '13px', fontWeight: '600', color: '#333', marginBottom: '6px' },
  input: { width: '100%', padding: '12px 16px', border: '2px solid #e0e0e0', borderRadius: '10px', fontSize: '15px', marginBottom: '16px', outline: 'none', boxSizing: 'border-box' },
  btn: { width: '100%', padding: '14px', border: 'none', borderRadius: '10px', background: 'linear-gradient(135deg, #B37602, #8a5b00)', color: '#fff', fontSize: '16px', fontWeight: '600', cursor: 'pointer' },
  error: { background: '#fdecea', color: '#b71c1c', padding: '10px 16px', borderRadius: '8px', fontSize: '14px', marginBottom: '16px', textAlign: 'center' },
  footer: { textAlign: 'center', marginTop: '20px', fontSize: '14px', color: '#888' },
};

export default function Login() {
  const [params] = useSearchParams();
  const prefilledEmail = params.get('email') || '';
  const reason = params.get('reason'); // 'upgrade' when bounced from /register
  const tier = params.get('tier');

  const [email, setEmail] = useState(prefilledEmail);
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const { login } = useAuth();
  const navigate = useNavigate();

  const [magicMsg, setMagicMsg] = useState('');
  const [magicLoading, setMagicLoading] = useState(false);

  // Passwordless sign-in for members (e.g. 1-on-1 clients who never set a
  // password). Emails a magic link to their dashboard. dest:'app' so the link
  // lands on app.bestrongagain.com/magic → /member.
  const handleMagicLink = async () => {
    if (!email) { setError('Enter your email above first.'); return; }
    setError(''); setMagicMsg(''); setMagicLoading(true);
    try {
      const res = await fetch('/api/auth/magic-link/request', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, dest: 'app' }),
      });
      const data = await res.json();
      if (res.ok && data.success) setMagicMsg(`Check ${email} for a sign-in link.`);
      else setError(data.error || 'Could not send a link. Try again.');
    } catch {
      setError('Network error — please try again.');
    }
    setMagicLoading(false);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const res = await api.login({ email, password });
      login(res.user, res.token);

      // If they bounced over from /register intending to upgrade to a paid
      // tier, send them straight into Stripe checkout once authenticated.
      if (reason === 'upgrade' && tier && ['tracker', 'basic', 'coached', 'elite'].includes(tier)) {
        try {
          const co = await api.checkout(tier);
          if (co?.checkout_url) { window.location.href = co.checkout_url; return; }
        } catch { /* fall through to dashboard, they can retry from there */ }
      }
      navigate('/dashboard');
    } catch (err) {
      setError(err.message);
    }
    setLoading(false);
  };

  return (
    <div style={s.page}>
      <div style={s.card}>
        <h1 style={s.title}>Welcome Back</h1>
        <p style={s.subtitle}>Log in to your account</p>

        {reason === 'upgrade' && (
          <div style={{
            background: '#ecfdf5', border: '1px solid #86efac',
            color: '#065f46', padding: '12px 14px', borderRadius: '10px',
            fontSize: '13px', marginBottom: '16px', lineHeight: 1.5,
          }}>
            We found your account. Log in to continue — your existing email and
            history are already on file. Forgot your password?{' '}
            <Link to={`/forgot-password${prefilledEmail ? '?email=' + encodeURIComponent(prefilledEmail) : ''}`} style={{ color: '#15803d', fontWeight: 700 }}>
              Reset it →
            </Link>
          </div>
        )}

        {error && <div style={s.error}>{error}</div>}
        <form onSubmit={handleSubmit}>
          <label style={s.label}>Email</label>
          <input style={s.input} type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
          <label style={s.label}>Password</label>
          <input style={s.input} type="password" value={password} onChange={(e) => setPassword(e.target.value)} required />
          <button style={{ ...s.btn, opacity: loading ? 0.6 : 1 }} disabled={loading}>
            {loading ? 'Logging in...' : 'Login'}
          </button>
        </form>
        <div style={{ textAlign: 'center', marginTop: '12px', fontSize: '13px' }}>
          <Link to="/forgot-password" style={{ color: '#15803d' }}>Forgot password?</Link>
        </div>

        {/* Passwordless sign-in — for members/1-on-1 clients with no password. */}
        <div style={{ marginTop: '16px', paddingTop: '16px', borderTop: '1px solid #eee', textAlign: 'center' }}>
          {magicMsg ? (
            <div style={{ color: '#15803d', fontSize: '14px', fontWeight: 600 }}>{magicMsg}</div>
          ) : (
            <>
              <div style={{ fontSize: '13px', color: '#888', marginBottom: '8px' }}>
                No password? Enter your email above and we’ll send a sign-in link.
              </div>
              <button
                type="button"
                onClick={handleMagicLink}
                disabled={magicLoading}
                style={{
                  width: '100%', padding: '12px', border: '2px solid #B37602', borderRadius: '10px',
                  background: '#fff', color: '#B37602', fontSize: '15px', fontWeight: 700,
                  cursor: 'pointer', opacity: magicLoading ? 0.6 : 1,
                }}
              >
                {magicLoading ? 'Sending…' : 'Email me a sign-in link'}
              </button>
            </>
          )}
        </div>
        <div style={s.footer}>
          Don't have an account? <Link to="/register">Sign up</Link>
        </div>
      </div>
    </div>
  );
}
