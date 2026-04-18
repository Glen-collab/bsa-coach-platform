import { useState, useEffect } from 'react';
import { api } from '../utils/api';

const s = {
  page: { maxWidth: '960px', margin: '0 auto', padding: '32px 24px' },
  title: { fontSize: '24px', fontWeight: '700', marginBottom: '8px' },
  sub: { fontSize: '14px', color: '#888', marginBottom: '24px' },
  statRow: { display: 'flex', gap: '12px', flexWrap: 'wrap', marginBottom: '24px' },
  stat: { flex: '1 1 130px', borderRadius: '12px', padding: '16px', color: '#fff', textAlign: 'center', cursor: 'pointer', transition: 'transform 0.15s' },
  statLabel: { fontSize: '10px', fontWeight: '600', opacity: 0.85, marginBottom: '4px', textTransform: 'uppercase' },
  statValue: { fontSize: '24px', fontWeight: '800' },
  tabs: { display: 'flex', gap: '4px', marginBottom: '20px', borderBottom: '2px solid #e5e7eb', paddingBottom: '0' },
  tab: { padding: '10px 20px', fontSize: '14px', fontWeight: '600', cursor: 'pointer', borderBottom: '3px solid transparent', color: '#888', background: 'none', border: 'none', borderRadius: '0' },
  tabActive: { color: '#B37602', borderBottom: '3px solid #B37602' },
  card: { background: '#fff', borderRadius: '16px', padding: '24px', marginBottom: '20px', boxShadow: '0 2px 12px rgba(0,0,0,0.06)' },
  cardTitle: { fontSize: '18px', fontWeight: '700', marginBottom: '16px', color: '#1a1a2e' },
  table: { width: '100%', borderCollapse: 'collapse' },
  th: { textAlign: 'left', padding: '10px 12px', fontSize: '12px', fontWeight: '600', color: '#888', borderBottom: '2px solid #f0f0f0', textTransform: 'uppercase' },
  td: { padding: '12px', fontSize: '14px', borderBottom: '1px solid #f5f5f5' },
  badge: { padding: '4px 10px', borderRadius: '6px', fontSize: '12px', fontWeight: '600', display: 'inline-block' },
  btnSmall: { padding: '8px 16px', border: 'none', borderRadius: '8px', fontSize: '13px', fontWeight: '600', cursor: 'pointer', marginRight: '6px' },
  appCard: { background: '#fff', border: '1px solid #e5e7eb', borderRadius: '12px', padding: '20px', marginBottom: '16px' },
  appName: { fontSize: '16px', fontWeight: '700', marginBottom: '4px' },
  appEmail: { fontSize: '13px', color: '#888', marginBottom: '12px' },
  appField: { fontSize: '14px', color: '#444', marginBottom: '8px', lineHeight: '1.5' },
  appLabel: { fontSize: '12px', fontWeight: '600', color: '#B37602', textTransform: 'uppercase', marginBottom: '4px' },
};

export default function AdminDashboard() {
  const [overview, setOverview] = useState(null);
  const [members, setMembers] = useState([]);
  const [coaches, setCoaches] = useState([]);
  const [applications, setApplications] = useState([]);
  const [videos, setVideos] = useState([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('overview');

  const loadData = () => {
    Promise.all([
      api.overview().catch(() => null),
      api.membersList().catch(() => ({ members: [] })),
      api.coachesList().catch(() => ({ coaches: [] })),
      api.coachApplications().catch(() => ({ applications: [] })),
      api.pendingVideos().catch(() => ({ videos: [] })),
    ]).then(([o, m, c, a, v]) => {
      setOverview(o);
      setMembers(m?.members || []);
      setCoaches(c?.coaches || []);
      setApplications(a?.applications || []);
      setVideos(v?.videos || []);
      setLoading(false);
    });
  };

  useEffect(() => { loadData(); }, []);

  const handleApproveCoach = async (id) => {
    const notes = prompt('Approval notes (optional):') || '';
    await api.approveCoach(id, notes);
    loadData();
  };

  const handleDenyCoach = async (id) => {
    const notes = prompt('Reason for denial:') || 'Didn\'t meet requirements at this time.';
    await api.denyCoach(id, notes);
    loadData();
  };

  const handleApproveVideo = async (id) => {
    await api.approveVideo(id);
    setVideos(prev => prev.filter(v => v.id !== id));
  };

  const handleRejectVideo = async (id) => {
    await api.rejectVideo(id);
    setVideos(prev => prev.filter(v => v.id !== id));
  };

  const [expandedCoach, setExpandedCoach] = useState(null);

  const handleDeactivateMember = async (memberId, name) => {
    if (!confirm(`Move ${name} to inactive? They won't show up anymore but their data is saved.`)) return;
    await api.deactivateMember(memberId);
    loadData();
  };

  const handleDeleteMember = async (memberId, name) => {
    if (!confirm(`Permanently delete ${name}? This cannot be undone.`)) return;
    await api.deleteMember(memberId);
    loadData();
  };

  const handleAssignMember = async (memberId) => {
    if (coaches.length === 0) { alert('No coaches available'); return; }
    const coachNames = coaches.map(c => `${c.first_name} ${c.last_name}`).join('\n');
    const pick = prompt(`Assign to which coach?\n\n${coaches.map((c, i) => `${i + 1}. ${c.first_name} ${c.last_name}`).join('\n')}\n\nEnter number:`);
    if (!pick) return;
    const idx = parseInt(pick) - 1;
    if (idx < 0 || idx >= coaches.length) { alert('Invalid selection'); return; }
    await api.assignMember(memberId, coaches[idx].id);
    loadData();
  };

  if (loading) return <div style={{ textAlign: 'center', padding: '60px', color: '#888' }}>Loading admin...</div>;

  const o = overview || {};
  const tabs = [
    { id: 'overview', label: 'Overview' },
    { id: 'members', label: `Members (${members.length})` },
    { id: 'coaches', label: `Coaches (${coaches.length})` },
    { id: 'applications', label: `Applications (${applications.length})` },
    { id: 'videos', label: `Videos (${videos.length})` },
  ];

  return (
    <div style={s.page}>
      <h1 style={s.title}>Admin Dashboard</h1>
      <p style={s.sub}>Platform overview and management</p>

      {/* Quick Tools */}
      <div style={{ display: 'flex', gap: '10px', marginBottom: '20px', flexWrap: 'wrap' }}>
        <a href={`https://workoutbuild.netlify.app/?sso=${encodeURIComponent(JSON.stringify({token: localStorage.getItem('bsa_token'), user: localStorage.getItem('bsa_user')}))}`} target="_blank" rel="noreferrer" style={{ padding: '10px 20px', background: 'linear-gradient(135deg, #B37602, #8a5b00)', color: '#fff', borderRadius: '10px', fontSize: '13px', fontWeight: '600', textDecoration: 'none' }}>
          Workout Builder
        </a>
        <a href={`https://bsa-trainer-dashboard.netlify.app/?sso=${encodeURIComponent(JSON.stringify({token: localStorage.getItem('bsa_token'), user: localStorage.getItem('bsa_user')}))}`} target="_blank" rel="noreferrer" style={{ padding: '10px 20px', background: 'linear-gradient(135deg, #667eea, #764ba2)', color: '#fff', borderRadius: '10px', fontSize: '13px', fontWeight: '600', textDecoration: 'none' }}>
          Trainer Dashboard
        </a>
        <a href="https://bestrongagain.netlify.app" target="_blank" rel="noreferrer" style={{ padding: '10px 20px', background: 'linear-gradient(135deg, #16a34a, #15803d)', color: '#fff', borderRadius: '10px', fontSize: '13px', fontWeight: '600', textDecoration: 'none' }}>
          Workout Tracker
        </a>
        <a href="https://bestrongagain.com" target="_blank" rel="noreferrer" style={{ padding: '10px 20px', background: '#1a1a2e', color: '#fff', borderRadius: '10px', fontSize: '13px', fontWeight: '600', textDecoration: 'none' }}>
          Website
        </a>
      </div>

      {/* Stats — clickable */}
      <div style={s.statRow}>
        <div style={{ ...s.stat, background: 'linear-gradient(135deg, #16a34a, #15803d)' }} onClick={() => setActiveTab('overview')}>
          <div style={s.statLabel}>Monthly Revenue</div>
          <div style={s.statValue}>${((o.mrr || 0)).toFixed(0)}</div>
        </div>
        <div style={{ ...s.stat, background: 'linear-gradient(135deg, #667eea, #764ba2)' }} onClick={() => setActiveTab('members')}>
          <div style={s.statLabel}>Members</div>
          <div style={s.statValue}>{o.total_members || 0}</div>
        </div>
        <div style={{ ...s.stat, background: 'linear-gradient(135deg, #B37602, #8a5b00)' }} onClick={() => setActiveTab('coaches')}>
          <div style={s.statLabel}>Coaches</div>
          <div style={s.statValue}>{o.total_coaches || 0}</div>
        </div>
        <div style={{ ...s.stat, background: applications.length > 0 ? 'linear-gradient(135deg, #f59e0b, #d97706)' : 'linear-gradient(135deg, #9ca3af, #6b7280)' }} onClick={() => setActiveTab('applications')}>
          <div style={s.statLabel}>Pending Apps</div>
          <div style={s.statValue}>{applications.length}</div>
        </div>
        <div style={{ ...s.stat, background: 'linear-gradient(135deg, #ef4444, #dc2626)' }} onClick={() => setActiveTab('videos')}>
          <div style={s.statLabel}>Pending Videos</div>
          <div style={s.statValue}>{videos.length}</div>
        </div>
      </div>

      {/* Tabs */}
      <div style={s.tabs}>
        {tabs.map(tab => (
          <button
            key={tab.id}
            style={{ ...s.tab, ...(activeTab === tab.id ? s.tabActive : {}) }}
            onClick={() => setActiveTab(tab.id)}
          >{tab.label}</button>
        ))}
      </div>

      {/* Overview */}
      {activeTab === 'overview' && (
        <div style={s.card}>
          <div style={s.cardTitle}>Subscription Breakdown</div>
          <div style={{ display: 'flex', gap: '16px', flexWrap: 'wrap' }}>
            {Object.entries(o.tier_breakdown || {}).map(([tier, count]) => (
              <div key={tier} style={{ background: '#f8f9fa', borderRadius: '10px', padding: '16px 24px', textAlign: 'center', flex: '1 1 120px' }}>
                <div style={{ fontSize: '12px', color: '#888', fontWeight: 600, textTransform: 'uppercase' }}>{tier}</div>
                <div style={{ fontSize: '28px', fontWeight: 800 }}>{count}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Members — unattached, dispatch queue */}
      {activeTab === 'members' && (
        <div style={s.card}>
          <div style={s.cardTitle}>Unattached Members</div>
          <p style={{ fontSize: '13px', color: '#888', marginBottom: '16px' }}>People who signed up but aren't under a coach yet. Assign them to get them started.</p>
          {members.length === 0 ? (
            <p style={{ color: '#16a34a', fontWeight: 600 }}>Everyone is assigned to a coach!</p>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table style={s.table}>
                <thead>
                  <tr>
                    <th style={s.th}>Name</th>
                    <th style={s.th}>Email</th>
                    <th style={s.th}>Tier</th>
                    <th style={s.th}>Joined</th>
                    <th style={s.th}>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {members.map(m => (
                    <tr key={m.id}>
                      <td style={s.td}>{m.first_name} {m.last_name}</td>
                      <td style={s.td}>{m.email}</td>
                      <td style={s.td}>
                        {m.tier ? (
                          <span style={{ ...s.badge, background: '#dcfce7', color: '#16a34a' }}>{m.tier}</span>
                        ) : (
                          <span style={{ ...s.badge, background: '#fef3c7', color: '#d97706' }}>Free</span>
                        )}
                      </td>
                      <td style={s.td}>{m.joined ? new Date(m.joined).toLocaleDateString() : '—'}</td>
                      <td style={s.td}>
                        <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap' }}>
                          <button onClick={() => handleAssignMember(m.id)} style={{ ...s.btnSmall, background: '#667eea', color: '#fff' }}>Assign</button>
                          <button onClick={() => handleDeactivateMember(m.id, `${m.first_name} ${m.last_name}`)} style={{ ...s.btnSmall, background: '#f59e0b', color: '#fff' }}>Inactive</button>
                          <button onClick={() => handleDeleteMember(m.id, `${m.first_name} ${m.last_name}`)} style={{ ...s.btnSmall, background: '#ef4444', color: '#fff' }}>Delete</button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Coaches — expandable with clients nested */}
      {activeTab === 'coaches' && (
        <div>
          {coaches.length === 0 ? (
            <div style={s.card}><p style={{ color: '#999' }}>No coaches yet. Approve applications to add coaches.</p></div>
          ) : (
            coaches.map(c => (
              <div key={c.id} style={{ ...s.card, marginBottom: '12px', cursor: 'pointer' }}>
                <div onClick={() => setExpandedCoach(expandedCoach === c.id ? null : c.id)} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div>
                    <div style={{ fontSize: '16px', fontWeight: 700 }}>{c.first_name} {c.last_name}</div>
                    <div style={{ fontSize: '13px', color: '#888' }}>{c.email} &middot; Code: <code>{c.referral_code}</code></div>
                  </div>
                  <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
                    <div style={{ textAlign: 'center' }}>
                      <div style={{ fontSize: '20px', fontWeight: 800, color: '#667eea' }}>{c.client_count || 0}</div>
                      <div style={{ fontSize: '10px', color: '#888' }}>clients</div>
                    </div>
                    <div style={{ textAlign: 'center' }}>
                      <div style={{ fontSize: '20px', fontWeight: 800, color: '#16a34a' }}>${((c.revenue || 0) / 100).toFixed(0)}</div>
                      <div style={{ fontSize: '10px', color: '#888' }}>MRR</div>
                    </div>
                    <span style={{ fontSize: '18px', color: '#ccc' }}>{expandedCoach === c.id ? '▼' : '▶'}</span>
                  </div>
                </div>

                {expandedCoach === c.id && (
                  <div style={{ marginTop: '16px', paddingTop: '16px', borderTop: '1px solid #f0f0f0' }}>
                    <div style={{ display: 'flex', gap: '8px', marginBottom: '12px', flexWrap: 'wrap' }}>
                      <span style={{ ...s.badge, ...(c.stripe_onboarded ? { background: '#dcfce7', color: '#16a34a' } : { background: '#fef3c7', color: '#d97706' }) }}>
                        Stripe: {c.stripe_onboarded ? 'Connected' : 'Pending'}
                      </span>
                      {c.referred_by && <span style={{ ...s.badge, background: '#e0e7ff', color: '#4338ca' }}>Referred by: {c.referred_by}</span>}
                    </div>

                    {(!c.clients || c.clients.length === 0) ? (
                      <p style={{ color: '#999', fontSize: '13px', fontStyle: 'italic' }}>No clients yet</p>
                    ) : (
                      <table style={{ ...s.table, fontSize: '13px' }}>
                        <thead>
                          <tr>
                            <th style={{ ...s.th, fontSize: '11px' }}>Client</th>
                            <th style={{ ...s.th, fontSize: '11px' }}>Email</th>
                            <th style={{ ...s.th, fontSize: '11px' }}>Tier</th>
                            <th style={{ ...s.th, fontSize: '11px' }}>Monthly</th>
                            <th style={{ ...s.th, fontSize: '11px' }}>Joined</th>
                            <th style={{ ...s.th, fontSize: '11px' }}>Actions</th>
                          </tr>
                        </thead>
                        <tbody>
                          {c.clients.map(cl => (
                            <tr key={cl.id}>
                              <td style={s.td}>{cl.first_name} {cl.last_name}</td>
                              <td style={s.td}>{cl.email}</td>
                              <td style={s.td}>
                                {cl.tier ? (
                                  <span style={{ ...s.badge, background: '#dcfce7', color: '#16a34a' }}>{cl.tier}</span>
                                ) : (
                                  <span style={{ ...s.badge, background: '#f3f4f6', color: '#888' }}>Free</span>
                                )}
                              </td>
                              <td style={s.td}>{cl.monthly ? `$${cl.monthly}` : '—'}</td>
                              <td style={s.td}>{cl.joined ? new Date(cl.joined).toLocaleDateString() : '—'}</td>
                              <td style={s.td}>
                                <div style={{ display: 'flex', gap: '4px' }}>
                                  <button onClick={(e) => { e.stopPropagation(); handleDeactivateMember(cl.id, `${cl.first_name} ${cl.last_name}`); }} style={{ ...s.btnSmall, background: '#f59e0b', color: '#fff', fontSize: '11px' }}>Inactive</button>
                                  <button onClick={(e) => { e.stopPropagation(); handleDeleteMember(cl.id, `${cl.first_name} ${cl.last_name}`); }} style={{ ...s.btnSmall, background: '#ef4444', color: '#fff', fontSize: '11px' }}>Delete</button>
                                </div>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    )}
                  </div>
                )}
              </div>
            ))
          )}
        </div>
      )}

      {/* Coach Applications */}
      {activeTab === 'applications' && (
        <div>
          {applications.length === 0 ? (
            <div style={s.card}>
              <p style={{ color: '#999', textAlign: 'center' }}>No pending applications.</p>
            </div>
          ) : (
            applications.map(app => (
              <div key={app.id} style={s.appCard}>
                <div style={s.appName}>{app.first_name} {app.last_name}</div>
                <div style={s.appEmail}>{app.email} &middot; Applied {app.applied_at ? new Date(app.applied_at).toLocaleDateString() : ''}</div>

                <div style={s.appLabel}>Experience</div>
                <div style={s.appField}>{app.experience}</div>

                {app.certifications && (
                  <>
                    <div style={s.appLabel}>Certifications</div>
                    <div style={s.appField}>{app.certifications}</div>
                  </>
                )}

                <div style={s.appLabel}>Why They Want to Coach</div>
                <div style={s.appField}>{app.why_coach}</div>

                {app.years_training && (
                  <div style={{ fontSize: '13px', color: '#888', marginBottom: '12px' }}>{app.years_training} years of training experience</div>
                )}

                <div style={{ display: 'flex', gap: '8px', marginTop: '16px' }}>
                  <button style={{ ...s.btnSmall, background: '#16a34a', color: '#fff' }} onClick={() => handleApproveCoach(app.id)}>
                    Approve
                  </button>
                  <button style={{ ...s.btnSmall, background: '#ef4444', color: '#fff' }} onClick={() => handleDenyCoach(app.id)}>
                    Deny
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      )}

      {/* Pending Videos */}
      {activeTab === 'videos' && (
        <div style={s.card}>
          {videos.length === 0 ? (
            <p style={{ color: '#999', textAlign: 'center' }}>No pending videos.</p>
          ) : (
            videos.map(v => (
              <div key={v.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 0', borderBottom: '1px solid #f0f0f0' }}>
                <div>
                  <div style={{ fontWeight: 600 }}>{v.title}</div>
                  <div style={{ fontSize: '12px', color: '#888' }}>by {v.uploaded_by} &middot; {v.duration_seconds ? `${Math.round(v.duration_seconds / 60)}min` : ''}</div>
                </div>
                <div>
                  <button style={{ ...s.btnSmall, background: '#16a34a', color: '#fff' }} onClick={() => handleApproveVideo(v.id)}>Approve</button>
                  <button style={{ ...s.btnSmall, background: '#ef4444', color: '#fff' }} onClick={() => handleRejectVideo(v.id)}>Reject</button>
                </div>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}
