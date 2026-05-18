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
  useEffect(() => {
    api.me().then(setMe).catch(() => { /* fall back to localStorage user */ });
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

      {/* Referral card removed — members don't have Express accounts to
          receive commission payouts, so the "earn when you refer"
          promise was false. Coaches still see their referral tools on
          CoachDashboard via the existing 3-tier MLM commission engine.
          If we add a member-share-with-friend feature later (no $$,
          just a way for them to invite people), put it here. */}
    </div>
  );
}
