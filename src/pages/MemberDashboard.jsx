import { useAuth } from '../hooks/useAuth';
import { api } from '../utils/api';
import { useState } from 'react';

const s = {
  page: { maxWidth: '800px', margin: '0 auto', padding: '32px 24px' },
  welcome: { fontSize: '24px', fontWeight: '700', marginBottom: '8px' },
  sub: { fontSize: '14px', color: '#888', marginBottom: '32px' },
  card: { background: '#fff', borderRadius: '16px', padding: '24px', marginBottom: '20px', boxShadow: '0 2px 12px rgba(0,0,0,0.06)' },
  cardTitle: { fontSize: '18px', fontWeight: '700', marginBottom: '12px', color: '#1a1a2e' },
  stat: { display: 'inline-block', background: 'linear-gradient(135deg, #667eea, #764ba2)', borderRadius: '10px', padding: '12px 20px', color: '#fff', marginRight: '10px', marginBottom: '10px' },
  statLabel: { fontSize: '11px', fontWeight: '600', opacity: 0.8 },
  statValue: { fontSize: '20px', fontWeight: '800' },
  btn: { padding: '12px 24px', border: 'none', borderRadius: '10px', background: 'linear-gradient(135deg, #B37602, #8a5b00)', color: '#fff', fontSize: '14px', fontWeight: '600', cursor: 'pointer' },
  referral: { background: '#f0f7ff', border: '1px solid #d0e3f7', borderRadius: '10px', padding: '16px', marginTop: '12px' },
};

export default function MemberDashboard() {
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

  return (
    <div style={s.page}>
      <h1 style={s.welcome}>Hey, {user?.first_name || 'there'}!</h1>
      <p style={s.sub}>Your training dashboard</p>

      {/* Subscription */}
      <div style={s.card}>
        <div style={s.cardTitle}>Your Plan</div>
        <div style={s.stat}>
          <div style={s.statLabel}>CURRENT TIER</div>
          <div style={s.statValue}>{user?.tier || 'Free'}</div>
        </div>
        <div style={{ marginTop: '16px', display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
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
        <p style={{ fontSize: '14px', color: '#666', marginBottom: '12px' }}>
          Share your referral link and earn when people you refer subscribe.
        </p>
        {user?.referral_code && (
          <div style={s.referral}>
            <div style={{ fontSize: '12px', fontWeight: '600', color: '#1565c0', marginBottom: '4px' }}>Your Referral Link</div>
            <div style={{ fontSize: '14px', fontWeight: '600', wordBreak: 'break-all' }}>
              {window.location.origin}/register/{user.referral_code}
            </div>
          </div>
        )}
      </div>

      {/* Quick Links */}
      <div style={s.card}>
        <div style={s.cardTitle}>Quick Links</div>
        <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
          <a href="https://bestrongagain.netlify.app/" target="_blank" rel="noreferrer" style={s.btn}>
            Open Workout Tracker
          </a>
        </div>
      </div>
    </div>
  );
}
