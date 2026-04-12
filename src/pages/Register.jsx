import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { api } from '../utils/api';

const s = {
  page: { minHeight: 'calc(100vh - 60px)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '24px', background: 'linear-gradient(135deg, #f8f9fa, #e9ecef)' },
  card: { background: '#fff', borderRadius: '16px', padding: '40px 32px', maxWidth: '460px', width: '100%', boxShadow: '0 8px 30px rgba(0,0,0,0.1)' },
  title: { fontSize: '24px', fontWeight: '700', textAlign: 'center', marginBottom: '8px' },
  subtitle: { fontSize: '14px', color: '#888', textAlign: 'center', marginBottom: '28px' },
  row: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' },
  label: { display: 'block', fontSize: '13px', fontWeight: '600', color: '#333', marginBottom: '6px' },
  input: { width: '100%', padding: '12px 16px', border: '2px solid #e0e0e0', borderRadius: '10px', fontSize: '15px', marginBottom: '16px', outline: 'none', boxSizing: 'border-box' },
  referralBox: { background: '#f0f7ff', border: '1px solid #d0e3f7', borderRadius: '10px', padding: '12px 14px', marginBottom: '16px' },
  referralText: { fontSize: '13px', color: '#1565c0', margin: 0 },
  btn: { width: '100%', padding: '14px', border: 'none', borderRadius: '10px', background: 'linear-gradient(135deg, #B37602, #8a5b00)', color: '#fff', fontSize: '16px', fontWeight: '600', cursor: 'pointer' },
  error: { background: '#fdecea', color: '#b71c1c', padding: '10px 16px', borderRadius: '8px', fontSize: '14px', marginBottom: '16px', textAlign: 'center' },
  footer: { textAlign: 'center', marginTop: '20px', fontSize: '14px', color: '#888' },
};

export default function Register() {
  const { referralCode: urlReferral } = useParams();
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [referralCode, setReferralCode] = useState(urlReferral || '');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const { login } = useAuth();
  const navigate = useNavigate();

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    if (password.length < 8) { setError('Password must be at least 8 characters.'); return; }
    setLoading(true);
    try {
      const res = await api.register({
        first_name: firstName,
        last_name: lastName,
        email,
        password,
        referral_code: referralCode || null,
      });
      login(res.user, res.token);
      navigate('/dashboard');
    } catch (err) {
      setError(err.message);
    }
    setLoading(false);
  };

  return (
    <div style={s.page}>
      <div style={s.card}>
        <h1 style={s.title}>Create Your Account</h1>
        <p style={s.subtitle}>Start your strength journey today</p>
        {urlReferral && (
          <div style={s.referralBox}>
            <p style={s.referralText}>You were referred by a coach! Their code <strong>{urlReferral}</strong> has been applied.</p>
          </div>
        )}
        {error && <div style={s.error}>{error}</div>}
        <form onSubmit={handleSubmit}>
          <div style={s.row}>
            <div>
              <label style={s.label}>First Name</label>
              <input style={s.input} type="text" value={firstName} onChange={(e) => setFirstName(e.target.value)} required />
            </div>
            <div>
              <label style={s.label}>Last Name</label>
              <input style={s.input} type="text" value={lastName} onChange={(e) => setLastName(e.target.value)} required />
            </div>
          </div>
          <label style={s.label}>Email</label>
          <input style={s.input} type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
          <label style={s.label}>Password</label>
          <input style={s.input} type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Min 8 characters" required />
          <label style={s.label}>Referral Code (optional)</label>
          <input style={s.input} type="text" value={referralCode} onChange={(e) => setReferralCode(e.target.value.toUpperCase())} placeholder="e.g. GLEN12ABC" />
          <button style={{ ...s.btn, opacity: loading ? 0.6 : 1 }} disabled={loading}>
            {loading ? 'Creating account...' : 'Create Account'}
          </button>
        </form>
        <div style={s.footer}>
          Already have an account? <Link to="/login">Log in</Link>
        </div>
      </div>
    </div>
  );
}
