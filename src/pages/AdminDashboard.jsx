import { useState, useEffect } from 'react';
import { api } from '../utils/api';

const s = {
  page: { maxWidth: '960px', margin: '0 auto', padding: '32px 24px' },
  title: { fontSize: '24px', fontWeight: '700', marginBottom: '8px' },
  sub: { fontSize: '14px', color: '#888', marginBottom: '32px' },
  statRow: { display: 'flex', gap: '12px', flexWrap: 'wrap', marginBottom: '24px' },
  stat: { flex: '1 1 140px', borderRadius: '12px', padding: '20px', color: '#fff', textAlign: 'center' },
  statLabel: { fontSize: '11px', fontWeight: '600', opacity: 0.85, marginBottom: '4px' },
  statValue: { fontSize: '26px', fontWeight: '800' },
  card: { background: '#fff', borderRadius: '16px', padding: '24px', marginBottom: '20px', boxShadow: '0 2px 12px rgba(0,0,0,0.06)' },
  cardTitle: { fontSize: '18px', fontWeight: '700', marginBottom: '16px', color: '#1a1a2e' },
  table: { width: '100%', borderCollapse: 'collapse' },
  th: { textAlign: 'left', padding: '10px 12px', fontSize: '12px', fontWeight: '600', color: '#888', borderBottom: '2px solid #f0f0f0', textTransform: 'uppercase' },
  td: { padding: '12px', fontSize: '14px', borderBottom: '1px solid #f5f5f5' },
  badge: { padding: '4px 10px', borderRadius: '6px', fontSize: '12px', fontWeight: '600' },
  badgeActive: { background: '#dcfce7', color: '#16a34a' },
  badgePending: { background: '#fef3c7', color: '#d97706' },
  btnSmall: { padding: '6px 14px', border: 'none', borderRadius: '6px', fontSize: '12px', fontWeight: '600', cursor: 'pointer', marginRight: '6px' },
};

export default function AdminDashboard() {
  const [overview, setOverview] = useState(null);
  const [coaches, setCoaches] = useState([]);
  const [videos, setVideos] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      api.overview().catch(() => null),
      api.coachesList().catch(() => ({ coaches: [] })),
      api.pendingVideos().catch(() => ({ videos: [] })),
    ]).then(([o, c, v]) => {
      setOverview(o);
      setCoaches(c?.coaches || []);
      setVideos(v?.videos || []);
      setLoading(false);
    });
  }, []);

  const handleApprove = async (id) => {
    await api.approveVideo(id);
    setVideos((prev) => prev.filter((v) => v.id !== id));
  };

  const handleReject = async (id) => {
    await api.rejectVideo(id);
    setVideos((prev) => prev.filter((v) => v.id !== id));
  };

  if (loading) return <div style={{ textAlign: 'center', padding: '60px', color: '#888' }}>Loading admin...</div>;

  const o = overview || {};

  return (
    <div style={s.page}>
      <h1 style={s.title}>Admin Dashboard</h1>
      <p style={s.sub}>Platform overview and management</p>

      {/* Stats */}
      <div style={s.statRow}>
        <div style={{ ...s.stat, background: 'linear-gradient(135deg, #16a34a, #15803d)' }}>
          <div style={s.statLabel}>MONTHLY REVENUE</div>
          <div style={s.statValue}>${((o.mrr || 0) / 100).toFixed(0)}</div>
        </div>
        <div style={{ ...s.stat, background: 'linear-gradient(135deg, #667eea, #764ba2)' }}>
          <div style={s.statLabel}>TOTAL MEMBERS</div>
          <div style={s.statValue}>{o.total_members || 0}</div>
        </div>
        <div style={{ ...s.stat, background: 'linear-gradient(135deg, #B37602, #8a5b00)' }}>
          <div style={s.statLabel}>ACTIVE COACHES</div>
          <div style={s.statValue}>{o.total_coaches || 0}</div>
        </div>
        <div style={{ ...s.stat, background: 'linear-gradient(135deg, #ef4444, #dc2626)' }}>
          <div style={s.statLabel}>PENDING VIDEOS</div>
          <div style={s.statValue}>{videos.length}</div>
        </div>
      </div>

      {/* Tier Breakdown */}
      {o.tiers && (
        <div style={s.card}>
          <div style={s.cardTitle}>Subscription Breakdown</div>
          <div style={{ display: 'flex', gap: '16px', flexWrap: 'wrap' }}>
            {Object.entries(o.tiers).map(([tier, count]) => (
              <div key={tier} style={{ background: '#f8f9fa', borderRadius: '10px', padding: '16px 24px', textAlign: 'center' }}>
                <div style={{ fontSize: '12px', color: '#888', fontWeight: 600, textTransform: 'uppercase' }}>{tier}</div>
                <div style={{ fontSize: '24px', fontWeight: 800 }}>{count}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Coaches */}
      <div style={s.card}>
        <div style={s.cardTitle}>Coaches ({coaches.length})</div>
        {coaches.length === 0 ? (
          <p style={{ color: '#999', fontSize: '14px' }}>No coaches yet.</p>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={s.table}>
              <thead>
                <tr>
                  <th style={s.th}>Name</th>
                  <th style={s.th}>Email</th>
                  <th style={s.th}>Clients</th>
                  <th style={s.th}>Revenue</th>
                  <th style={s.th}>Stripe</th>
                </tr>
              </thead>
              <tbody>
                {coaches.map((c) => (
                  <tr key={c.id}>
                    <td style={s.td}>{c.first_name} {c.last_name}</td>
                    <td style={s.td}>{c.email}</td>
                    <td style={s.td}>{c.client_count || 0}</td>
                    <td style={s.td}>${((c.revenue || 0) / 100).toFixed(0)}</td>
                    <td style={s.td}>
                      <span style={{ ...s.badge, ...(c.stripe_onboarded ? s.badgeActive : s.badgePending) }}>
                        {c.stripe_onboarded ? 'Connected' : 'Pending'}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Pending Videos */}
      {videos.length > 0 && (
        <div style={s.card}>
          <div style={s.cardTitle}>Pending Video Approvals</div>
          {videos.map((v) => (
            <div key={v.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 0', borderBottom: '1px solid #f0f0f0' }}>
              <div>
                <div style={{ fontWeight: 600 }}>{v.title}</div>
                <div style={{ fontSize: '12px', color: '#888' }}>by {v.uploaded_by} &middot; {v.duration_seconds ? `${Math.round(v.duration_seconds / 60)}min` : ''}</div>
              </div>
              <div>
                <button style={{ ...s.btnSmall, background: '#16a34a', color: '#fff' }} onClick={() => handleApprove(v.id)}>Approve</button>
                <button style={{ ...s.btnSmall, background: '#ef4444', color: '#fff' }} onClick={() => handleReject(v.id)}>Reject</button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
