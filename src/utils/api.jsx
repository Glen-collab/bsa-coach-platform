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

  // Health
  health: () => request('/health'),
};
