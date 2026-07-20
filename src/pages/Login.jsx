import { useState, useEffect } from 'react';
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
  const [remember, setRemember] = useState(true); // keep coaches/admins signed in ~1yr
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const { login } = useAuth();
  const navigate = useNavigate();

  const [magicMsg, setMagicMsg] = useState('');
  const [magicLoading, setMagicLoading] = useState(false);

  // Set by api.jsx when a request 401s with a token present (session expired /
  // token invalidated). Show a friendly note so a normal expiry doesn't read as
  // a scary "authentication required" failure.
  const [sessionExpired, setSessionExpired] = useState(false);
  useEffect(() => {
    if (sessionStorage.getItem('bsa_session_expired')) {
      setSessionExpired(true);
      sessionStorage.removeItem('bsa_session_expired');
    }
  }, []);
  // Password login is secondary now (coaches/admins or anyone who set one).
  // Members / 1-on-1 clients have no password, so the email sign-in link leads.
  const [showPassword, setShowPassword] = useState(false);

  // Passwordless sign-in for members (e.g. 1-on-1 clients who never set a
  // password). Emails a magic link to their dashboard. dest:'app' so the link
  // lands on app.bestrongagain.com/magic → /member.
  const handleMagicLink = async () => {
    if (!email) { setError('Enter your email above first.'); return; }
    setError(''); setMagicMsg(''); setMagicLoading(true);
    try {
      // Carry the upgrade intent through the emailed link so a member who
      // bounced here to subscribe lands back on checkout after signing in,
      // instead of dead-ending on the dashboard.
      const wantsUpgrade = reason === 'upgrade' && tier &&
        ['tracker', 'basic', 'coached', 'elite'].includes(tier);
      const res = await fetch('/api/auth/magic-link/request', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, dest: 'app', ...(wantsUpgrade ? { upgrade: tier } : {}) }),
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
      const res = await api.login({ email, password, remember });
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
        <p style={s.subtitle}>Enter your email — we’ll send you a one-tap sign-in link. No password needed.</p>

        {sessionExpired && (
          <div style={{
            background: '#fffbeb', border: '1px solid #fcd34d',
            color: '#92400e', padding: '12px 14px', borderRadius: '10px',
            fontSize: '13px', marginBottom: '16px', lineHeight: 1.5, textAlign: 'center',
          }}>
            Your session expired — please sign in again to pick up where you left off.
          </div>
        )}

        {reason === 'upgrade' && (
          <div style={{
            background: '#ecfdf5', border: '1px solid #86efac',
            color: '#065f46', padding: '12px 14px', borderRadius: '10px',
            fontSize: '13px', marginBottom: '16px', lineHeight: 1.5,
          }}>
            We found your account — enter your email below and we’ll send you a sign-in link.
          </div>
        )}

        {error && <div style={s.error}>{error}</div>}

        {/* PRIMARY: email → one-tap sign-in link (members / 1-on-1 clients have
            no password, so this leads. Enter on the email field sends it too). */}
        <form onSubmit={(e) => { e.preventDefault(); handleMagicLink(); }}>
          <label style={s.label}>Email</label>
          <input style={s.input} type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoFocus />
          {magicMsg ? (
            <div style={{
              background: '#ecfdf5', border: '1px solid #86efac', color: '#065f46',
              padding: '12px 14px', borderRadius: '10px', fontSize: '14px', textAlign: 'center', lineHeight: 1.5,
            }}>
              <b>{magicMsg}</b><br />Tap the link in that email to get into your dashboard.
            </div>
          ) : (
            <button style={{ ...s.btn, opacity: magicLoading ? 0.6 : 1 }} disabled={magicLoading} type="submit">
              {magicLoading ? 'Sending…' : 'Email me a sign-in link'}
            </button>
          )}
        </form>

        {/* SECONDARY: password login for coaches/admins (or anyone who set one). */}
        <div style={{ textAlign: 'center', marginTop: '18px', paddingTop: '14px', borderTop: '1px solid #eee' }}>
          {!showPassword ? (
            <button
              type="button"
              onClick={() => setShowPassword(true)}
              style={{ background: 'none', border: 'none', color: '#15803d', fontSize: '13px', fontWeight: 700, cursor: 'pointer', textDecoration: 'underline' }}
            >
              I have a password →
            </button>
          ) : (
            <form onSubmit={handleSubmit} style={{ textAlign: 'left', marginTop: '4px' }}>
              <label style={s.label}>Password</label>
              <input style={s.input} type="password" value={password} onChange={(e) => setPassword(e.target.value)} required autoFocus />
              <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '13px', color: '#555', marginBottom: '14px', cursor: 'pointer' }}>
                <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} style={{ width: '16px', height: '16px', cursor: 'pointer' }} />
                Keep me signed in on this device
              </label>
              <button style={{ ...s.btn, background: 'linear-gradient(135deg, #15803d, #0f5c2c)', opacity: loading ? 0.6 : 1 }} disabled={loading} type="submit">
                {loading ? 'Logging in...' : 'Log in with password'}
              </button>
              <div style={{ textAlign: 'center', marginTop: '10px', fontSize: '13px' }}>
                <Link to="/forgot-password" style={{ color: '#15803d' }}>Forgot password?</Link>
              </div>
            </form>
          )}
        </div>

        <div style={s.footer}>
          Don't have an account? <Link to="/register">Sign up</Link>
        </div>
      </div>
    </div>
  );
}
