import { useAuth } from '../hooks/useAuth';
import { api } from '../utils/api';
import { useState, useEffect } from 'react';
import useMediaQuery from '../hooks/useMediaQuery';

const TRACKER_URL = 'https://bestrongagain.netlify.app/';

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
  useEffect(() => {
    api.me().then(setMe).catch(() => { /* fall back to localStorage user */ });
    api.memberDashboard().then(setDash).catch(() => setDash({ error: true }));
    api.memberCoachSummaries().then(setSummaries).catch(() => setSummaries({ unlocked: false, summaries: [] }));
  }, []);

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

  return (
    <div style={s.page}>
      <h1 style={s.welcome}>Hey, {user?.first_name || 'there'}!</h1>
      <p style={s.sub}>Let's get to work.</p>

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
      {/* Stats card — tonnage always; calories + cardio gated */}
      <div style={s.card}>
        <div style={s.cardTitle}>Your Numbers</div>
        <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', marginBottom: '14px' }}>
          <StatTile label="Lifetime sessions" value={(dash.lifetime?.sessions || 0).toLocaleString()} />
          <StatTile label="Lifetime tonnage" value={`${(dash.lifetime?.tonnage || 0).toLocaleString()} lbs`} />
        </div>

        <ChartBlock title="Weekly tonnage" series={dash.tonnage_chart} valueKey="tonnage" unit="lbs" />
        <ChartBlock title="Weekly calorie burn" series={dash.calories_chart?.data} valueKey="calories" unit="cal" />
        <ChartBlock title="Weekly cardio minutes" series={dash.cardio_chart?.data} valueKey="cardio_min" unit="min" />
      </div>

      {/* Weight trend — all tiers, only if data exists */}
      {dash.weight_chart?.data?.length > 0 && (
        <div style={s.card}>
          <div style={s.cardTitle}>Bodyweight</div>
          <WeightChart series={dash.weight_chart.data} />
          <p style={{ fontSize: '11px', color: '#888', margin: '6px 0 0' }}>
            Logged on the tracker's optional weight tile.
          </p>
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

function WeightChart({ series }) {
  const points = series.map((d) => d.weight);
  return <MiniLineChart points={points} unit="lbs" tight />;
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
