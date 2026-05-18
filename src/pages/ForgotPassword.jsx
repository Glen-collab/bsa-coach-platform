import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../utils/api';

const s = {
  page: { minHeight: 'calc(100vh - 60px)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '24px', background: 'linear-gradient(135deg, #f8f9fa, #e9ecef)' },
  card: { background: '#fff', borderRadius: '16px', padding: '40px 32px', maxWidth: '420px', width: '100%', boxShadow: '0 8px 30px rgba(0,0,0,0.1)' },
  title: { fontSize: '24px', fontWeight: 700, textAlign: 'center', marginBottom: '8px' },
  subtitle: { fontSize: '14px', color: '#888', textAlign: 'center', marginBottom: '28px' },
  label: { display: 'block', fontSize: '13px', fontWeight: 600, color: '#333', marginBottom: '6px' },
  input: { width: '100%', padding: '12px 16px', border: '2px solid #e0e0e0', borderRadius: '10px', fontSize: '15px', marginBottom: '16px', outline: 'none', boxSizing: 'border-box' },
  btn: { width: '100%', padding: '14px', border: 'none', borderRadius: '10px', background: 'linear-gradient(135deg, #16a34a, #15803d)', color: '#fff', fontSize: '16px', fontWeight: 600, cursor: 'pointer' },
  ok: { background: '#e8f5ed', color: '#15803d', padding: '12px 16px', borderRadius: '10px', fontSize: '14px', marginBottom: '12px', textAlign: 'center', lineHeight: 1.4 },
  footer: { textAlign: 'center', marginTop: '20px', fontSize: '14px', color: '#888' },
};

export default function ForgotPassword() {
  const [email, setEmail] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    try {
      await api.forgotPassword(email);
    } catch {
      // Backend always returns 200, but be defensive.
    }
    setLoading(false);
    setSubmitted(true);
  };

  return (
    <div style={s.page}>
      <div style={s.card}>
        <h1 style={s.title}>Forgot your password?</h1>
        <p style={s.subtitle}>Enter your email and I'll send you a reset link.</p>

        {submitted ? (
          <>
            <div style={s.ok}>
              If <strong>{email}</strong> matches an account, a reset link is on its way.
              It's good for one hour. Check your inbox (and spam folder).
            </div>
            <div style={s.footer}>
              <Link to="/login">← Back to login</Link>
            </div>
          </>
        ) : (
          <>
            <form onSubmit={handleSubmit}>
              <label style={s.label}>Email</label>
              <input
                style={s.input}
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                autoFocus
              />
              <button style={{ ...s.btn, opacity: loading ? 0.6 : 1 }} disabled={loading}>
                {loading ? 'Sending…' : 'Send reset link'}
              </button>
            </form>
            <div style={s.footer}>
              Remembered it? <Link to="/login">Log in</Link>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
