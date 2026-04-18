import { useState, useEffect } from 'react';
import { api } from '../utils/api';
import useMediaQuery from '../hooks/useMediaQuery';

const buildStyles = (isMobile) => ({
  page: { maxWidth: '960px', margin: '0 auto', padding: isMobile ? '16px 12px' : '32px 24px' },
  title: { fontSize: isMobile ? '20px' : '24px', fontWeight: '700', marginBottom: '6px' },
  sub: { fontSize: '13px', color: '#888', marginBottom: '18px' },
  statRow: { display: 'flex', gap: isMobile ? '8px' : '12px', flexWrap: 'wrap', marginBottom: '18px' },
  stat: { flex: isMobile ? '1 1 calc(50% - 4px)' : '1 1 130px', minWidth: 0, borderRadius: '12px', padding: isMobile ? '12px' : '16px', color: '#fff', textAlign: 'center', cursor: 'pointer', transition: 'transform 0.15s' },
  statLabel: { fontSize: '10px', fontWeight: '600', opacity: 0.85, marginBottom: '4px', textTransform: 'uppercase' },
  statValue: { fontSize: isMobile ? '20px' : '24px', fontWeight: '800' },
  tabs: {
    display: 'flex', gap: '4px', marginBottom: '16px',
    borderBottom: '2px solid #e5e7eb',
    overflowX: 'auto', whiteSpace: 'nowrap',
    WebkitOverflowScrolling: 'touch',
    scrollbarWidth: 'thin',
  },
  tab: {
    padding: isMobile ? '8px 12px' : '10px 20px',
    fontSize: isMobile ? '12px' : '14px',
    fontWeight: '600', cursor: 'pointer',
    borderBottom: '3px solid transparent', color: '#888',
    background: 'none', border: 'none', borderRadius: '0',
    flex: '0 0 auto',
  },
  tabActive: { color: '#B37602', borderBottom: '3px solid #B37602' },
  card: { background: '#fff', borderRadius: '16px', padding: isMobile ? '14px' : '24px', marginBottom: '16px', boxShadow: '0 2px 12px rgba(0,0,0,0.06)' },
  cardTitle: { fontSize: isMobile ? '16px' : '18px', fontWeight: '700', marginBottom: '12px', color: '#1a1a2e' },
  tableWrap: { overflowX: 'auto', WebkitOverflowScrolling: 'touch', marginLeft: isMobile ? '-4px' : 0, marginRight: isMobile ? '-4px' : 0 },
  table: { width: '100%', borderCollapse: 'collapse', minWidth: isMobile ? '500px' : 'auto' },
  th: { textAlign: 'left', padding: isMobile ? '8px' : '10px 12px', fontSize: '11px', fontWeight: '600', color: '#888', borderBottom: '2px solid #f0f0f0', textTransform: 'uppercase', whiteSpace: 'nowrap' },
  td: { padding: isMobile ? '8px' : '12px', fontSize: '13px', borderBottom: '1px solid #f5f5f5', whiteSpace: 'nowrap' },
  badge: { padding: '4px 10px', borderRadius: '6px', fontSize: '12px', fontWeight: '600', display: 'inline-block' },
  btnSmall: { padding: isMobile ? '6px 10px' : '8px 16px', border: 'none', borderRadius: '8px', fontSize: isMobile ? '12px' : '13px', fontWeight: '600', cursor: 'pointer', marginRight: '6px' },
  appCard: { background: '#fff', border: '1px solid #e5e7eb', borderRadius: '12px', padding: isMobile ? '14px' : '20px', marginBottom: '12px' },
  appName: { fontSize: '16px', fontWeight: '700', marginBottom: '4px' },
  appEmail: { fontSize: '13px', color: '#888', marginBottom: '12px', wordBreak: 'break-word' },
  appField: { fontSize: '14px', color: '#444', marginBottom: '8px', lineHeight: '1.5' },
  appLabel: { fontSize: '12px', fontWeight: '600', color: '#B37602', textTransform: 'uppercase', marginBottom: '4px' },
});

export default function AdminDashboard() {
  const isMobile = useMediaQuery('(max-width: 640px)');
  const s = buildStyles(isMobile);

  const [overview, setOverview] = useState(null);
  const [members, setMembers] = useState([]);
  const [coaches, setCoaches] = useState([]);
  const [applications, setApplications] = useState([]);
  const [videos, setVideos] = useState([]);
  const [cfVideos, setCfVideos] = useState(null);  // null = not loaded yet
  const [cfLoading, setCfLoading] = useState(false);
  const [cfSearch, setCfSearch] = useState('');
  const [cfPreview, setCfPreview] = useState(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('overview');

  const loadCloudflare = async (search = '') => {
    setCfLoading(true);
    try {
      const res = await api.cloudflareList(search);
      setCfVideos(res.videos || []);
    } catch (err) {
      alert('Cloudflare list failed: ' + err.message);
      setCfVideos([]);
    }
    setCfLoading(false);
  };

  const loadData = () => {
    Promise.all([
      api.overview().catch(() => null),
      api.membersList().catch(() => ({ members: [] })),
      api.coachesList().catch(() => ({ coaches: [] })),
      api.coachApplications().catch(() => ({ applications: [] })),
      api.adminAllMedia().catch(() => ({ uploads: [] })),
    ]).then(([o, m, c, a, v]) => {
      setOverview(o);
      setMembers(m?.members || []);
      setCoaches(c?.coaches || []);
      setApplications(a?.applications || []);
      setVideos(v?.uploads || []);
      setLoading(false);
    });
  };

  useEffect(() => { loadData(); }, []);
  useEffect(() => {
    if (activeTab === 'cloudflare' && cfVideos === null && !cfLoading) loadCloudflare();
  }, [activeTab]);  // eslint-disable-line react-hooks/exhaustive-deps

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

  const handleToggleFeature = async (id, current) => {
    await api.featureMedia(id, !current);
    loadData();
  };

  const handleFlag = async (id, current) => {
    const next = current === 'flagged' ? 'live' : 'flagged';
    await api.flagMedia(id, next);
    loadData();
  };

  const handleRemoveVideo = async (id, name) => {
    if (!confirm(`Remove video for "${name}"? Coach won't see it anymore.`)) return;
    await api.flagMedia(id, 'removed');
    loadData();
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
    { id: 'videos', label: `Coach Uploads (${videos.length})` },
    { id: 'cloudflare', label: 'Cloudflare Library' },
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
                      <div style={s.tableWrap}>
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
                      </div>
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

      {/* Coach Uploads */}
      {activeTab === 'videos' && (
        <div style={s.card}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px', paddingBottom: '12px', borderBottom: '1px solid #f0f0f0' }}>
            <div style={{ fontSize: '13px', color: '#666' }}>
              All coach uploads across the platform. Use Feature/Flag/Remove to manage.
            </div>
            <a href="/media-library" style={{ ...s.btnSmall, background: 'linear-gradient(135deg, #ef4444, #dc2626)', color: '#fff', textDecoration: 'none', padding: '8px 14px' }}>
              + Upload Your Own Videos
            </a>
          </div>
          {videos.length === 0 ? (
            <p style={{ color: '#999', textAlign: 'center' }}>No coach uploads yet.</p>
          ) : (
            videos.map(v => {
              const coachName = `${v.first_name || ''} ${v.last_name || ''}`.trim() || v.email;
              const statusColor = v.status === 'flagged' ? '#ef4444' : v.status === 'removed' ? '#9ca3af' : '#16a34a';
              return (
                <div key={v.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 0', borderBottom: '1px solid #f0f0f0', flexWrap: 'wrap', gap: '8px' }}>
                  <div style={{ flex: '1 1 280px', minWidth: 0 }}>
                    <div style={{ fontWeight: 600 }}>
                      {v.exercise_name}
                      {v.featured_global && <span style={{ fontSize: '11px', color: '#fff', background: '#f59e0b', padding: '2px 6px', borderRadius: '4px', marginLeft: '8px' }}>FEATURED GLOBAL</span>}
                      <span style={{ fontSize: '11px', color: '#fff', background: statusColor, padding: '2px 6px', borderRadius: '4px', marginLeft: '6px' }}>{v.status}</span>
                    </div>
                    <div style={{ fontSize: '12px', color: '#888' }}>
                      by {coachName} &middot; {v.source_library} / {v.category || '—'} &middot; {v.media_type}
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: '6px' }}>
                    {v.media_type === 'video' && v.cloudflare_uid && (
                      <a href={`https://watch.cloudflarestream.com/${v.cloudflare_uid}`} target="_blank" rel="noreferrer" style={{ ...s.btnSmall, background: '#667eea', color: '#fff', textDecoration: 'none' }}>▶ View</a>
                    )}
                    <button style={{ ...s.btnSmall, background: v.featured_global ? '#fbbf24' : '#fef3c7', color: v.featured_global ? '#fff' : '#92400e' }} onClick={() => handleToggleFeature(v.id, v.featured_global)}>
                      {v.featured_global ? 'Un-feature' : 'Feature'}
                    </button>
                    <button style={{ ...s.btnSmall, background: v.status === 'flagged' ? '#86efac' : '#fde68a', color: v.status === 'flagged' ? '#065f46' : '#92400e' }} onClick={() => handleFlag(v.id, v.status)}>
                      {v.status === 'flagged' ? 'Un-flag' : 'Flag'}
                    </button>
                    <button style={{ ...s.btnSmall, background: '#ef4444', color: '#fff' }} onClick={() => handleRemoveVideo(v.id, v.exercise_name)}>Remove</button>
                  </div>
                </div>
              );
            })
          )}
        </div>
      )}

      {/* Cloudflare Library — every video in the Cloudflare Stream account */}
      {activeTab === 'cloudflare' && (
        <div style={s.card}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px', gap: '10px', flexWrap: 'wrap' }}>
            <div style={{ fontSize: '13px', color: '#666' }}>
              All videos in your Cloudflare Stream account ({cfVideos?.length ?? 0} loaded). Includes both bundled-library videos and coach uploads.
            </div>
            <div style={{ display: 'flex', gap: '6px' }}>
              <input
                type="text"
                placeholder="Search by name…"
                value={cfSearch}
                onChange={(e) => setCfSearch(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') loadCloudflare(cfSearch); }}
                style={{ padding: '6px 10px', border: '1px solid #ddd', borderRadius: '6px', fontSize: '13px' }}
              />
              <button style={{ ...s.btnSmall, background: '#667eea', color: '#fff' }} onClick={() => loadCloudflare(cfSearch)}>Search</button>
              <button style={{ ...s.btnSmall, background: '#e5e7eb', color: '#333' }} onClick={() => { setCfSearch(''); loadCloudflare(''); }}>Reset</button>
            </div>
          </div>
          {cfLoading && <p style={{ textAlign: 'center', color: '#888' }}>Loading from Cloudflare…</p>}
          {!cfLoading && cfVideos && cfVideos.length === 0 && (
            <p style={{ textAlign: 'center', color: '#888' }}>No videos found.</p>
          )}
          {!cfLoading && cfVideos && cfVideos.length > 0 && (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: '12px' }}>
              {cfVideos.map((v) => (
                <div key={v.uid} style={{ border: '1px solid #eee', borderRadius: '8px', overflow: 'hidden', background: '#fafafa' }}>
                  {v.thumbnail && (
                    <img src={v.thumbnail} alt={v.name} style={{ width: '100%', aspectRatio: '16/9', objectFit: 'cover', cursor: 'pointer', display: 'block' }} onClick={() => setCfPreview(cfPreview === v.uid ? null : v.uid)} />
                  )}
                  {cfPreview === v.uid && (
                    <div style={{ aspectRatio: '16/9', background: '#000' }}>
                      <iframe src={`https://iframe.videodelivery.net/${v.uid}?preload=metadata&autoplay=true`} style={{ width: '100%', height: '100%', border: 'none' }} allow="accelerometer; gyroscope; autoplay; encrypted-media; picture-in-picture" allowFullScreen />
                    </div>
                  )}
                  <div style={{ padding: '8px 10px' }}>
                    <div style={{ fontSize: '13px', fontWeight: 600, marginBottom: '4px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={v.name}>{v.name}</div>
                    <div style={{ fontSize: '11px', color: '#888', marginBottom: '6px' }}>
                      {v.duration ? `${Math.round(v.duration)}s` : '—'} {v.size ? `· ${(v.size / (1024 * 1024)).toFixed(1)}MB` : ''} {v.status_state ? `· ${v.status_state}` : ''}
                    </div>
                    <div style={{ display: 'flex', gap: '4px' }}>
                      <button style={{ ...s.btnSmall, background: '#667eea', color: '#fff', fontSize: '11px', padding: '3px 8px' }} onClick={() => setCfPreview(cfPreview === v.uid ? null : v.uid)}>{cfPreview === v.uid ? 'Hide' : 'Preview'}</button>
                      <button style={{ ...s.btnSmall, background: '#e5e7eb', color: '#333', fontSize: '11px', padding: '3px 8px' }} onClick={() => { navigator.clipboard.writeText(v.uid); }}>Copy UID</button>
                      <a href={v.watch_url} target="_blank" rel="noreferrer" style={{ ...s.btnSmall, background: '#fbbf24', color: '#fff', textDecoration: 'none', fontSize: '11px', padding: '3px 8px' }}>Open</a>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
