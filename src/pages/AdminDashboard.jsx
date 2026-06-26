import { useState, useEffect } from 'react';
import { api } from '../utils/api';
import useMediaQuery from '../hooks/useMediaQuery';
import BroadcastCard from '../components/BroadcastCard';
import GymTvPowerCard from '../components/GymTvPowerCard';
import { formatScore } from '../utils/challengeFormat';

// Compact goal chips for the admin tables. Empty array → em-dash so
// the column reads "this member never told us" rather than blank.
function renderGoals(goals) {
  if (!goals || !goals.length) return <span style={{ color: '#bbb' }}>—</span>;
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '3px', maxWidth: '180px' }}>
      {goals.map((g) => (
        <span
          key={g}
          style={{
            display: 'inline-block',
            background: '#fef3c7',
            color: '#92400e',
            padding: '2px 6px',
            borderRadius: '999px',
            fontSize: '10px',
            fontWeight: 700,
            whiteSpace: 'nowrap',
          }}
        >
          {g}
        </span>
      ))}
    </div>
  );
}

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
  toolsRow: { display: 'grid', gridTemplateColumns: isMobile ? 'repeat(2, 1fr)' : 'repeat(auto-fit, minmax(160px, 1fr))', gap: '10px', marginBottom: '18px' },
  toolBtn: { padding: isMobile ? '14px 10px' : '12px 18px', border: 'none', borderRadius: '10px', color: '#fff', fontSize: isMobile ? '13px' : '14px', fontWeight: '600', cursor: 'pointer', textDecoration: 'none', textAlign: 'center', display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '48px', lineHeight: '1.2' },
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
  const [proposals, setProposals] = useState(null);  // null = not loaded yet
  const [proposalsLoading, setProposalsLoading] = useState(false);
  const [proposalsFilter, setProposalsFilter] = useState('pending');
  // Challenges admin
  const [challenges, setChallenges] = useState(null);
  const [challengesLoading, setChallengesLoading] = useState(false);
  const [challengeFormOpen, setChallengeFormOpen] = useState(false);
  const [challengeForm, setChallengeForm] = useState({ title: '', description: '', unit: '', lower_is_better: false, start_date: '', end_date: '', duration_weeks: '' });
  const [challengeCreating, setChallengeCreating] = useState(false);
  const [expandedChallenge, setExpandedChallenge] = useState(null);
  const [challengeStandings, setChallengeStandings] = useState({});
  const [emailRows, setEmailRows] = useState(null);   // null = not loaded
  const [emailLoading, setEmailLoading] = useState(false);
  const [emailFailedOnly, setEmailFailedOnly] = useState(false);
  const [emailFails, setEmailFails] = useState(0);     // 7-day fail count for the tab badge
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState(() => {
    const p = new URLSearchParams(window.location.search);
    return p.get('tab') || 'overview';
  });
  const [myPrograms, setMyPrograms] = useState([]);
  const [togglingId, setTogglingId] = useState(null);
  const [templatesOpen, setTemplatesOpen] = useState(false);

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

  const loadProposals = async (status = proposalsFilter) => {
    setProposalsLoading(true);
    try {
      const res = await api.adminCustomExercises(status === 'all' ? undefined : status);
      setProposals(res.proposals || []);
    } catch (err) {
      alert('Proposals load failed: ' + err.message);
      setProposals([]);
    }
    setProposalsLoading(false);
  };

  const loadChallenges = async () => {
    setChallengesLoading(true);
    try {
      const res = await api.adminChallenges();
      setChallenges(res.challenges || []);
    } catch (err) {
      alert('Failed to load challenges: ' + err.message);
      setChallenges([]);
    }
    setChallengesLoading(false);
  };

  const loadEmailLog = async (failedOnly = emailFailedOnly) => {
    setEmailLoading(true);
    try {
      const res = await api.emailLog(failedOnly);
      setEmailRows(res.log || []);
      setEmailFails(res.recent_fails_7d || 0);
    } catch (err) {
      alert('Failed to load email log: ' + err.message);
      setEmailRows([]);
    }
    setEmailLoading(false);
  };

  const handleCreateChallenge = async () => {
    if (!challengeForm.title || !challengeForm.start_date || !challengeForm.end_date) {
      alert('Title, start date, and end date are required.');
      return;
    }
    setChallengeCreating(true);
    try {
      const payload = {
        ...challengeForm,
        duration_weeks: challengeForm.duration_weeks ? Number(challengeForm.duration_weeks) : null,
      };
      await api.createChallenge(payload);
      setChallengeForm({ title: '', description: '', unit: '', lower_is_better: false, start_date: '', end_date: '', duration_weeks: '' });
      setChallengeFormOpen(false);
      loadChallenges();
    } catch (err) {
      alert(err.message || 'Could not create challenge.');
    }
    setChallengeCreating(false);
  };

  const handleDeleteChallenge = async (id, title) => {
    if (!confirm(`Delete challenge "${title}"? This cannot be undone.`)) return;
    try {
      await api.deleteChallenge(id);
      loadChallenges();
    } catch (err) {
      alert(err.message || 'Could not delete challenge.');
    }
  };

  const toggleChallengeStandings = async (id) => {
    if (expandedChallenge === id) {
      setExpandedChallenge(null);
      return;
    }
    setExpandedChallenge(id);
    if (!challengeStandings[id]) {
      try {
        const res = await api.challengeStandings(id);
        setChallengeStandings((prev) => ({ ...prev, [id]: res.standings || [] }));
      } catch {
        setChallengeStandings((prev) => ({ ...prev, [id]: [] }));
      }
    }
  };

  const handleDecideProposal = async (id, name, status) => {
    if (status === 'rejected' && !confirm(`Reject "${name}"?`)) return;
    if (status === 'removed' && !confirm(`Remove "${name}"? It will disappear from coaches' libraries.`)) return;
    try {
      await api.decideCustomExercise(id, status);
      loadProposals();
    } catch (err) {
      alert(err.message);
    }
  };

  const loadData = () => {
    Promise.all([
      api.overview().catch(() => null),
      api.membersList().catch(() => ({ members: [] })),
      api.coachesList().catch(() => ({ coaches: [] })),
      api.coachApplications().catch(() => ({ applications: [] })),
      api.adminAllMedia().catch(() => ({ uploads: [] })),
      api.myPrograms('wisco.barbell@gmail.com').catch(() => null),
    ]).then(([o, m, c, a, v, progs]) => {
      setOverview(o);
      setMembers(m?.members || []);
      setCoaches(c?.coaches || []);
      setApplications(a?.applications || []);
      setVideos(v?.uploads || []);
      setMyPrograms(progs?.data?.programs || progs?.programs || []);
      setLoading(false);
    });
  };

  const toggleTemplate = async (p) => {
    setTogglingId(p.id);
    try {
      await api.adminToggleTemplate({
        programId: p.id,
        isTemplate: !p.isTemplate,
        adminEmail: 'wisco.barbell@gmail.com',
      });
      setMyPrograms((list) =>
        list.map((x) => (x.id === p.id ? { ...x, isTemplate: !p.isTemplate } : x))
      );
    } catch (e) {
      alert('Toggle failed: ' + (e.message || 'error'));
    } finally {
      setTogglingId(null);
    }
  };

  useEffect(() => { loadData(); }, []);
  useEffect(() => {
    if (activeTab === 'cloudflare' && cfVideos === null && !cfLoading) loadCloudflare();
    if (activeTab === 'proposals' && proposals === null && !proposalsLoading) loadProposals();
    if (activeTab === 'challenges' && challenges === null && !challengesLoading) loadChallenges();
    if (activeTab === 'emaillog' && emailRows === null && !emailLoading) loadEmailLog();
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
    { id: 'proposals', label: `Exercise Requests${proposals ? ` (${proposals.filter(p => p.status === 'pending').length})` : ''}` },
    { id: 'challenges', label: 'Challenges' },
    { id: 'emaillog', label: `Email Log${emailFails ? ` (${emailFails}⚠)` : ''}` },
  ];

  return (
    <div style={s.page}>
      <h1 style={s.title}>Admin Dashboard</h1>
      <p style={s.sub}>Platform overview and management</p>

      {/* Quick Tools */}
      <div style={s.toolsRow}>
        <a href={`https://workoutbuild.netlify.app/?sso=${encodeURIComponent(JSON.stringify({token: localStorage.getItem('bsa_token'), user: localStorage.getItem('bsa_user')}))}`} target="_blank" rel="noreferrer" style={{ ...s.toolBtn, background: 'linear-gradient(135deg, #B37602, #8a5b00)' }}>
          Workout Builder
        </a>
        <a href={`https://bsa-trainer-dashboard.netlify.app/?sso=${encodeURIComponent(JSON.stringify({token: localStorage.getItem('bsa_token'), user: localStorage.getItem('bsa_user')}))}`} target="_blank" rel="noreferrer" style={{ ...s.toolBtn, background: 'linear-gradient(135deg, #667eea, #764ba2)' }}>
          Trainer Dashboard
        </a>
        <a href="https://bestrongagain.netlify.app" target="_blank" rel="noreferrer" style={{ ...s.toolBtn, background: 'linear-gradient(135deg, #16a34a, #15803d)' }}>
          Workout Tracker
        </a>
        <a href="https://bestrongagain.com" target="_blank" rel="noreferrer" style={{ ...s.toolBtn, background: '#1a1a2e' }}>
          Website
        </a>
        <a href="/gym-tv" style={{ ...s.toolBtn, background: 'linear-gradient(135deg, #0891b2, #0e7490)' }}>
          Gym TV
        </a>
        <a href="/coach" style={{ ...s.toolBtn, background: 'linear-gradient(135deg, #f59e0b, #d97706)' }}>
          Coach Dashboard
        </a>
        <a href="/brand" style={{ ...s.toolBtn, background: 'linear-gradient(135deg, #ec4899, #be185d)' }}>
          Gym Branding
        </a>
        <a href={`https://leaderboard.bestrongagain.com?from=${encodeURIComponent(window.location.href)}`} target="_blank" rel="noreferrer" style={{ ...s.toolBtn, background: 'linear-gradient(135deg, #fbbf24, #d97706)' }}>
          Leaderboard
        </a>
      </div>

      {/* Remote Pi power for the gym TV — same card the Coach Dashboard has */}
      <GymTvPowerCard isMobile={isMobile} s={s} />

      {/* Admin broadcast — mass-message all your clients */}
      <BroadcastCard isMobile={isMobile} />

      {/* Template Library admin — flag programs that every coach can clone */}
      <div style={s.card}>
        <button
          style={{ width: '100%', textAlign: 'left', background: 'none', border: 'none', cursor: 'pointer', padding: 0, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}
          onClick={() => setTemplatesOpen((v) => !v)}
        >
          <div>
            <div style={s.cardTitle}>
              📚 Template Library (Admin)
              {myPrograms.filter((p) => p.isTemplate).length > 0 && (
                <span style={{ fontSize: '12px', background: '#10b981', color: '#fff', padding: '3px 10px', borderRadius: '999px', marginLeft: '10px', fontWeight: '700' }}>
                  {myPrograms.filter((p) => p.isTemplate).length} active
                </span>
              )}
            </div>
            <div style={{ fontSize: '11px', color: '#888', marginTop: '2px' }}>
              {myPrograms.length} program{myPrograms.length === 1 ? '' : 's'} — tap to {templatesOpen ? 'collapse' : 'expand'}
            </div>
          </div>
          <span style={{ fontSize: '20px', color: '#888', transform: templatesOpen ? 'rotate(180deg)' : 'none', transition: 'transform .15s' }}>▾</span>
        </button>
        {templatesOpen && (
          <div style={{ marginTop: '14px' }}>
            <p style={{ fontSize: '12px', color: '#666', margin: '0 0 12px' }}>
              Flag programs as public templates. Flagged ones appear on every coach's dashboard with a "Clone" button — they get a copy under their own access code.
            </p>
            {myPrograms.length === 0 ? (
              <div style={{ fontSize: '13px', color: '#888', fontStyle: 'italic' }}>No programs yet.</div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                {myPrograms.map((p) => (
                  <div key={p.id} style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '10px 12px', background: p.isTemplate ? '#ecfdf5' : '#f9fafb', border: '1px solid ' + (p.isTemplate ? '#86efac' : '#e5e7eb'), borderRadius: '8px', flexWrap: 'wrap' }}>
                    <div style={{ flex: 1, minWidth: '160px' }}>
                      <div style={{ fontSize: '14px', fontWeight: '700', color: '#1a1a2e' }}>
                        {p.name} {p.isTemplate && <span style={{ fontSize: '11px', background: '#10b981', color: '#fff', padding: '2px 8px', borderRadius: '999px', marginLeft: '6px' }}>TEMPLATE</span>}
                      </div>
                      <div style={{ fontSize: '11px', color: '#888' }}>Code: {p.accessCode}</div>
                    </div>
                    <button
                      style={{ padding: '7px 14px', border: 'none', borderRadius: '6px', background: p.isTemplate ? '#b91c1c' : '#10b981', color: '#fff', fontSize: '12px', fontWeight: '700', cursor: togglingId === p.id ? 'wait' : 'pointer', opacity: togglingId === p.id ? 0.6 : 1 }}
                      onClick={() => toggleTemplate(p)}
                      disabled={togglingId === p.id}
                    >
                      {togglingId === p.id ? '…' : p.isTemplate ? 'Remove from Templates' : 'Make Template'}
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
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
          <div style={s.statLabel}>Coach Uploads</div>
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
                    <th style={s.th}>Goals</th>
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
                      <td style={s.td}>{renderGoals(m.goals)}</td>
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
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                        {c.clients.map(cl => (
                          <div key={cl.id} style={{
                            background: '#f9fafb', borderRadius: '10px', padding: '12px 14px',
                            border: '1px solid #e5e7eb',
                          }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '6px' }}>
                              <div>
                                <div style={{ fontWeight: '700', fontSize: '14px', color: '#1a1a2e' }}>{cl.first_name} {cl.last_name}</div>
                                <div style={{ fontSize: '12px', color: '#888' }}>{cl.email}</div>
                              </div>
                              {cl.tier ? (
                                <span style={{ ...s.badge, background: '#dcfce7', color: '#16a34a' }}>{cl.tier}</span>
                              ) : (
                                <span style={{ ...s.badge, background: '#f3f4f6', color: '#888' }}>Free</span>
                              )}
                            </div>
                            <div style={{ display: 'flex', gap: '6px', fontSize: '11px', color: '#888', marginBottom: '8px', flexWrap: 'wrap' }}>
                              {cl.goals?.length > 0 && <span>{renderGoals(cl.goals)}</span>}
                              {cl.joined && <span>Joined {new Date(cl.joined).toLocaleDateString()}</span>}
                              {cl.monthly && <span>${cl.monthly}/mo</span>}
                            </div>
                            <div style={{ display: 'flex', gap: '6px' }}>
                              <button onClick={(e) => { e.stopPropagation(); handleDeactivateMember(cl.id, `${cl.first_name} ${cl.last_name}`); }} style={{ ...s.btnSmall, background: '#f59e0b', color: '#fff', fontSize: '11px' }}>Inactive</button>
                              <button onClick={(e) => { e.stopPropagation(); handleDeleteMember(cl.id, `${cl.first_name} ${cl.last_name}`); }} style={{ ...s.btnSmall, background: '#ef4444', color: '#fff', fontSize: '11px' }}>Delete</button>
                            </div>
                          </div>
                        ))}
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
            <div>
              {cfVideos.map((v) => (
                <div key={v.uid}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 0', borderBottom: '1px solid #f0f0f0', gap: '8px', flexWrap: 'wrap' }}>
                    <div style={{ flex: '1 1 240px', minWidth: 0 }}>
                      <div style={{ fontSize: '14px', fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={v.name}>{v.name}</div>
                      <div style={{ fontSize: '11px', color: '#888' }}>
                        {v.duration ? `${Math.round(v.duration)}s` : '—'}
                        {v.size ? ` · ${(v.size / (1024 * 1024)).toFixed(1)}MB` : ''}
                        {v.status_state ? ` · ${v.status_state}` : ''}
                      </div>
                    </div>
                    <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap' }}>
                      <button style={{ ...s.btnSmall, background: '#667eea', color: '#fff' }} onClick={() => setCfPreview(cfPreview === v.uid ? null : v.uid)}>{cfPreview === v.uid ? 'Hide' : '▶ Preview'}</button>
                      <button style={{ ...s.btnSmall, background: '#e5e7eb', color: '#333' }} onClick={() => navigator.clipboard.writeText(v.uid)}>Copy UID</button>
                      <a href={v.watch_url} target="_blank" rel="noreferrer" style={{ ...s.btnSmall, background: '#fbbf24', color: '#fff', textDecoration: 'none' }}>Open</a>
                    </div>
                  </div>
                  {cfPreview === v.uid && (
                    <div style={{ aspectRatio: '16/9', background: '#000', marginBottom: '8px', borderRadius: '8px', overflow: 'hidden' }}>
                      <iframe src={`https://iframe.videodelivery.net/${v.uid}?preload=metadata&autoplay=true`} style={{ width: '100%', height: '100%', border: 'none' }} allow="accelerometer; gyroscope; autoplay; encrypted-media; picture-in-picture" allowFullScreen />
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Exercise Requests (proposals) */}
      {activeTab === 'proposals' && (
        <div style={s.card}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '10px', flexWrap: 'wrap', marginBottom: '12px' }}>
            <div style={{ fontSize: '13px', color: '#666' }}>
              Coach-proposed exercises. Approve to add them to the platform library.
            </div>
            <select value={proposalsFilter} onChange={(e) => { setProposalsFilter(e.target.value); loadProposals(e.target.value); }} style={{ padding: '6px 10px', border: '1px solid #ddd', borderRadius: '6px', fontSize: '13px' }}>
              <option value="pending">Pending</option>
              <option value="approved">Approved</option>
              <option value="rejected">Rejected</option>
              <option value="removed">Removed</option>
              <option value="all">All</option>
            </select>
          </div>
          {proposalsLoading && <p style={{ textAlign: 'center', color: '#888' }}>Loading…</p>}
          {!proposalsLoading && proposals && proposals.length === 0 && (
            <p style={{ textAlign: 'center', color: '#888' }}>No {proposalsFilter === 'all' ? '' : proposalsFilter} proposals.</p>
          )}
          {!proposalsLoading && proposals && proposals.map(p => {
            const coachName = `${p.first_name || ''} ${p.last_name || ''}`.trim() || p.email || 'Unknown';
            const statusColor = p.status === 'pending' ? '#f59e0b' : p.status === 'approved' ? '#16a34a' : p.status === 'rejected' ? '#ef4444' : '#9ca3af';
            return (
              <div key={p.id} style={{ padding: '12px 0', borderBottom: '1px solid #f0f0f0', display: 'flex', gap: '8px', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <div style={{ flex: '1 1 280px', minWidth: 0 }}>
                  <div style={{ fontWeight: 600, fontSize: '15px', marginBottom: '2px' }}>
                    {p.name}
                    <span style={{ fontSize: '11px', color: '#fff', background: statusColor, padding: '2px 6px', borderRadius: '4px', marginLeft: '8px' }}>{p.status}</span>
                  </div>
                  <div style={{ fontSize: '12px', color: '#666' }}>
                    by {coachName} · {p.source_library} / {p.category || '—'}
                  </div>
                  {p.description && <div style={{ fontSize: '13px', color: '#444', marginTop: '6px', fontStyle: 'italic' }}>"{p.description}"</div>}
                </div>
                <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap' }}>
                  {p.status !== 'approved' && (
                    <button style={{ ...s.btnSmall, background: '#16a34a', color: '#fff' }} onClick={() => handleDecideProposal(p.id, p.name, 'approved')}>Approve</button>
                  )}
                  {p.status === 'pending' && (
                    <button style={{ ...s.btnSmall, background: '#ef4444', color: '#fff' }} onClick={() => handleDecideProposal(p.id, p.name, 'rejected')}>Reject</button>
                  )}
                  {p.status === 'approved' && (
                    <button style={{ ...s.btnSmall, background: '#ef4444', color: '#fff' }} onClick={() => handleDecideProposal(p.id, p.name, 'removed')}>Remove</button>
                  )}
                  {(p.status === 'rejected' || p.status === 'removed') && (
                    <button style={{ ...s.btnSmall, background: '#667eea', color: '#fff' }} onClick={() => handleDecideProposal(p.id, p.name, 'pending')}>Re-open</button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Challenges */}
      {activeTab === 'challenges' && (
        <div style={s.card}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px', flexWrap: 'wrap', gap: '10px' }}>
            <div style={{ fontSize: '13px', color: '#666' }}>
              Create and manage member challenges. Active challenges appear on every member dashboard.
            </div>
            <button
              onClick={() => setChallengeFormOpen(!challengeFormOpen)}
              style={{ ...s.btnSmall, background: challengeFormOpen ? '#ef4444' : '#16a34a', color: '#fff' }}
            >
              {challengeFormOpen ? 'Cancel' : '+ Create Challenge'}
            </button>
          </div>

          {/* Inline create form */}
          {challengeFormOpen && (
            <div style={{
              background: '#f9fafb', border: '1px solid #e5e7eb', borderRadius: '12px',
              padding: isMobile ? '14px' : '20px', marginBottom: '18px',
            }}>
              <div style={{ fontSize: '15px', fontWeight: 700, marginBottom: '14px', color: '#1a1a2e' }}>New Challenge</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                <div>
                  <label style={{ fontSize: '12px', fontWeight: 600, color: '#666', display: 'block', marginBottom: '4px' }}>Title</label>
                  <input
                    type="text"
                    value={challengeForm.title}
                    onChange={(e) => setChallengeForm({ ...challengeForm, title: e.target.value })}
                    placeholder="e.g. June Tonnage War"
                    style={{ width: '100%', padding: '10px 12px', border: '1px solid #ddd', borderRadius: '8px', fontSize: '14px', boxSizing: 'border-box' }}
                  />
                </div>
                <div>
                  <label style={{ fontSize: '12px', fontWeight: 600, color: '#666', display: 'block', marginBottom: '4px' }}>Description</label>
                  <textarea
                    value={challengeForm.description}
                    onChange={(e) => setChallengeForm({ ...challengeForm, description: e.target.value })}
                    placeholder="Who can move the most weight this month?"
                    rows={3}
                    style={{ width: '100%', padding: '10px 12px', border: '1px solid #ddd', borderRadius: '8px', fontSize: '14px', resize: 'vertical', boxSizing: 'border-box' }}
                  />
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr', gap: '10px' }}>
                  <div>
                    <label style={{ fontSize: '12px', fontWeight: 600, color: '#666', display: 'block', marginBottom: '4px' }}>Unit of measurement</label>
                    <input
                      type="text"
                      list="challenge-units"
                      value={challengeForm.unit}
                      onChange={(e) => setChallengeForm({ ...challengeForm, unit: e.target.value })}
                      placeholder="e.g. mm:ss, reps, lbs, miles"
                      style={{ width: '100%', padding: '10px 12px', border: '1px solid #ddd', borderRadius: '8px', fontSize: '14px', boxSizing: 'border-box' }}
                    />
                    <datalist id="challenge-units">
                      <option value="mm:ss" />
                      <option value="reps" />
                      <option value="lbs" />
                      <option value="miles" />
                      <option value="meters" />
                    </datalist>
                    <div style={{ fontSize: '11px', color: '#888', marginTop: '4px' }}>
                      Timed event? Use <b>mm:ss</b> — results enter & display as a clock (8:30 → 08:30.00).
                    </div>
                  </div>
                  <div>
                    <label style={{ fontSize: '12px', fontWeight: 600, color: '#666', display: 'block', marginBottom: '4px' }}>Duration (weeks)</label>
                    <input
                      type="number"
                      value={challengeForm.duration_weeks}
                      onChange={(e) => setChallengeForm({ ...challengeForm, duration_weeks: e.target.value })}
                      placeholder="Optional"
                      min="1"
                      style={{ width: '100%', padding: '10px 12px', border: '1px solid #ddd', borderRadius: '8px', fontSize: '14px', boxSizing: 'border-box' }}
                    />
                  </div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginTop: '2px' }}>
                  <input
                    type="checkbox"
                    id="lower_is_better"
                    checked={challengeForm.lower_is_better}
                    onChange={(e) => setChallengeForm({ ...challengeForm, lower_is_better: e.target.checked })}
                    style={{ width: '18px', height: '18px', cursor: 'pointer' }}
                  />
                  <label htmlFor="lower_is_better" style={{ fontSize: '13px', color: '#444', cursor: 'pointer' }}>
                    Lower score wins (check for time-based challenges)
                  </label>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr', gap: '10px' }}>
                  <div>
                    <label style={{ fontSize: '12px', fontWeight: 600, color: '#666', display: 'block', marginBottom: '4px' }}>Start Date</label>
                    <input
                      type="date"
                      value={challengeForm.start_date}
                      onChange={(e) => setChallengeForm({ ...challengeForm, start_date: e.target.value })}
                      style={{ width: '100%', padding: '10px 12px', border: '1px solid #ddd', borderRadius: '8px', fontSize: '14px', boxSizing: 'border-box' }}
                    />
                  </div>
                  <div>
                    <label style={{ fontSize: '12px', fontWeight: 600, color: '#666', display: 'block', marginBottom: '4px' }}>End Date</label>
                    <input
                      type="date"
                      value={challengeForm.end_date}
                      onChange={(e) => setChallengeForm({ ...challengeForm, end_date: e.target.value })}
                      style={{ width: '100%', padding: '10px 12px', border: '1px solid #ddd', borderRadius: '8px', fontSize: '14px', boxSizing: 'border-box' }}
                    />
                  </div>
                </div>
                <button
                  onClick={handleCreateChallenge}
                  disabled={challengeCreating}
                  style={{
                    padding: '12px 24px', border: 'none', borderRadius: '8px',
                    background: 'linear-gradient(135deg, #16a34a, #15803d)', color: '#fff',
                    fontSize: '14px', fontWeight: 700, cursor: 'pointer',
                    opacity: challengeCreating ? 0.6 : 1, marginTop: '4px',
                  }}
                >
                  {challengeCreating ? 'Creating...' : 'Create Challenge'}
                </button>
              </div>
            </div>
          )}

          {/* Challenges list */}
          {challengesLoading && <p style={{ textAlign: 'center', color: '#888' }}>Loading challenges...</p>}
          {!challengesLoading && challenges && challenges.length === 0 && (
            <p style={{ textAlign: 'center', color: '#888' }}>No challenges yet. Create one to get started.</p>
          )}
          {!challengesLoading && challenges && challenges.length > 0 && (
            <div style={s.tableWrap}>
              <table style={s.table}>
                <thead>
                  <tr>
                    <th style={s.th}>Title</th>
                    <th style={s.th}>Unit</th>
                    <th style={s.th}>Dates</th>
                    <th style={s.th}>Status</th>
                    <th style={s.th}>Participants</th>
                    <th style={s.th}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {challenges.map((ch) => {
                    const statusColors = { upcoming: '#3b82f6', active: '#16a34a', completed: '#9ca3af' };
                    const statusBg = { upcoming: '#eff6ff', active: '#dcfce7', completed: '#f3f4f6' };
                    const status = ch.status || 'upcoming';
                    return (
                      <tr key={ch.id} style={{ cursor: 'pointer' }} onClick={() => toggleChallengeStandings(ch.id)}>
                        <td style={s.td}>
                          <div style={{ fontWeight: 600 }}>{ch.title}</div>
                          {ch.description && <div style={{ fontSize: '11px', color: '#888', marginTop: '2px', whiteSpace: 'normal', maxWidth: '200px' }}>{ch.description}</div>}
                        </td>
                        <td style={s.td}>{ch.unit || '--'}</td>
                        <td style={s.td}>
                          <div style={{ fontSize: '12px' }}>{ch.start_date}</div>
                          <div style={{ fontSize: '11px', color: '#888' }}>to {ch.end_date}</div>
                        </td>
                        <td style={s.td}>
                          <span style={{
                            ...s.badge,
                            background: statusBg[status] || '#f3f4f6',
                            color: statusColors[status] || '#888',
                          }}>{status}</span>
                        </td>
                        <td style={s.td}>{ch.participant_count ?? 0}</td>
                        <td style={s.td}>
                          <div style={{ display: 'flex', gap: '4px' }}>
                            <button
                              onClick={(e) => { e.stopPropagation(); toggleChallengeStandings(ch.id); }}
                              style={{ ...s.btnSmall, background: '#667eea', color: '#fff' }}
                            >
                              {expandedChallenge === ch.id ? 'Hide' : 'Standings'}
                            </button>
                            <button
                              onClick={(e) => { e.stopPropagation(); handleDeleteChallenge(ch.id, ch.title); }}
                              style={{ ...s.btnSmall, background: '#ef4444', color: '#fff' }}
                            >
                              Delete
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>

              {/* Expanded standings under the table */}
              {expandedChallenge && (
                <div style={{
                  background: '#f9fafb', border: '1px solid #e5e7eb', borderRadius: '10px',
                  padding: '16px', marginTop: '12px',
                }}>
                  <div style={{ fontSize: '14px', fontWeight: 700, color: '#1a1a2e', marginBottom: '10px' }}>
                    Standings: {challenges.find(c => c.id === expandedChallenge)?.title}
                  </div>
                  {!challengeStandings[expandedChallenge] ? (
                    <p style={{ color: '#888', fontSize: '13px' }}>Loading standings...</p>
                  ) : challengeStandings[expandedChallenge].length === 0 ? (
                    <p style={{ color: '#888', fontSize: '13px' }}>No participants yet.</p>
                  ) : (
                    <table style={{ ...s.table, minWidth: 'auto' }}>
                      <thead>
                        <tr>
                          <th style={s.th}>#</th>
                          <th style={s.th}>Name</th>
                          <th style={s.th}>Score</th>
                        </tr>
                      </thead>
                      <tbody>
                        {challengeStandings[expandedChallenge].map((row, i) => (
                          <tr key={i}>
                            <td style={{ ...s.td, fontWeight: 700, color: i === 0 ? '#d97706' : '#333' }}>{i + 1}</td>
                            <td style={s.td}>{row.first_name} {row.last_name || ''}</td>
                            <td style={{ ...s.td, fontWeight: 700, color: '#16a34a' }}>{formatScore(row.score, challenges.find(c => c.id === expandedChallenge)?.unit)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {activeTab === 'emaillog' && (
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', marginBottom: 12 }}>
            <p style={{ ...s.sub, margin: 0 }}>Every email the app sends — recaps, workout notifications, welcomes. ✗ = it didn't go (bad address / bounce).</p>
            <button onClick={() => { const v = !emailFailedOnly; setEmailFailedOnly(v); loadEmailLog(v); }}
              style={{ padding: '6px 12px', borderRadius: 8, border: '1px solid #d1d5db', background: emailFailedOnly ? '#fee2e2' : '#fff', color: emailFailedOnly ? '#991b1b' : '#374151', fontWeight: 700, cursor: 'pointer', fontSize: 13 }}>
              {emailFailedOnly ? '⚠ Showing failures only' : 'Show failures only'}
            </button>
            <button onClick={() => loadEmailLog()} style={{ padding: '6px 12px', borderRadius: 8, border: '1px solid #d1d5db', background: '#fff', color: '#374151', fontWeight: 700, cursor: 'pointer', fontSize: 13 }}>↻ Refresh</button>
            {emailFails > 0 && <span style={{ color: '#991b1b', fontWeight: 700, fontSize: 13 }}>{emailFails} failed in the last 7 days</span>}
          </div>
          {emailLoading ? (
            <div style={{ padding: 30, textAlign: 'center', color: '#888' }}>Loading…</div>
          ) : !emailRows || emailRows.length === 0 ? (
            <div style={{ padding: 30, textAlign: 'center', color: '#888' }}>No emails {emailFailedOnly ? 'failed' : 'logged'} yet.</div>
          ) : (
            <div style={s.tableWrap}>
              <table style={s.table}>
                <thead>
                  <tr style={{ textAlign: 'left', borderBottom: '2px solid #eee', color: '#666', fontSize: 13 }}>
                    <th style={{ padding: '8px 10px' }}>Status</th>
                    <th style={{ padding: '8px 10px' }}>To</th>
                    <th style={{ padding: '8px 10px' }}>Type</th>
                    <th style={{ padding: '8px 10px' }}>Subject</th>
                    <th style={{ padding: '8px 10px' }}>When</th>
                  </tr>
                </thead>
                <tbody>
                  {emailRows.map((e) => (
                    <tr key={e.id} style={{ borderBottom: '1px solid #f3f4f6', background: e.success ? '#fff' : '#fef2f2' }}>
                      <td style={{ padding: '8px 10px', fontWeight: 800, color: e.success ? '#059669' : '#dc2626', whiteSpace: 'nowrap' }}>
                        {e.success ? '✓ Sent' : '✗ Failed'}
                      </td>
                      <td style={{ padding: '8px 10px' }}>
                        <div style={{ fontWeight: 600, color: '#111827' }}>{e.recipient_name || '—'}</div>
                        <div style={{ fontSize: 12, color: '#6b7280' }}>{e.recipient}</div>
                        {!e.success && e.error && <div style={{ fontSize: 11, color: '#991b1b', marginTop: 2 }}>{e.error}</div>}
                      </td>
                      <td style={{ padding: '8px 10px', fontSize: 13, color: '#374151' }}>{({ recap: 'Recap', workout_notify: 'Workout', intake: 'Intake' }[e.kind]) || e.kind || 'other'}</td>
                      <td style={{ padding: '8px 10px', fontSize: 13, color: '#374151' }}>{e.subject}</td>
                      <td style={{ padding: '8px 10px', fontSize: 12, color: '#6b7280', whiteSpace: 'nowrap' }}>
                        {e.created_at ? new Date(e.created_at).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : ''}
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
  );
}
