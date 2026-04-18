const API_BASE = import.meta.env.VITE_API_URL || 'https://app.bestrongagain.com/api';

async function request(endpoint, options = {}) {
  const token = localStorage.getItem('bsa_token');
  const headers = { 'Content-Type': 'application/json', ...options.headers };
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const res = await fetch(`${API_BASE}${endpoint}`, { ...options, headers });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || data.message || 'Request failed');
  return data;
}

export const api = {
  // Auth
  register: (body) => request('/auth/register', { method: 'POST', body: JSON.stringify(body) }),
  login: (body) => request('/auth/login', { method: 'POST', body: JSON.stringify(body) }),

  // Stripe
  checkout: (tier) => request('/stripe/checkout', { method: 'POST', body: JSON.stringify({ tier }) }),
  connectOnboard: () => request('/stripe/connect/onboard', { method: 'POST' }),

  // Coach
  dashboard: (id) => request(`/coaches/dashboard/${id}`),
  tree: (id) => request(`/coaches/tree/${id}`),
  earnings: (id) => request(`/coaches/earnings/history/${id}`),

  // Admin
  overview: () => request('/admin/overview'),
  membersList: () => request('/admin/members/list'),
  coachesList: () => request('/admin/coaches/list'),
  coachApplications: () => request('/admin/coach-applications'),
  approveCoach: (id, notes) => request(`/admin/coach-applications/${id}/approve`, { method: 'POST', body: JSON.stringify({ notes }) }),
  denyCoach: (id, notes) => request(`/admin/coach-applications/${id}/deny`, { method: 'POST', body: JSON.stringify({ notes }) }),
  assignMember: (memberId, coachId) => request('/admin/members/assign', { method: 'POST', body: JSON.stringify({ member_id: memberId, coach_id: coachId }) }),
  deactivateMember: (memberId) => request('/admin/members/deactivate', { method: 'POST', body: JSON.stringify({ member_id: memberId }) }),
  deleteMember: (memberId) => request('/admin/members/delete', { method: 'POST', body: JSON.stringify({ member_id: memberId }) }),
  pendingVideos: () => request('/admin/videos/pending'),
  approveVideo: (id) => request(`/admin/videos/${id}/approve`, { method: 'POST' }),
  rejectVideo: (id) => request(`/admin/videos/${id}/reject`, { method: 'POST' }),

  // Media (per-coach video/audio uploads)
  waiverStatus: () => request('/media/waiver/status'),
  waiverAccept: () => request('/media/waiver/accept', { method: 'POST' }),
  mediaUploadUrl: (opts = {}) => {
    const body = {
      media_type: opts.mediaType || 'video',
      max_duration_seconds: opts.maxDurationSeconds || 600,
    };
    if (opts.exerciseName) body.exercise_name = opts.exerciseName;
    if (opts.coachName) body.coach_name = opts.coachName;
    return request('/media/upload-url', { method: 'POST', body: JSON.stringify(body) });
  },
  mediaRegister: (body) => request('/media/register', { method: 'POST', body: JSON.stringify(body) }),
  myMedia: () => request('/media/my-uploads'),
  deleteMedia: (exerciseName, mediaType) =>
    request('/media/delete', { method: 'POST', body: JSON.stringify({ exercise_name: exerciseName, media_type: mediaType }) }),
  adminAllMedia: (params = {}) => {
    const qs = new URLSearchParams(params).toString();
    return request(`/media/admin/all${qs ? '?' + qs : ''}`);
  },
  featureMedia: (id, featuredGlobal) =>
    request('/media/admin/feature', { method: 'POST', body: JSON.stringify({ id, featured_global: featuredGlobal }) }),
  flagMedia: (id, status) =>
    request('/media/admin/flag', { method: 'POST', body: JSON.stringify({ id, status }) }),
  cloudflareList: (search = '', limit = 200) => {
    const qs = new URLSearchParams({ search, limit }).toString();
    return request(`/media/admin/cloudflare-list?${qs}`);
  },

  // Health
  health: () => request('/health'),
};
