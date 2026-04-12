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
  coachesList: () => request('/admin/coaches/list'),
  pendingVideos: () => request('/admin/videos/pending'),
  approveVideo: (id) => request(`/admin/videos/${id}/approve`, { method: 'POST' }),
  rejectVideo: (id) => request(`/admin/videos/${id}/reject`, { method: 'POST' }),

  // Health
  health: () => request('/health'),
};
