import { useAuth } from '../hooks/useAuth';
import { api } from '../utils/api';
import { useState } from 'react';
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

  // Build tracker URL with email + name prepopulated (tracker reads ?email=&code= & name= from URL).
  const trackerParams = new URLSearchParams();
  if (user?.email) trackerParams.set('email', user.email);
  if (user?.first_name) trackerParams.set('name', user.first_name);
  const trackerHref = `${TRACKER_URL}?${trackerParams.toString()}`;

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
          <div style={s.statValue}>{user?.tier || 'Free'}</div>
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
      </div>

      {/* Referral */}
      <div style={s.card}>
        <div style={s.cardTitle}>Refer a Friend</div>
        <p style={{ fontSize: '14px', color: '#666', marginBottom: '10px' }}>
          Share your referral link and earn when people you refer subscribe.
        </p>
        {user?.referral_code && (
          <div style={s.referral}>
            <div style={{ fontSize: '12px', fontWeight: '600', color: '#1565c0', marginBottom: '4px' }}>Your Referral Link</div>
            <div style={{ fontSize: '13px', fontWeight: '600', wordBreak: 'break-all' }}>
              {window.location.origin}/register/{user.referral_code}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
