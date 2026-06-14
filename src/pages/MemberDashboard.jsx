import { useAuth } from '../hooks/useAuth';
import { api } from '../utils/api';
import { useState, useEffect } from 'react';
import useMediaQuery from '../hooks/useMediaQuery';
import { formatScore } from '../utils/challengeFormat';

const TRACKER_URL = 'https://bestrongagain.netlify.app/';

// Goal categories — KEEP IN SYNC with Register.jsx's GOAL_OPTIONS.
// Members can revisit and change these any time on their dashboard,
// since "what they want" drifts (today: Get Jacked; six months in: Hyrox).
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

const buildStyles = (isMobile) => ({
  page: { maxWidth: '800px', margin: '0 auto', padding: isMobile ? '16px 12px' : '32px 24px' },
  welcome: { fontSize: isMobile ? '22px' : '24px', fontWeight: '700', marginBottom: '4px' },
  sub: { fontSize: '14px', color: '#888', marginBottom: '16px' },

  primaryCard: {
    background: 'linear-gradient(135deg, #16a34a, #15803d)',
    borderRadius: '16px',
    padding: isMobile ? '20px' : '28px',
    marginBottom: '18px',
    color: '#fff',
    boxShadow: '0 8px 24px rgba(22, 163, 74, 0.25)',
    textAlign: 'center',
  },
  primaryHeadline: { fontSize: isMobile ? '20px' : '24px', fontWeight: '800', marginBottom: '6px' },
  primarySub: { fontSize: isMobile ? '13px' : '14px', opacity: 0.9, marginBottom: '16px', lineHeight: '1.5' },
  primaryBtn: {
    display: 'inline-block',
    padding: isMobile ? '14px 28px' : '16px 40px',
    background: '#fff',
    color: '#15803d',
    borderRadius: '10px',
    fontSize: isMobile ? '16px' : '18px',
    fontWeight: '800',
    textDecoration: 'none',
    letterSpacing: '0.3px',
    border: 'none',
    cursor: 'pointer',
    minWidth: '220px',
    boxShadow: '0 4px 12px rgba(0, 0, 0, 0.15)',
  },

  card: { background: '#fff', borderRadius: '16px', padding: isMobile ? '16px' : '24px', marginBottom: '14px', boxShadow: '0 2px 12px rgba(0,0,0,0.06)' },
  cardTitle: { fontSize: isMobile ? '16px' : '18px', fontWeight: '700', marginBottom: '12px', color: '#1a1a2e' },
  stat: { display: 'inline-block', background: 'linear-gradient(135deg, #667eea, #764ba2)', borderRadius: '10px', padding: '10px 16px', color: '#fff', marginRight: '10px', marginBottom: '10px' },
  statLabel: { fontSize: '11px', fontWeight: '600', opacity: 0.8 },
  statValue: { fontSize: '20px', fontWeight: '800' },
  btn: { padding: '10px 18px', border: 'none', borderRadius: '8px', background: 'linear-gradient(135deg, #B37602, #8a5b00)', color: '#fff', fontSize: '13px', fontWeight: '600', cursor: 'pointer' },
  tierRow: { display: 'grid', gridTemplateColumns: isMobile ? '1fr' : 'repeat(3, 1fr)', gap: '8px', marginTop: '12px' },
  referral: { background: '#f0f7ff', border: '1px solid #d0e3f7', borderRadius: '10px', padding: '14px', marginTop: '8px' },
});

export default function MemberDashboard() {
  const isMobile = useMediaQuery('(max-width: 640px)');
  const s = buildStyles(isMobile);
  const { user } = useAuth();
  const [upgrading, setUpgrading] = useState(false);
  const [managing,  setManaging]  = useState(false);

  const handleManageSubscription = async () => {
    setManaging(true);
    try {
      const res = await api.billingPortal();
      if (res.url) window.location.href = res.url;
    } catch (err) {
      alert(err.message || 'Could not open the billing portal.');
      setManaging(false);
    }
  };
  // Fresh state from /auth/me — `user` from localStorage is stale right
  // after a payment (tier flipped on the server, snapshot in storage is
  // still pre-payment). Hit /me on mount so we display the correct tier
  // and pass the assigned program's access code to the tracker.
  const [me, setMe] = useState(null);
  const [dash, setDash] = useState(null);
  const [summaries, setSummaries] = useState(null);
  // Goal editor — opens an inline picker so members can update their goals
  // any time (today: Get Jacked; later: Hyrox). Sends Glen an update email
  // tagged "Goals Updated" so he can reach out if the new goals don't match
  // the program he assigned them.
  const [goalsEditing, setGoalsEditing] = useState(false);
  const [goalsDraft, setGoalsDraft] = useState([]);
  const [goalsSaving, setGoalsSaving] = useState(false);
  const [customGoalText, setCustomGoalText] = useState('');
  useEffect(() => {
    api.me().then((m) => { setMe(m); setGoalsDraft(m?.goals || []); }).catch(() => { /* fall back to localStorage user */ });
    api.memberDashboard().then(setDash).catch(() => setDash({ error: true }));
    api.memberCoachSummaries().then(setSummaries).catch(() => setSummaries({ unlocked: false, summaries: [] }));
  }, []);

  const toggleDraftGoal = (g) => {
    setGoalsDraft((d) => d.includes(g) ? d.filter(x => x !== g) : [...d, g]);
  };

  const saveGoals = async () => {
    setGoalsSaving(true);
    try {
      const res = await api.submitGoals(goalsDraft);
      setMe((prev) => prev ? { ...prev, goals: res?.goals ?? goalsDraft } : prev);
      setGoalsEditing(false);
    } catch (err) {
      alert(err.message || 'Could not save your goals.');
    }
    setGoalsSaving(false);
  };

  const handleUpgrade = async (tier) => {
    setUpgrading(true);
    try {
      const res = await api.checkout(tier);
      if (res.checkout_url) window.location.href = res.checkout_url;
    } catch (err) {
      alert(err.message);
    }
    setUpgrading(false);
  };

  // Build tracker URL with email + name + access_code prepopulated.
  // Tracker reads ?email=&code=&name= and auto-loads the program when
  // both email + code are present.
  const trackerParams = new URLSearchParams();
  if (user?.email) trackerParams.set('email', user.email);
  if (user?.first_name) trackerParams.set('name', user.first_name);
  if (me?.active_access_code) trackerParams.set('code', me.active_access_code);
  const trackerHref = `${TRACKER_URL}?${trackerParams.toString()}`;
  const currentTier = me?.tier || 'Free';

  // ── 2-week check-in / upsell ──────────────────────────────────────
  // Once a non-coaching member (Free or $5.99 tracker) has trained for ~2
  // weeks, nudge them toward the $20 plan where Glen personally tunes their
  // program. Reads as coaching ("Glen's been watching"), not a paywall.
  const isPaidCoaching = ['basic', 'coached', 'elite'].includes(String(me?.tier || '').toLowerCase());
  const daysSinceSignup = me?.created_at
    ? Math.floor((Date.now() - new Date(me.created_at).getTime()) / 86400000)
    : 0;
  const [checkInDismissed, setCheckInDismissed] = useState(() => {
    try {
      const ts = parseInt(localStorage.getItem('bsa_checkin_dismissed') || '0', 10);
      return !!ts && (Date.now() - ts) < 7 * 86400000;   // snooze a week
    } catch { return false; }
  });
  const dismissCheckIn = () => {
    try { localStorage.setItem('bsa_checkin_dismissed', String(Date.now())); } catch { /* ignore */ }
    setCheckInDismissed(true);
  };
  const showCheckIn = !isPaidCoaching
    && (me?.workout_count || 0) >= 1
    && daysSinceSignup >= 14
    && !checkInDismissed;

  // ── Challenge state ───────────────────────────────────────────────
  const [challenge, setChallenge] = useState(null);
  const [challengeLoading, setChallengeLoading] = useState(true);
  // Challenge data loaded on mount -- members submit scores from the
  // tracker, so we just show standings here (no join button).
  useEffect(() => {
    api.activeChallenge()
      .then((res) => setChallenge(res?.active || null))
      .catch(() => setChallenge(null))
      .finally(() => setChallengeLoading(false));
  }, []);

  return (
    <div style={s.page}>
      <h1 style={s.welcome}>Hey, {user?.first_name || 'there'}!</h1>
      <p style={s.sub}>Let's get to work.</p>

      {/* ── 2-week check-in / $20 upsell ──────────────────────────────── */}
      {showCheckIn && (
        <div style={{
          position: 'relative',
          background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
          borderRadius: '16px',
          padding: isMobile ? '18px 16px' : '22px 24px',
          marginBottom: '18px',
          color: '#fff',
          boxShadow: '0 8px 24px rgba(102,126,234,0.3)',
        }}>
          <button
            onClick={dismissCheckIn}
            aria-label="Dismiss"
            style={{
              position: 'absolute', top: '10px', right: '12px', background: 'rgba(255,255,255,0.18)',
              border: 'none', color: '#fff', width: '26px', height: '26px', borderRadius: '50%',
              cursor: 'pointer', fontSize: '14px', lineHeight: '26px', padding: 0,
            }}
          >✕</button>
          <div style={{ fontSize: '11px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.6px', opacity: 0.85, marginBottom: '6px' }}>
            You're 2 weeks in 💪
          </div>
          <div style={{ fontSize: isMobile ? '16px' : '18px', fontWeight: 800, marginBottom: '8px', lineHeight: 1.35 }}>
            Glen's been watching your logs.
          </div>
          <p style={{ fontSize: '13.5px', opacity: 0.92, margin: '0 0 14px', lineHeight: 1.5 }}>
            Want him to tailor your next block to <b>your</b> goal — and keep adjusting it as you progress — instead of a template? That's the Basic plan.
          </p>
          <button
            disabled={upgrading}
            onClick={() => handleUpgrade('basic')}
            style={{
              background: '#fff', color: '#5a3fc0', border: 'none', borderRadius: '10px',
              padding: '11px 20px', fontSize: '14.5px', fontWeight: 800, cursor: 'pointer',
            }}
          >
            {upgrading ? '…' : 'Let Glen tune my program — $20/mo'}
          </button>
        </div>
      )}

      {/* ── Active Challenge Card ───────────────────────────────────── */}
      {!challengeLoading && (
        <div style={{
          background: 'linear-gradient(135deg, #1a1a2e 0%, #16213e 100%)',
          borderRadius: '16px',
          padding: isMobile ? '18px 16px' : '24px',
          marginBottom: '18px',
          color: '#fff',
          boxShadow: '0 8px 24px rgba(26,26,46,0.35)',
          borderLeft: '4px solid #fbbf24',
        }}>
          {challenge ? (
            <>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '8px', marginBottom: '10px' }}>
                <div>
                  <div style={{ fontSize: '11px', fontWeight: 700, color: '#fbbf24', textTransform: 'uppercase', letterSpacing: '0.6px', marginBottom: '4px' }}>Active Challenge</div>
                  <div style={{ fontSize: isMobile ? '18px' : '20px', fontWeight: 800 }}>{challenge.title}</div>
                </div>
                {challenge.days_left != null && (
                  <div style={{
                    background: 'rgba(251,191,36,0.15)', border: '1px solid rgba(251,191,36,0.3)',
                    borderRadius: '10px', padding: '8px 14px', textAlign: 'center', flexShrink: 0,
                  }}>
                    <div style={{ fontSize: '20px', fontWeight: 800, color: '#fbbf24' }}>{challenge.days_left}</div>
                    <div style={{ fontSize: '10px', fontWeight: 600, color: '#fbbf24', opacity: 0.8 }}>DAYS LEFT</div>
                  </div>
                )}
              </div>
              {challenge.description && (
                <p style={{ fontSize: '13px', opacity: 0.8, margin: '0 0 14px', lineHeight: 1.5 }}>{challenge.description}</p>
              )}
              <div style={{ fontSize: '11px', opacity: 0.6, marginBottom: '12px' }}>
                {challenge.unit ? `Unit: ${challenge.unit}` : ''}
                {challenge.lower_is_better ? ' (lower wins)' : ''}
                {challenge.total_participants != null && `${challenge.unit ? ' · ' : ''}${challenge.total_participants} participant${challenge.total_participants === 1 ? '' : 's'}`}
              </div>

              {/* User's rank + score */}
              {(challenge.my_rank != null || challenge.my_score != null) && (
                <div style={{ display: 'flex', gap: '10px', marginBottom: '14px', flexWrap: 'wrap' }}>
                  <div style={{ background: 'rgba(22,163,74,0.2)', border: '1px solid rgba(22,163,74,0.3)', borderRadius: '10px', padding: '10px 16px', minWidth: '100px', textAlign: 'center' }}>
                    <div style={{ fontSize: '10px', fontWeight: 700, color: '#86efac', textTransform: 'uppercase' }}>Your Rank</div>
                    <div style={{ fontSize: '22px', fontWeight: 800 }}>#{challenge.my_rank || '--'}</div>
                  </div>
                  <div style={{ background: 'rgba(102,126,234,0.2)', border: '1px solid rgba(102,126,234,0.3)', borderRadius: '10px', padding: '10px 16px', minWidth: '100px', textAlign: 'center' }}>
                    <div style={{ fontSize: '10px', fontWeight: 700, color: '#a5b4fc', textTransform: 'uppercase' }}>Your Score</div>
                    <div style={{ fontSize: '22px', fontWeight: 800 }}>
                      {challenge.my_score != null ? formatScore(challenge.my_score, challenge.unit) : '--'}
                    </div>
                  </div>
                </div>
              )}

              {/* Top 5 standings */}
              {challenge.standings && challenge.standings.length > 0 && (
                <div>
                  <div style={{ fontSize: '12px', fontWeight: 700, color: '#fbbf24', marginBottom: '8px', textTransform: 'uppercase', letterSpacing: '0.4px' }}>Leaderboard</div>
                  {challenge.standings.slice(0, 5).map((row, i) => (
                    <div key={i} style={{
                      display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                      padding: '7px 10px', borderRadius: '8px', marginBottom: '4px',
                      background: i === 0 ? 'rgba(251,191,36,0.12)' : 'rgba(255,255,255,0.04)',
                    }}>
                      <span style={{ fontSize: '13px' }}>
                        <span style={{ fontWeight: 800, color: i === 0 ? '#fbbf24' : '#ccc', marginRight: '8px' }}>#{i + 1}</span>
                        {row.first_name}
                      </span>
                      <span style={{ fontSize: '13px', fontWeight: 700, color: '#86efac' }}>
                        {formatScore(row.score, challenge.unit)}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </>
          ) : (
            <div style={{ textAlign: 'center', padding: '8px 0' }}>
              <div style={{ fontSize: '16px', fontWeight: 700, marginBottom: '6px' }}>No challenge running</div>
              <div style={{ fontSize: '13px', opacity: 0.6 }}>Check back soon -- your coach may launch one any day!</div>
            </div>
          )}
        </div>
      )}

      {/* PRIMARY CTA — top, front, center */}
      <div style={s.primaryCard}>
        <div style={s.primaryHeadline}>Start Your Workout</div>
        <p style={s.primarySub}>
          Open the Workout Tracker to log sets, watch technique videos, and crush your program.
        </p>
        <a href={trackerHref} target="_blank" rel="noreferrer" style={s.primaryBtn}>
          Open Workout Tracker →
        </a>
      </div>

      {/* Subscription */}
      <div style={s.card}>
        <div style={s.cardTitle}>Your Plan</div>
        <div style={s.stat}>
          <div style={s.statLabel}>CURRENT TIER</div>
          <div style={s.statValue}>{currentTier}</div>
        </div>
        <div style={s.tierRow}>
          <button style={s.btn} disabled={upgrading} onClick={() => handleUpgrade('basic')}>
            {upgrading ? '...' : 'Basic — $20/mo'}
          </button>
          <button style={s.btn} disabled={upgrading} onClick={() => handleUpgrade('coached')}>
            {upgrading ? '...' : 'Coached — $200/mo'}
          </button>
          <button style={s.btn} disabled={upgrading} onClick={() => handleUpgrade('elite')}>
            {upgrading ? '...' : 'Elite — $400/mo'}
          </button>
        </div>
        {/* Budget option — tracker only, no coaching. A quiet link under the
            tiers so it doesn't compete with the coached plans. */}
        <div style={{ textAlign: 'center', marginTop: '10px' }}>
          <button
            type="button"
            disabled={upgrading}
            onClick={() => handleUpgrade('tracker')}
            style={{ background: 'none', border: 'none', color: '#667eea', fontSize: '13px', fontWeight: 600, cursor: 'pointer', textDecoration: 'underline' }}
          >
            {upgrading ? '...' : 'Or just the Workout Tracker — $5.99/mo (no coaching)'}
          </button>
        </div>

        {/* Self-serve subscription management. Only show when they
            actually have something to manage. Opens Stripe-hosted
            billing portal — cancel, change card, download invoices. */}
        {currentTier && currentTier.toLowerCase() !== 'free' && (
          <div style={{ marginTop: '16px', paddingTop: '16px', borderTop: '1px solid #eee', textAlign: 'center' }}>
            <button
              onClick={handleManageSubscription}
              disabled={managing}
              style={{
                padding: '10px 20px', border: '2px solid #15803d', borderRadius: '8px',
                background: '#fff', color: '#15803d', fontSize: '14px', fontWeight: 700, cursor: 'pointer',
                opacity: managing ? 0.6 : 1,
              }}
            >
              {managing ? 'Opening…' : 'Manage Subscription / Cancel'}
            </button>
            <div style={{ marginTop: '6px', fontSize: '12px', color: '#888' }}>
              Opens Stripe's secure billing portal. Cancel, update card, download invoices.
            </div>
          </div>
        )}
      </div>

      {/* ── Your Goals — editable any time ─── */}
      <div style={s.card}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
          <div style={s.cardTitle}>Your Goals</div>
          {!goalsEditing && (
            <button
              onClick={() => { setGoalsDraft(me?.goals || []); setGoalsEditing(true); }}
              style={{ padding: '6px 12px', border: '1px solid #B37602', borderRadius: '8px', background: '#fff', color: '#B37602', fontSize: '12px', fontWeight: 700, cursor: 'pointer' }}
            >
              {me?.goals?.length ? 'Update' : 'Tell Glen'}
            </button>
          )}
        </div>
        {!goalsEditing && (
          <>
            {me?.goals?.length ? (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                {me.goals.map((g) => (
                  <span key={g} style={{
                    display: 'inline-block', background: '#fef3c7', color: '#92400e',
                    padding: '6px 12px', borderRadius: '999px', fontSize: '12px', fontWeight: 700,
                  }}>{g}</span>
                ))}
              </div>
            ) : (
              <p style={{ fontSize: '13px', color: '#666', margin: 0, lineHeight: 1.5 }}>
                Tell Glen what you're training for. He uses these to pick the right program for you — and your goals can change any time, so come back here whenever they do.
              </p>
            )}
          </>
        )}
        {goalsEditing && (
          <>
            <p style={{ fontSize: '13px', color: '#666', margin: '0 0 12px 0', lineHeight: 1.5 }}>
              Pick all that apply. Glen will see the update and may follow up if your new goals don't match the program he assigned you.
            </p>
            <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr 1fr' : 'repeat(4, 1fr)', gap: '8px', marginBottom: '14px' }}>
              {GOAL_OPTIONS.map((g) => {
                const sel = goalsDraft.includes(g);
                return (
                  <button
                    key={g}
                    onClick={() => toggleDraftGoal(g)}
                    style={{
                      padding: '10px 8px',
                      border: sel ? '2px solid #B37602' : '2px solid #e0e0e0',
                      borderRadius: '10px',
                      background: sel ? 'linear-gradient(135deg,#fef3c7,#fde68a)' : '#fff',
                      color: sel ? '#7c2d12' : '#333',
                      fontSize: '12px',
                      fontWeight: sel ? 700 : 600,
                      cursor: 'pointer',
                      textAlign: 'center',
                    }}
                  >
                    {g}
                  </button>
                );
              })}
            </div>
            <div style={{ display: 'flex', gap: '6px', marginBottom: '14px' }}>
              <input
                type="text"
                value={customGoalText}
                onChange={(e) => setCustomGoalText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && customGoalText.trim()) {
                    const g = customGoalText.trim();
                    if (!goalsDraft.includes(g)) setGoalsDraft((d) => [...d, g]);
                    setCustomGoalText('');
                  }
                }}
                placeholder="Write your own goal..."
                style={{
                  flex: 1, padding: '10px 12px', border: '2px solid #e0e0e0', borderRadius: '10px',
                  fontSize: '13px', outline: 'none',
                }}
              />
              <button
                onClick={() => {
                  const g = customGoalText.trim();
                  if (g && !goalsDraft.includes(g)) setGoalsDraft((d) => [...d, g]);
                  setCustomGoalText('');
                }}
                disabled={!customGoalText.trim()}
                style={{
                  padding: '10px 16px', border: 'none', borderRadius: '10px',
                  background: customGoalText.trim() ? 'linear-gradient(135deg, #B37602, #8a5b00)' : '#e0e0e0',
                  color: customGoalText.trim() ? '#fff' : '#999', fontSize: '13px', fontWeight: 700, cursor: 'pointer',
                }}
              >
                Add
              </button>
            </div>
            <div style={{ display: 'flex', gap: '8px' }}>
              <button
                onClick={saveGoals}
                disabled={goalsSaving}
                style={{ ...s.btn, opacity: goalsSaving ? 0.6 : 1, flex: 1 }}
              >
                {goalsSaving ? 'Saving…' : 'Save Goals'}
              </button>
              <button
                onClick={() => { setGoalsEditing(false); setGoalsDraft(me?.goals || []); }}
                disabled={goalsSaving}
                style={{ padding: '10px 16px', border: '1px solid #ddd', borderRadius: '8px', background: '#fff', color: '#666', fontSize: '13px', fontWeight: 600, cursor: 'pointer' }}
              >
                Cancel
              </button>
            </div>
          </>
        )}
      </div>

      {/* ── Member stats: charts, weight, summaries (no gates) ─── */}
      <DashboardSections dash={dash} summaries={summaries} s={s} />

      {/* Community — pulls them back to the blog/forum */}
      <div style={s.card}>
        <div style={s.cardTitle}>Community</div>
        <p style={{ fontSize: '13px', color: '#666', margin: '0 0 12px', lineHeight: 1.5 }}>
          Read the latest training write-ups, nutrition breakdowns, and member stories on the blog.
        </p>
        <a
          href="https://bestrongagain.com/blog/"
          target="_blank"
          rel="noreferrer"
          style={{
            display: 'inline-block', padding: '10px 18px',
            background: 'linear-gradient(135deg, #1a1a2e, #16213e)', color: '#fff',
            borderRadius: '8px', fontSize: '13px', fontWeight: 700, textDecoration: 'none',
          }}
        >
          Open the Blog →
        </a>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Tier-gated sections. Renders charts + summaries + locked upgrade teases.
// All the data lives on /api/members/dashboard, gated server-side.

function DashboardSections({ dash, summaries, s }) {
  if (!dash || dash.error) {
    return null;
  }

  return (
    <>
      {/* Stats card */}
      <div style={s.card}>
        <div style={s.cardTitle}>Your Numbers</div>
        <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', marginBottom: '14px' }}>
          <StatTile label="Lifetime sessions" value={(dash.lifetime?.sessions || 0).toLocaleString()} />
          <StatTile label="Lifetime tonnage" value={`${(dash.lifetime?.tonnage || 0).toLocaleString()} lbs`} />
        </div>

        <TonnageStory tonnage={dash.lifetime?.tonnage || 0} />

        <ChartBlock title="Weekly tonnage" series={dash.tonnage_chart} valueKey="tonnage" unit="lbs" />
        <ChartBlock title="Weekly calorie burn" series={dash.calories_chart?.data} valueKey="calories" unit="cal" />
        <ChartBlock title="Weekly cardio minutes" series={dash.cardio_chart?.data} valueKey="cardio_min" unit="min" />
      </div>

      {/* Weight trend — Hume-style smoothed line + raw dots */}
      {dash.weight_chart?.data?.length > 0 && (
        <div style={s.card}>
          <div style={s.cardTitle}>Bodyweight</div>
          <WeightChart series={dash.weight_chart.data} />
        </div>
      )}

      {/* AI coach summaries archive — visible to all tiers, empty until
          the coach pushes one from the trainer dashboard. */}
      <div style={s.card}>
        <div style={s.cardTitle}>Coach Summaries</div>
        {!summaries ? (
          <div style={{ fontSize: '13px', color: '#888' }}>Loading…</div>
        ) : summaries.summaries?.length === 0 ? (
          <div style={{ fontSize: '13px', color: '#888' }}>
            Nothing here yet. Your coach will share weekly or monthly summaries here as your training progresses.
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            {summaries.summaries.map((row) => (
              <SummaryRow key={row.id} row={row} />
            ))}
          </div>
        )}
      </div>
    </>
  );
}

// Tonnage milestones — real-ish weights of recognizable objects so the
// abstract "lifetime tonnage" number becomes a concrete story. Ordered
// ascending; we show whatever the user has already crossed + the next one
// as a target. Numbers are approximate but trustworthy.
const TONNAGE_MILESTONES = [
  { lbs: 500,       thing: 'a Smart car',           emoji: '🚗' },
  { lbs: 2000,      thing: 'a pickup truck',        emoji: '🛻' },
  { lbs: 5000,      thing: 'a Ford F-150',          emoji: '🚙' },
  { lbs: 12000,     thing: 'an elephant',           emoji: '🐘' },
  { lbs: 25000,     thing: 'a school bus',          emoji: '🚌' },
  { lbs: 80000,     thing: 'a semi-truck',          emoji: '🚛' },
  { lbs: 140000,    thing: 'an M1 Abrams tank',     emoji: '🪖' },
  { lbs: 225000,    thing: 'the Statue of Liberty', emoji: '🗽' },
  { lbs: 485000,    thing: 'a Boeing 747',          emoji: '✈️' },
  { lbs: 875000,    thing: 'a fully-loaded 747',    emoji: '🛫' },
  { lbs: 2000000,   thing: 'a cargo ship',          emoji: '🚢' },
  { lbs: 5000000,   thing: 'the Eiffel Tower',      emoji: '🗼' },
];

function tonnageStoryFor(lbs) {
  let achieved = null;
  let next = null;
  for (let i = 0; i < TONNAGE_MILESTONES.length; i++) {
    const m = TONNAGE_MILESTONES[i];
    if (lbs >= m.lbs) achieved = m;
    else { next = m; break; }
  }
  if (!achieved && next) {
    return { achieved: null, next, progress: lbs / next.lbs, remaining: next.lbs - lbs };
  }
  if (!next) {
    return { achieved, next: null, progress: 1, remaining: 0 };
  }
  const span = next.lbs - achieved.lbs;
  const into = lbs - achieved.lbs;
  return { achieved, next, progress: into / span, remaining: next.lbs - lbs };
}

function TonnageStory({ tonnage }) {
  if (!tonnage || tonnage < 100) {
    return (
      <div style={{
        marginBottom: '14px', padding: '12px 14px',
        background: 'linear-gradient(135deg, #fffbeb, #fef3c7)',
        border: '1px solid #fde68a', borderRadius: '12px',
        fontSize: '13px', color: '#7c2d12', display: 'flex', alignItems: 'center', gap: '8px',
      }}>
        <span style={{ fontSize: '20px' }}>💪</span>
        <span>Log a workout to start your tonnage story.</span>
      </div>
    );
  }
  const story = tonnageStoryFor(tonnage);
  const pct = Math.max(0, Math.min(100, Math.round((story.progress || 0) * 100)));

  return (
    <div style={{
      marginBottom: '14px',
      padding: '14px 16px',
      background: 'linear-gradient(135deg, #ecfdf5, #d1fae5)',
      border: '1px solid #86efac',
      borderRadius: '12px',
    }}>
      {story.achieved ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: story.next ? '12px' : 0 }}>
          <span style={{ fontSize: '32px', lineHeight: 1 }}>{story.achieved.emoji}</span>
          <div>
            <div style={{ fontSize: '11px', color: '#15803d', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.4px' }}>
              You've lifted
            </div>
            <div style={{ fontSize: '17px', fontWeight: 800, color: '#064e3b', lineHeight: 1.2 }}>
              {story.achieved.thing}
            </div>
            <div style={{ fontSize: '11px', color: '#15803d', marginTop: '2px' }}>
              ≈ {story.achieved.lbs.toLocaleString()} lbs
            </div>
          </div>
        </div>
      ) : (
        <div style={{ fontSize: '13px', color: '#064e3b', marginBottom: '12px' }}>
          You're building toward your first big milestone — keep going.
        </div>
      )}

      {story.next && (
        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', fontSize: '12px', color: '#15803d', marginBottom: '4px' }}>
            <span>Next: <strong style={{ color: '#064e3b' }}>{story.next.thing}</strong> {story.next.emoji}</span>
            <span style={{ fontWeight: 700 }}>{story.remaining.toLocaleString()} lbs to go</span>
          </div>
          <div style={{ height: '6px', background: 'rgba(21,128,61,0.15)', borderRadius: '999px', overflow: 'hidden' }}>
            <div style={{
              height: '100%',
              width: `${pct}%`,
              background: 'linear-gradient(90deg, #16a34a, #15803d)',
              borderRadius: '999px',
              transition: 'width 0.4s ease',
            }} />
          </div>
        </div>
      )}
    </div>
  );
}

function StatTile({ label, value }) {
  return (
    <div style={{
      background: 'linear-gradient(135deg, #667eea, #764ba2)', color: '#fff',
      borderRadius: '10px', padding: '10px 14px', minWidth: '140px',
    }}>
      <div style={{ fontSize: '11px', opacity: 0.85, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.4px' }}>{label}</div>
      <div style={{ fontSize: '18px', fontWeight: 800, marginTop: '4px' }}>{value}</div>
    </div>
  );
}

// Tiny inline-SVG line chart. No chart lib needed; series is short (≤12).
function ChartBlock({ title, series, valueKey, unit }) {
  const data = Array.isArray(series) ? series : [];
  const hasData = data.some((d) => (Number(d[valueKey]) || 0) > 0);
  return (
    <div style={{ marginTop: '12px' }}>
      <div style={{ fontSize: '12px', fontWeight: 700, color: '#444', marginBottom: '6px' }}>{title}</div>
      {hasData ? (
        <MiniLineChart points={data.map((d) => Number(d[valueKey]) || 0)} unit={unit} />
      ) : (
        <div style={{ fontSize: '12px', color: '#aaa', fontStyle: 'italic' }}>
          Log a few workouts and this chart fills in.
        </div>
      )}
    </div>
  );
}

// Hume-style weight chart. Daily measurements are noisy (water, food,
// time of day) so the headline is the EWMA-smoothed trend, with the raw
// data points shown faded behind it. Same approach Happy Scale / Hacker's
// Diet use — α=0.1 gives roughly a 10-day half-life.
function WeightChart({ series }) {
  if (!series || series.length === 0) return null;

  const ALPHA = 0.1;
  const trend = [];
  for (let i = 0; i < series.length; i++) {
    const w = series[i].weight;
    const prev = i === 0 ? w : trend[i - 1];
    trend.push(prev + ALPHA * (w - prev));
  }

  const raw = series.map((d) => d.weight);
  const allValues = [...raw, ...trend];
  const minVal = Math.min(...allValues) - 1;
  const maxVal = Math.max(...allValues) + 1;
  const range = Math.max(maxVal - minVal, 1);

  const width = 320, height = 150, padX = 8, padTop = 8, padBottom = 18;
  const plotH = height - padTop - padBottom;
  const stepX = series.length > 1 ? (width - padX * 2) / (series.length - 1) : 0;
  const x = (i) => padX + stepX * i;
  const y = (v) => padTop + plotH - ((v - minVal) / range) * plotH;

  const trendPath = trend
    .map((v, i) => `${i === 0 ? 'M' : 'L'} ${x(i).toFixed(1)} ${y(v).toFixed(1)}`)
    .join(' ');

  const latestTrend  = trend[trend.length - 1];
  const oldestTrend  = trend[0];
  const deltaLb = latestTrend - oldestTrend;
  const firstDate = new Date(series[0].date);
  const lastDate  = new Date(series[series.length - 1].date);
  const dayCount  = Math.max(1, Math.round((lastDate - firstDate) / 86400000));
  const deltaColor = deltaLb < -0.2 ? '#15803d' : deltaLb > 0.2 ? '#b91c1c' : '#666';
  const deltaArrow = deltaLb < -0.2 ? '▼' : deltaLb > 0.2 ? '▲' : '—';

  // Pull 3 reference y-grid values evenly across the range for context.
  const grid = [minVal, (minVal + maxVal) / 2, maxVal];

  // Date label helpers
  const fmtShort = (d) => d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

  return (
    <div>
      {/* Headline trend weight + delta */}
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', flexWrap: 'wrap', gap: '8px', marginBottom: '4px' }}>
        <div>
          <span style={{ fontSize: '11px', color: '#888', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.4px' }}>Trend weight</span>
          <div style={{ fontSize: '28px', fontWeight: 800, color: '#1a1a2e', lineHeight: 1 }}>
            {latestTrend.toFixed(1)}<span style={{ fontSize: '14px', color: '#888', fontWeight: 600, marginLeft: '4px' }}>lbs</span>
          </div>
        </div>
        <div style={{ textAlign: 'right' }}>
          <div style={{ fontSize: '11px', color: '#888', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.4px' }}>{dayCount}-day change</div>
          <div style={{ fontSize: '18px', fontWeight: 800, color: deltaColor, lineHeight: 1 }}>
            {deltaArrow} {Math.abs(deltaLb).toFixed(1)} lbs
          </div>
        </div>
      </div>

      {/* Chart */}
      <svg viewBox={`0 0 ${width} ${height}`} style={{ width: '100%', height: '150px', marginTop: '6px' }}>
        {/* Reference grid lines */}
        {grid.map((g, i) => (
          <g key={i}>
            <line x1={padX} x2={width - padX} y1={y(g)} y2={y(g)} stroke="#eef0f3" strokeWidth="1" />
            <text x={width - padX} y={y(g) - 2} textAnchor="end" fontSize="9" fill="#aaa">{g.toFixed(0)}</text>
          </g>
        ))}
        {/* Faded raw daily dots */}
        {raw.map((v, i) => (
          <circle key={i} cx={x(i)} cy={y(v)} r="2.5" fill="#94a3b8" fillOpacity="0.45" />
        ))}
        {/* Smoothed trend line */}
        <path d={trendPath} fill="none" stroke="#16a34a" strokeWidth="2.8" strokeLinecap="round" strokeLinejoin="round" />
        {/* Endpoint marker */}
        <circle cx={x(trend.length - 1)} cy={y(latestTrend)} r="4" fill="#15803d" stroke="#fff" strokeWidth="2" />
        {/* Date axis */}
        <text x={padX}            y={height - 4} textAnchor="start" fontSize="10" fill="#aaa">{fmtShort(firstDate)}</text>
        <text x={width - padX}    y={height - 4} textAnchor="end"   fontSize="10" fill="#aaa">{fmtShort(lastDate)}</text>
      </svg>

      <p style={{ fontSize: '11px', color: '#888', margin: '4px 0 0' }}>
        Faded dots are daily readings. The line is the smoothed trend that ignores day-to-day noise.
      </p>
    </div>
  );
}

function MiniLineChart({ points, unit, tight }) {
  if (!points || points.length === 0) return null;
  const width = 320, height = 80, pad = 8;
  const min = tight ? Math.min(...points) - 1 : 0;
  const max = Math.max(...points, 1);
  const range = Math.max(max - min, 1);
  const stepX = points.length > 1 ? (width - pad * 2) / (points.length - 1) : 0;
  const coord = (v, i) => [
    pad + stepX * i,
    height - pad - ((v - min) / range) * (height - pad * 2),
  ];
  const path = points.map((v, i) => {
    const [x, y] = coord(v, i);
    return `${i === 0 ? 'M' : 'L'} ${x.toFixed(1)} ${y.toFixed(1)}`;
  }).join(' ');
  const lastPoint = coord(points[points.length - 1], points.length - 1);
  const lastVal = points[points.length - 1];
  return (
    <div>
      <svg viewBox={`0 0 ${width} ${height}`} style={{ width: '100%', height: '80px' }}>
        <path d={path} fill="none" stroke="#16a34a" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
        <circle cx={lastPoint[0]} cy={lastPoint[1]} r="3.5" fill="#15803d" />
      </svg>
      <div style={{ fontSize: '11px', color: '#666', marginTop: '2px' }}>
        Latest: <strong style={{ color: '#15803d' }}>{Math.round(lastVal).toLocaleString()} {unit}</strong>
      </div>
    </div>
  );
}

function SummaryRow({ row }) {
  const [open, setOpen] = useState(false);
  const dateStr = new Date(row.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  const preview = (row.body || '').split('\n').filter(Boolean)[0] || '';
  return (
    <div style={{ border: '1px solid #e5e7eb', borderRadius: '10px', overflow: 'hidden' }}>
      <button
        onClick={() => setOpen(!open)}
        style={{
          width: '100%', textAlign: 'left',
          padding: '12px 14px', background: '#fff', border: 'none', cursor: 'pointer',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '10px',
        }}
      >
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '2px' }}>
            <span style={{
              fontSize: '10px', fontWeight: 800, color: '#15803d', textTransform: 'uppercase', letterSpacing: '0.4px',
              padding: '2px 6px', background: '#dcfce7', borderRadius: '4px',
            }}>{row.period}</span>
            <span style={{ fontSize: '12px', color: '#888' }}>{dateStr}</span>
          </div>
          <div style={{ fontSize: '13px', color: '#1a1a2e', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {preview}
          </div>
        </div>
        <span style={{ color: '#888', fontSize: '14px' }}>{open ? '▴' : '▾'}</span>
      </button>
      {open && (
        <div style={{
          padding: '12px 14px 16px', background: '#fafafa', borderTop: '1px solid #eee',
          fontSize: '13px', color: '#333', lineHeight: 1.55, whiteSpace: 'pre-wrap',
        }}>
          {row.body}
        </div>
      )}
    </div>
  );
}
