import { useState, useEffect } from 'react';
import { useAuth } from '../hooks/useAuth';
import { api } from '../utils/api';
import useMediaQuery from '../hooks/useMediaQuery';

const buildStyles = (isMobile) => ({
  page: { maxWidth: '900px', margin: '0 auto', padding: isMobile ? '16px 12px' : '32px 24px' },
  title: { fontSize: isMobile ? '20px' : '24px', fontWeight: '700', marginBottom: '6px' },
  sub: { fontSize: '13px', color: '#888', marginBottom: isMobile ? '20px' : '32px' },
  card: { background: '#fff', borderRadius: '16px', padding: isMobile ? '16px' : '24px', marginBottom: isMobile ? '14px' : '20px', boxShadow: '0 2px 12px rgba(0,0,0,0.06)' },
  cardTitle: { fontSize: isMobile ? '16px' : '18px', fontWeight: '700', marginBottom: '12px', color: '#1a1a2e' },
  statRow: { display: 'grid', gridTemplateColumns: isMobile ? 'repeat(3, 1fr)' : 'repeat(3, 1fr)', gap: isMobile ? '8px' : '12px', marginBottom: '16px' },
  stat: { background: 'linear-gradient(135deg, #667eea, #764ba2)', borderRadius: '10px', padding: isMobile ? '10px 8px' : '16px', color: '#fff', textAlign: 'center', minWidth: 0 },
  statGold: { background: 'linear-gradient(135deg, #B37602, #8a5b00)', borderRadius: '10px', padding: isMobile ? '10px 8px' : '16px', color: '#fff', textAlign: 'center', minWidth: 0 },
  statGreen: { background: 'linear-gradient(135deg, #16a34a, #15803d)', borderRadius: '10px', padding: isMobile ? '10px 8px' : '16px', color: '#fff', textAlign: 'center', minWidth: 0 },
  statLabel: { fontSize: isMobile ? '10px' : '11px', fontWeight: '600', opacity: 0.85, marginBottom: '4px' },
  statValue: { fontSize: isMobile ? '18px' : '22px', fontWeight: '800' },
  tableWrap: { overflowX: 'auto', WebkitOverflowScrolling: 'touch' },
  table: { width: '100%', borderCollapse: 'collapse', minWidth: isMobile ? '440px' : 'auto' },
  th: { textAlign: 'left', padding: isMobile ? '8px' : '10px 12px', fontSize: '11px', fontWeight: '600', color: '#888', borderBottom: '2px solid #f0f0f0', textTransform: 'uppercase', whiteSpace: 'nowrap' },
  td: { padding: isMobile ? '8px' : '12px', fontSize: '13px', borderBottom: '1px solid #f5f5f5', whiteSpace: 'nowrap' },
  referral: { background: '#f0f7ff', border: '1px solid #d0e3f7', borderRadius: '10px', padding: isMobile ? '12px' : '16px' },
  btn: { padding: isMobile ? '12px 14px' : '10px 20px', border: 'none', borderRadius: '8px', background: 'linear-gradient(135deg, #B37602, #8a5b00)', color: '#fff', fontSize: isMobile ? '13px' : '13px', fontWeight: '600', cursor: 'pointer' },
  toolsRow: { display: 'grid', gridTemplateColumns: isMobile ? 'repeat(2, 1fr)' : 'repeat(auto-fit, minmax(160px, 1fr))', gap: '10px' },
  toolBtn: { padding: isMobile ? '14px 10px' : '12px 18px', border: 'none', borderRadius: '10px', color: '#fff', fontSize: isMobile ? '13px' : '14px', fontWeight: '600', cursor: 'pointer', textDecoration: 'none', textAlign: 'center', display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '48px', lineHeight: '1.2' },
  treeNode: { background: '#f8f9fa', borderRadius: '10px', padding: isMobile ? '10px 12px' : '12px 16px', marginBottom: '8px', marginLeft: '0', wordBreak: 'break-word' },
  treeChild: { marginLeft: isMobile ? '12px' : '24px', borderLeft: '2px solid #e0e0e0', paddingLeft: isMobile ? '10px' : '16px' },
});

export default function CoachDashboard() {
  const isMobile = useMediaQuery('(max-width: 640px)');
  const s = buildStyles(isMobile);
  const { user } = useAuth();
  const [data, setData] = useState(null);
  const [tree, setTree] = useState(null);
  const [earnings, setEarnings] = useState(null);
  const [loading, setLoading] = useState(true);
  const [connectLoading, setConnectLoading] = useState(false);

  useEffect(() => {
    if (!user?.id) return;
    Promise.all([
      api.dashboard(user.id).catch(() => null),
      api.tree(user.id).catch(() => null),
      api.earnings(user.id).catch(() => null),
    ]).then(([d, t, e]) => {
      setData(d);
      setTree(t);
      setEarnings(e);
      setLoading(false);
    });
  }, [user?.id]);

  const handleConnect = async () => {
    setConnectLoading(true);
    try {
      const res = await api.connectOnboard();
      if (res.onboarding_url) window.location.href = res.onboarding_url;
    } catch (err) {
      alert(err.message);
    }
    setConnectLoading(false);
  };

  if (loading) return <div style={{ textAlign: 'center', padding: '60px', color: '#888' }}>Loading dashboard...</div>;

  const clients = data?.clients || [];
  const summary = data?.earnings || {};
  const treeData = tree?.tree || [];

  return (
    <div style={s.page}>
      <h1 style={s.title}>Coach Dashboard</h1>
      <p style={s.sub}>Manage your clients, track earnings, and grow your team.</p>

      {/* Stripe Connect */}
      {!user?.stripe_onboarded && (
        <div style={{ ...s.card, background: '#fffbeb', border: '1px solid #f59e0b' }}>
          <div style={s.cardTitle}>Set Up Payouts</div>
          <p style={{ fontSize: '14px', color: '#666', marginBottom: '12px' }}>
            Connect your Stripe account to receive commission payouts.
          </p>
          <button style={s.btn} onClick={handleConnect} disabled={connectLoading}>
            {connectLoading ? 'Redirecting...' : 'Connect Stripe Account'}
          </button>
        </div>
      )}

      {/* Stats */}
      <div style={s.statRow}>
        <div style={s.stat}>
          <div style={s.statLabel}>ACTIVE CLIENTS</div>
          <div style={s.statValue}>{clients.length}</div>
        </div>
        <div style={s.statGold}>
          <div style={s.statLabel}>THIS MONTH</div>
          <div style={s.statValue}>${((summary.this_month || 0) / 100).toFixed(0)}</div>
        </div>
        <div style={s.statGreen}>
          <div style={s.statLabel}>ALL TIME</div>
          <div style={s.statValue}>${((summary.all_time || 0) / 100).toFixed(0)}</div>
        </div>
      </div>

      {/* Quick Tools */}
      <div style={s.card}>
        <div style={s.cardTitle}>Your Tools</div>
        <div style={s.toolsRow}>
          <a href={`https://workoutbuild.netlify.app/?sso=${encodeURIComponent(JSON.stringify({token: localStorage.getItem('bsa_token'), user: localStorage.getItem('bsa_user')}))}`} target="_blank" rel="noreferrer" style={{ ...s.toolBtn, background: 'linear-gradient(135deg, #B37602, #8a5b00)' }}>
            Workout Builder
          </a>
          <a href={`https://bsa-trainer-dashboard.netlify.app/?sso=${encodeURIComponent(JSON.stringify({token: localStorage.getItem('bsa_token'), user: localStorage.getItem('bsa_user')}))}`} target="_blank" rel="noreferrer" style={{ ...s.toolBtn, background: 'linear-gradient(135deg, #667eea, #764ba2)' }}>
            Client Dashboard
          </a>
          <a href="https://bestrongagain.netlify.app" target="_blank" rel="noreferrer" style={{ ...s.toolBtn, background: 'linear-gradient(135deg, #16a34a, #15803d)' }}>
            Workout Tracker
          </a>
          <a href="/media-library" style={{ ...s.toolBtn, background: 'linear-gradient(135deg, #ef4444, #dc2626)' }}>
            Your Video Library
          </a>
          <a href="/gym-tv" style={{ ...s.toolBtn, background: 'linear-gradient(135deg, #0891b2, #0e7490)' }}>
            Gym TV
          </a>
        </div>
      </div>

      {/* Referral Link */}
      <div style={s.card}>
        <div style={s.cardTitle}>Your Referral Link</div>
        <div style={s.referral}>
          <div style={{ fontSize: '14px', fontWeight: '600', wordBreak: 'break-all' }}>
            {window.location.origin}/register/{user?.referral_code || '...'}
          </div>
          <p style={{ fontSize: '12px', color: '#666', margin: '8px 0 0' }}>
            Share this link. You earn 20% on direct sign-ups and 10% on their referrals.
          </p>
        </div>
      </div>

      {/* Clients */}
      <div style={s.card}>
        <div style={s.cardTitle}>Your Clients</div>
        {clients.length === 0 ? (
          <p style={{ color: '#999', fontSize: '14px' }}>No clients yet. Share your referral link to get started.</p>
        ) : (
          <div style={s.tableWrap}>
          <table style={s.table}>
            <thead>
              <tr>
                <th style={s.th}>Name</th>
                <th style={s.th}>Tier</th>
                <th style={s.th}>Status</th>
                <th style={s.th}>Joined</th>
              </tr>
            </thead>
            <tbody>
              {clients.map((c) => (
                <tr key={c.id}>
                  <td style={s.td}>{c.first_name} {c.last_name}</td>
                  <td style={s.td}>{c.tier || '—'}</td>
                  <td style={s.td}>
                    <span style={{ color: c.status === 'active' ? '#16a34a' : '#dc2626', fontWeight: 600 }}>
                      {c.status || 'pending'}
                    </span>
                  </td>
                  <td style={s.td}>{c.joined ? new Date(c.joined).toLocaleDateString() : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        )}
      </div>

      {/* Downline Tree */}
      <div style={s.card}>
        <div style={s.cardTitle}>Your Team</div>
        {treeData.length === 0 ? (
          <p style={{ color: '#999', fontSize: '14px' }}>No team members yet.</p>
        ) : (
          treeData.map((node) => (
            <div key={node.id}>
              <div style={s.treeNode}>
                <strong>{node.first_name} {node.last_name}</strong>
                <span style={{ color: '#888', fontSize: '13px', marginLeft: '8px' }}>{node.commission_rate}</span>
              </div>
              {node.children?.map((child) => (
                <div key={child.id} style={s.treeChild}>
                  <div style={s.treeNode}>
                    <strong>{child.first_name} {child.last_name}</strong>
                    <span style={{ color: '#888', fontSize: '13px', marginLeft: '8px' }}>{child.commission_rate}</span>
                  </div>
                </div>
              ))}
            </div>
          ))
        )}
      </div>

      {/* Earnings History */}
      {earnings?.months?.length > 0 && (
        <div style={s.card}>
          <div style={s.cardTitle}>Earnings History</div>
          <div style={s.tableWrap}>
          <table style={s.table}>
            <thead>
              <tr>
                <th style={s.th}>Month</th>
                <th style={s.th}>Commissions</th>
                <th style={s.th}>Admin Fees</th>
                <th style={s.th}>Total</th>
              </tr>
            </thead>
            <tbody>
              {earnings.months.map((m) => (
                <tr key={m.month}>
                  <td style={s.td}>{m.month}</td>
                  <td style={s.td}>${((m.commissions || 0) / 100).toFixed(2)}</td>
                  <td style={s.td}>${((m.admin_fees || 0) / 100).toFixed(2)}</td>
                  <td style={{ ...s.td, fontWeight: 700 }}>${((m.total || 0) / 100).toFixed(2)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        </div>
      )}
    </div>
  );
}
