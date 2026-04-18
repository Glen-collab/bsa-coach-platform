import { useState, useEffect } from 'react';
import { useAuth } from '../hooks/useAuth';
import { api } from '../utils/api';

const s = {
  page: { maxWidth: '900px', margin: '0 auto', padding: '32px 24px' },
  title: { fontSize: '24px', fontWeight: '700', marginBottom: '8px' },
  sub: { fontSize: '14px', color: '#888', marginBottom: '32px' },
  card: { background: '#fff', borderRadius: '16px', padding: '24px', marginBottom: '20px', boxShadow: '0 2px 12px rgba(0,0,0,0.06)' },
  cardTitle: { fontSize: '18px', fontWeight: '700', marginBottom: '16px', color: '#1a1a2e' },
  statRow: { display: 'flex', gap: '12px', flexWrap: 'wrap', marginBottom: '16px' },
  stat: { flex: '1 1 120px', background: 'linear-gradient(135deg, #667eea, #764ba2)', borderRadius: '10px', padding: '16px', color: '#fff', textAlign: 'center' },
  statGold: { flex: '1 1 120px', background: 'linear-gradient(135deg, #B37602, #8a5b00)', borderRadius: '10px', padding: '16px', color: '#fff', textAlign: 'center' },
  statGreen: { flex: '1 1 120px', background: 'linear-gradient(135deg, #16a34a, #15803d)', borderRadius: '10px', padding: '16px', color: '#fff', textAlign: 'center' },
  statLabel: { fontSize: '11px', fontWeight: '600', opacity: 0.85, marginBottom: '4px' },
  statValue: { fontSize: '22px', fontWeight: '800' },
  table: { width: '100%', borderCollapse: 'collapse' },
  th: { textAlign: 'left', padding: '10px 12px', fontSize: '12px', fontWeight: '600', color: '#888', borderBottom: '2px solid #f0f0f0', textTransform: 'uppercase' },
  td: { padding: '12px', fontSize: '14px', borderBottom: '1px solid #f5f5f5' },
  referral: { background: '#f0f7ff', border: '1px solid #d0e3f7', borderRadius: '10px', padding: '16px' },
  btn: { padding: '10px 20px', border: 'none', borderRadius: '8px', background: 'linear-gradient(135deg, #B37602, #8a5b00)', color: '#fff', fontSize: '13px', fontWeight: '600', cursor: 'pointer' },
  treeNode: { background: '#f8f9fa', borderRadius: '10px', padding: '12px 16px', marginBottom: '8px', marginLeft: '0' },
  treeChild: { marginLeft: '24px', borderLeft: '2px solid #e0e0e0', paddingLeft: '16px' },
};

export default function CoachDashboard() {
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
        <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
          <a href={`https://workoutbuild.netlify.app/?sso=${encodeURIComponent(JSON.stringify({token: localStorage.getItem('bsa_token'), user: localStorage.getItem('bsa_user')}))}`} target="_blank" rel="noreferrer" style={{ ...s.btn, textDecoration: 'none', textAlign: 'center', flex: '1 1 140px' }}>
            Workout Builder
          </a>
          <a href={`https://bsa-trainer-dashboard.netlify.app/?sso=${encodeURIComponent(JSON.stringify({token: localStorage.getItem('bsa_token'), user: localStorage.getItem('bsa_user')}))}`} target="_blank" rel="noreferrer" style={{ ...s.btn, textDecoration: 'none', textAlign: 'center', flex: '1 1 140px', background: 'linear-gradient(135deg, #667eea, #764ba2)' }}>
            Client Dashboard
          </a>
          <a href="https://bestrongagain.netlify.app" target="_blank" rel="noreferrer" style={{ ...s.btn, textDecoration: 'none', textAlign: 'center', flex: '1 1 140px', background: 'linear-gradient(135deg, #16a34a, #15803d)' }}>
            Workout Tracker
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
      )}
    </div>
  );
}
