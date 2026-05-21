import { useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
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
  chipsGrid: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px', marginBottom: '20px' },
  chip: { padding: '14px 12px', border: '2px solid #e0e0e0', borderRadius: '12px', background: '#fff', cursor: 'pointer', fontSize: '14px', fontWeight: 600, color: '#333', textAlign: 'center', transition: 'all 0.15s' },
  chipSel: { padding: '14px 12px', border: '2px solid #B37602', borderRadius: '12px', background: 'linear-gradient(135deg,#fef3c7,#fde68a)', cursor: 'pointer', fontSize: '14px', fontWeight: 700, color: '#7c2d12', textAlign: 'center', transition: 'all 0.15s' },
  starterCard: { background: 'linear-gradient(135deg,#ecfdf5,#d1fae5)', border: '2px solid #86efac', borderRadius: '14px', padding: '18px 16px', marginBottom: '18px' },
  starterTitle: { fontSize: '18px', fontWeight: 700, color: '#065f46', margin: '0 0 6px 0' },
  starterBody: { fontSize: '13px', color: '#065f46', margin: '0 0 14px 0', lineHeight: 1.5 },
  teaserList: { marginTop: '20px' },
  teaserHead: { fontSize: '13px', fontWeight: 700, color: '#666', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '10px' },
  teaserCard: { background: '#f8f9fa', borderRadius: '10px', padding: '12px 14px', marginBottom: '8px' },
  teaserName: { fontSize: '14px', fontWeight: 700, color: '#1a1a2e', margin: '0 0 4px 0' },
  teaserBlurb: { fontSize: '12px', color: '#666', margin: 0, lineHeight: 1.45 },
  ghostBtn: { display: 'block', textAlign: 'center', marginTop: '14px', color: '#888', fontSize: '13px', textDecoration: 'underline' },
};

// The eight goal categories. "Get Jacked", "Focus on Form", and
// "Aging Gracefully" are Glen's stated priorities; the rest cover his
// programs' breadth (Hyrox conditioning, martial arts, post-injury,
// weight loss, hypertrophy).
const GOAL_OPTIONS = [
  'Get Jacked',
  'Focus on Form',
  'Aging Gracefully',
  'Weight Loss',
  'Build Muscle',
  'Hyrox / Competition',
  'Martial Arts',
  'Coming Back from Injury',
];

// Tease the "Glen will personalize your program" pitch with three
// goal-aligned program suggestions. These names are not literal DB
// rows yet — they're the upsell narrative while Glen reads the
// signup's goals and assigns the real next program by email.
const GOAL_TO_PROGRAM = {
  'Get Jacked':              { name: 'Hypertrophy Builder',         blurb: 'Progressive overload with split-day volume — built to add size.' },
  'Build Muscle':            { name: 'Hypertrophy Builder',         blurb: 'Progressive overload with split-day volume — built to add size.' },
  'Focus on Form':           { name: 'Foundation Series',           blurb: 'Master the lifts at light weight before you load them.' },
  'Aging Gracefully':        { name: 'Joint-Friendly Strength',     blurb: 'Mobility-first, controlled tempo, no jumping or grinding reps.' },
  'Weight Loss':             { name: 'Metabolic Conditioning',      blurb: 'High-rep circuits + cardio finishers tuned for fat loss.' },
  'Hyrox / Competition':     { name: 'Hyrox Prep',                  blurb: 'Race-specific stations, sled pulls, wall balls, and engine work.' },
  'Martial Arts':            { name: 'TKD & Boxing Foundations',    blurb: 'Sport-specific conditioning + technique progressions Glen built.' },
  'Coming Back from Injury': { name: 'Return to Training',          blurb: 'Controlled re-entry from a layoff — rebuild work capacity safely.' },
};

function goalsToPrograms(goals) {
  const seen = new Set();
  const out = [];
  for (const g of goals) {
    const p = GOAL_TO_PROGRAM[g];
    if (p && !seen.has(p.name)) { seen.add(p.name); out.push(p); }
    if (out.length >= 3) break;
  }
  // Pad with sensible defaults if user picked fewer/overlapping goals
  const fallbacks = ['Foundation Series', 'Hypertrophy Builder', 'Joint-Friendly Strength'];
  for (const name of fallbacks) {
    if (out.length >= 3) break;
    const match = Object.values(GOAL_TO_PROGRAM).find(p => p.name === name);
    if (match && !seen.has(name)) { seen.add(name); out.push(match); }
  }
  return out;
}

export default function Register() {
  const { referralCode: urlReferral } = useParams();
  const [searchParams] = useSearchParams();
  const redirectTo = searchParams.get('redirect');

  // Query-param-driven sign-up flow (for the /workout-builder walk-in funnel on WP).
  // Example: /register/COACHCODE?tier=basic&email=foo@bar.com
  //   - tier=basic|coached|elite  → after goals submit, auto-redirect to Stripe checkout
  //   - email=X                   → pre-fill email input
  const presetTier = searchParams.get('tier');      // 'basic' | 'coached' | 'elite' (or null)
  const presetEmail = searchParams.get('email') || '';

  // Three-step flow:
  //   1. 'account'     — name/email/password (existing form)
  //   2. 'goals'       — multi-select chips so we can tailor the welcome email
  //   3. 'recommended' — Beginner Adult starter CTA + Glen-will-personalize copy
  // Paid signups skip step 3 — they go straight to Stripe checkout after goals.
  const [step, setStep] = useState('account');

  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [email, setEmail] = useState(presetEmail);
  const [password, setPassword] = useState('');
  const [referralCode, setReferralCode] = useState(urlReferral || '');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [selectedGoals, setSelectedGoals] = useState([]);
  const [starterProgram, setStarterProgram] = useState('Beginner Adult');
  const [starterCode, setStarterCode] = useState('7741');
  const { login } = useAuth();
  const navigate = useNavigate();

  const toggleGoal = (g) => {
    setSelectedGoals((s) => s.includes(g) ? s.filter(x => x !== g) : [...s, g]);
  };

  const handleAccountSubmit = async (e) => {
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
      // Account exists — move to goal capture so the welcome email
      // (deferred until /submit-goals) arrives with context Glen can act on.
      setStep('goals');
    } catch (err) {
      // Existing account at this email — route them into login instead of
      // dead-ending. Preserves the upgrade tier so a successful login →
      // upgrade path can fire later.
      if (err.code === 'account_exists' || err.message === 'account_exists') {
        const q = new URLSearchParams();
        q.set('email', email);
        q.set('reason', 'upgrade');
        if (presetTier) q.set('tier', presetTier);
        navigate(`/login?${q.toString()}`);
        return;
      }
      setError(err.message);
    }
    setLoading(false);
  };

  const handleGoalsSubmit = async () => {
    setError('');
    setLoading(true);
    try {
      const res = await api.submitGoals(selectedGoals);
      if (res?.starter_program) setStarterProgram(res.starter_program);
      if (res?.starter_access_code) setStarterCode(res.starter_access_code);
      // Paid tier was preset — they came in meaning to subscribe, send
      // them to Stripe checkout now that we have their goals.
      if (presetTier && ['basic', 'coached', 'elite'].includes(presetTier)) {
        try {
          const co = await api.checkout(presetTier);
          if (co?.checkout_url) {
            window.location.href = co.checkout_url;
            return;
          }
        } catch (err) {
          setError('Account created but checkout failed: ' + err.message + '. Try the tier buttons on your dashboard.');
          navigate(redirectTo || '/dashboard');
          return;
        }
      }
      setStep('recommended');
    } catch (err) {
      setError(err.message);
    }
    setLoading(false);
  };

  // ── render ──────────────────────────────────────────────────────────
  return (
    <div style={s.page}>
      <div style={s.card}>
        {step === 'account' && (
          <>
            <h1 style={s.title}>Create Your Account</h1>
            <p style={s.subtitle}>Start your strength journey today</p>
            {urlReferral && (
              <div style={s.referralBox}>
                <p style={s.referralText}>You were referred by a coach! Their code <strong>{urlReferral}</strong> has been applied.</p>
              </div>
            )}
            {presetTier && ['basic', 'coached', 'elite'].includes(presetTier) && (
              <div style={{ background: '#ecfdf5', border: '1px solid #86efac', borderRadius: '10px', padding: '12px 14px', marginBottom: '16px' }}>
                <p style={{ fontSize: '13px', color: '#065f46', margin: 0 }}>
                  Subscribing to <strong style={{ textTransform: 'capitalize' }}>{presetTier}</strong> tier
                  {presetTier === 'basic' && ' ($20/mo)'}
                  {presetTier === 'coached' && ' ($200/mo)'}
                  {presetTier === 'elite' && ' ($400/mo)'}
                  . After we capture your goals you'll go straight to secure payment.
                </p>
              </div>
            )}
            {error && <div style={s.error}>{error}</div>}
            <form onSubmit={handleAccountSubmit}>
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
          </>
        )}

        {step === 'goals' && (
          <>
            <h1 style={s.title}>What are you here for?</h1>
            <p style={s.subtitle}>Pick all that apply. Glen reads every signup and picks the program that fits you best.</p>
            {error && <div style={s.error}>{error}</div>}
            <div style={s.chipsGrid}>
              {GOAL_OPTIONS.map((g) => (
                <button
                  key={g}
                  type="button"
                  onClick={() => toggleGoal(g)}
                  style={selectedGoals.includes(g) ? s.chipSel : s.chip}
                >
                  {g}
                </button>
              ))}
            </div>
            <button
              type="button"
              onClick={handleGoalsSubmit}
              disabled={loading || selectedGoals.length === 0}
              style={{ ...s.btn, opacity: (loading || selectedGoals.length === 0) ? 0.6 : 1 }}
            >
              {loading ? 'Saving…' : (presetTier ? 'Continue to checkout' : 'Continue')}
            </button>
            <button
              type="button"
              onClick={() => { setSelectedGoals([]); handleGoalsSubmit(); }}
              style={s.ghostBtn}
              disabled={loading}
            >
              Skip — I'll tell Glen later
            </button>
          </>
        )}

        {step === 'recommended' && (
          <>
            <h1 style={s.title}>You're in, {firstName}.</h1>
            <p style={s.subtitle}>
              Glen reviews every signup personally and will email you a program tailored to your goals within ~24 hours.
              In the meantime — start with the friendly starter below.
            </p>
            <div style={s.starterCard}>
              <h2 style={s.starterTitle}>▶ Start Now — {starterProgram}</h2>
              <p style={s.starterBody}>
                All-levels friendly. Foundation lifts, full body, no fluff. Free to use while Glen finalizes your personalized program.
              </p>
              <a
                href={`https://bestrongagain.netlify.app/?email=${encodeURIComponent(email)}&name=${encodeURIComponent(firstName)}&code=${encodeURIComponent(starterCode)}`}
                style={{ ...s.btn, display: 'block', textDecoration: 'none', textAlign: 'center', boxSizing: 'border-box' }}
              >
                Start Training Now →
              </a>
            </div>
            <div style={s.teaserList}>
              <div style={s.teaserHead}>What Glen might assign next</div>
              {goalsToPrograms(selectedGoals).map((p) => (
                <div key={p.name} style={s.teaserCard}>
                  <p style={s.teaserName}>{p.name}</p>
                  <p style={s.teaserBlurb}>{p.blurb}</p>
                </div>
              ))}
            </div>
            <Link to="/dashboard" style={s.ghostBtn}>I'll wait for Glen's email →</Link>
          </>
        )}
      </div>
    </div>
  );
}
