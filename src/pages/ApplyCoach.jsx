import { useState } from 'react';
import { useAuth } from '../hooks/useAuth';
import { Link, useNavigate } from 'react-router-dom';

const s = {
  page: { minHeight: 'calc(100vh - 60px)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '24px', background: 'linear-gradient(135deg, #f8f9fa, #e9ecef)' },
  card: { background: '#fff', borderRadius: '16px', padding: '40px 32px', maxWidth: '520px', width: '100%', boxShadow: '0 8px 30px rgba(0,0,0,0.1)' },
  title: { fontSize: '24px', fontWeight: '700', textAlign: 'center', marginBottom: '8px' },
  subtitle: { fontSize: '14px', color: '#888', textAlign: 'center', marginBottom: '28px', lineHeight: '1.5' },
  label: { display: 'block', fontSize: '13px', fontWeight: '600', color: '#333', marginBottom: '6px' },
  hint: { fontSize: '12px', color: '#888', marginBottom: '8px', lineHeight: '1.4' },
  input: { width: '100%', padding: '12px 16px', border: '2px solid #e0e0e0', borderRadius: '10px', fontSize: '15px', marginBottom: '16px', outline: 'none', boxSizing: 'border-box' },
  textarea: { width: '100%', padding: '12px 16px', border: '2px solid #e0e0e0', borderRadius: '10px', fontSize: '14px', marginBottom: '16px', outline: 'none', boxSizing: 'border-box', minHeight: '100px', resize: 'vertical', fontFamily: 'inherit' },
  btn: { width: '100%', padding: '14px', border: 'none', borderRadius: '10px', background: 'linear-gradient(135deg, #B37602, #8a5b00)', color: '#fff', fontSize: '16px', fontWeight: '600', cursor: 'pointer' },
  error: { background: '#fdecea', color: '#b71c1c', padding: '10px 16px', borderRadius: '8px', fontSize: '14px', marginBottom: '16px', textAlign: 'center' },
  success: { background: '#dcfce7', color: '#16a34a', padding: '16px', borderRadius: '10px', fontSize: '14px', textAlign: 'center', lineHeight: '1.5' },
};

const API_BASE = import.meta.env.VITE_API_URL || 'https://app.bestrongagain.com/api';

export default function ApplyCoach() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [experience, setExperience] = useState('');
  const [certifications, setCertifications] = useState('');
  const [whyCoach, setWhyCoach] = useState('');
  const [yearsTraining, setYearsTraining] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);
  const [loading, setLoading] = useState(false);

  if (!user) {
    return (
      <div style={s.page}>
        <div style={s.card}>
          <h1 style={s.title}>Apply as Coach</h1>
          <p style={s.subtitle}>You need an account first. <Link to="/register?redirect=/apply-coach">Sign up</Link> and you'll be taken right back here to apply.</p>
        </div>
      </div>
    );
  }

  if (user.role === 'coach') {
    return (
      <div style={s.page}>
        <div style={s.card}>
          <h1 style={s.title}>You're Already a Coach!</h1>
          <p style={s.subtitle}>Head to your <Link to="/dashboard">coach dashboard</Link> to manage your clients.</p>
        </div>
      </div>
    );
  }

  if (success) {
    return (
      <div style={s.page}>
        <div style={s.card}>
          <div style={{ fontSize: '48px', textAlign: 'center', marginBottom: '16px' }}>&#10003;</div>
          <h1 style={s.title}>Application Submitted!</h1>
          <div style={s.success}>
            Your coach application is under review. We'll get back to you soon. In the meantime, you can still use the platform as a member.
          </div>
          <button style={{ ...s.btn, marginTop: '20px' }} onClick={() => navigate('/dashboard')}>
            Go to Dashboard
          </button>
        </div>
      </div>
    );
  }

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    if (!experience.trim() || !whyCoach.trim()) {
      setError('Please fill in your experience and why you want to coach.');
      return;
    }
    setLoading(true);
    try {
      const token = localStorage.getItem('bsa_token');
      const res = await fetch(`${API_BASE}/auth/apply-coach`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify({ experience, certifications, why_coach: whyCoach, years_training: yearsTraining ? Number(yearsTraining) : null }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Submission failed');
      setSuccess(true);
    } catch (err) {
      setError(err.message);
    }
    setLoading(false);
  };

  return (
    <div style={s.page}>
      <div style={s.card}>
        <h1 style={s.title}>Apply as Coach</h1>
        <p style={s.subtitle}>
          Want to coach on the Be Strong Again platform? Tell us about your background. Applications are reviewed by our team before approval.
        </p>

        {error && <div style={s.error}>{error}</div>}

        <form onSubmit={handleSubmit}>
          <label style={s.label}>Training Experience *</label>
          <p style={s.hint}>What's your background? How long have you been training yourself and others?</p>
          <textarea style={s.textarea} value={experience} onChange={(e) => setExperience(e.target.value)} placeholder="I've been training for 8 years and coaching clients for 3..." required />

          <label style={s.label}>Certifications</label>
          <p style={s.hint}>List any relevant certifications (NASM, CSCS, CrossFit L1, etc.). Not required but helpful.</p>
          <input style={s.input} value={certifications} onChange={(e) => setCertifications(e.target.value)} placeholder="NASM CPT, CrossFit L1, etc." />

          <label style={s.label}>Why Do You Want to Coach? *</label>
          <p style={s.hint}>What drives you? Why this platform?</p>
          <textarea style={s.textarea} value={whyCoach} onChange={(e) => setWhyCoach(e.target.value)} placeholder="I want to help people who..." required />

          <label style={s.label}>Years of Training Experience</label>
          <input style={s.input} type="number" value={yearsTraining} onChange={(e) => setYearsTraining(e.target.value)} placeholder="e.g. 5" />

          <button style={{ ...s.btn, opacity: loading ? 0.6 : 1 }} disabled={loading}>
            {loading ? 'Submitting...' : 'Submit Application'}
          </button>
        </form>
      </div>
    </div>
  );
}
