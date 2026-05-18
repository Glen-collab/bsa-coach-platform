import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { api } from '../utils/api';

const s = {
  page: { minHeight: 'calc(100vh - 60px)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '24px', background: 'linear-gradient(135deg, #f8f9fa, #e9ecef)' },
  card: { background: '#fff', borderRadius: '16px', padding: '40px 32px', maxWidth: '420px', width: '100%', boxShadow: '0 8px 30px rgba(0,0,0,0.1)' },
  title: { fontSize: '24px', fontWeight: 700, textAlign: 'center', marginBottom: '8px' },
  subtitle: { fontSize: '14px', color: '#888', textAlign: 'center', marginBottom: '28px' },
  label: { display: 'block', fontSize: '13px', fontWeight: 600, color: '#333', marginBottom: '6px' },
  input: { width: '100%', padding: '12px 16px', border: '2px solid #e0e0e0', borderRadius: '10px', fontSize: '15px', marginBottom: '16px', outline: 'none', boxSizing: 'border-box' },
  btn: { width: '100%', padding: '14px', border: 'none', borderRadius: '10px', background: 'linear-gradient(135deg, #16a34a, #15803d)', color: '#fff', fontSize: '16px', fontWeight: 600, cursor: 'pointer' },
  error: { background: '#fdecea', color: '#b71c1c', padding: '10px 16px', borderRadius: '8px', fontSize: '14px', marginBottom: '16px', textAlign: 'center' },
  ok: { background: '#e8f5ed', color: '#15803d', padding: '12px 16px', borderRadius: '10px', fontSize: '14px', marginBottom: '12px', textAlign: 'center', lineHeight: 1.4 },
  footer: { textAlign: 'center', marginTop: '20px', fontSize: '14px', color: '#888' },
};

export default function ResetPassword() {
  const [params] = useSearchParams();
  const token = params.get('token') || '';
  const [password, setPassword] = useState('');
  const [confirm, setConfirm]   = useState('');
  const [error, setError]       = useState('');
  const [done, setDone]         = useState(false);
  const [loading, setLoading]   = useState(false);
  const navigate = useNavigate();

  if (!token) {
    return (
      <div style={s.page}>
        <div style={s.card}>
          <h1 style={s.title}>Reset link invalid</h1>
          <p style={s.subtitle}>This link is missing its token.</p>
          <div style={s.footer}><Link to="/forgot-password">Request a new one</Link></div>
        </div>
      </div>
    );
  }

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    if (password.length < 8) {
      setError('Password must be at least 8 characters.');
      return;
    }
    if (password !== confirm) {
      setError('Passwords don\'t match.');
      return;
    }
    setLoading(true);
    try {
      await api.resetPassword(token, password);
      setDone(true);
      setTimeout(() => navigate('/login'), 1500);
    } catch (err) {
      setError(err.message || 'Could not reset password.');
    }
    setLoading(false);
  };

  return (
    <div style={s.page}>
      <div style={s.card}>
        <h1 style={s.title}>Set a new password</h1>
        <p style={s.subtitle}>Pick something you'll remember. 8+ characters.</p>

        {done ? (
          <>
            <div style={s.ok}>Password updated. Sending you to login…</div>
          </>
        ) : (
          <>
            {error && <div style={s.error}>{error}</div>}
            <form onSubmit={handleSubmit}>
              <label style={s.label}>New password</label>
              <input
                style={s.input}
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                autoFocus
              />
              <label style={s.label}>Confirm password</label>
              <input
                style={s.input}
                type="password"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                required
              />
              <button style={{ ...s.btn, opacity: loading ? 0.6 : 1 }} disabled={loading}>
                {loading ? 'Saving…' : 'Set new password'}
              </button>
            </form>
            <div style={s.footer}>
              <Link to="/login">← Back to login</Link>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
