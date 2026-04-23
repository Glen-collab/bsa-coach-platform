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
  getBrand: () => request('/coaches/brand'),
  setBrand: (body) => request('/coaches/brand', { method: 'POST', body: JSON.stringify(body) }),

  // Template library
  listTemplates: () => request('/workout/templates.php'),
  cloneTemplate: (body) => request('/workout/clone-template.php', { method: 'POST', body: JSON.stringify(body) }),
  adminToggleTemplate: (body) => request('/workout/admin/toggle-template.php', { method: 'POST', body: JSON.stringify(body) }),
  myPrograms: (email) => request('/workout/list-programs.php', { method: 'POST', body: JSON.stringify({ email }) }),

  // Coach broadcast
  broadcastAudience: () => request('/social/broadcast/audience'),
  broadcastSend: (body) => request('/social/broadcast', { method: 'POST', body: JSON.stringify({ body }) }),

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
  proposeExercise: (body) => request('/media/custom-exercises', { method: 'POST', body: JSON.stringify(body) }),
  approvedCustomExercises: () => request('/media/custom-exercises/approved'),
  myExerciseProposals: () => request('/media/custom-exercises/mine'),
  adminCustomExercises: (status) => request(`/media/admin/custom-exercises${status ? '?status=' + encodeURIComponent(status) : ''}`),
  decideCustomExercise: (id, status, adminNotes) =>
    request('/media/admin/custom-exercises/decide', { method: 'POST', body: JSON.stringify({ id, status, admin_notes: adminNotes || null }) }),
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

  // Kiosk (Gym TV)
  kioskMyPrograms: () => request('/kiosk/my-programs'),
  kioskToggle: (programId, show) => request('/kiosk/toggle-kiosk', { method: 'POST', body: JSON.stringify({ program_id: programId, show_on_kiosk: show }) }),
  kioskSetActive: (programId) => request('/kiosk/set-active', { method: 'POST', body: JSON.stringify({ program_id: programId }) }),
  kioskTvConfig: (pi, device) => request(`/kiosk/tv-config?pi=${encodeURIComponent(pi)}${device ? '&device=' + encodeURIComponent(device) : ''}`),

  // Per-device kiosk control
  kioskMyDevices: () => request('/kiosk/my-devices'),
  kioskRenameDevice: (deviceId, displayName) => request('/kiosk/device/rename', { method: 'POST', body: JSON.stringify({ device_id: deviceId, display_name: displayName }) }),
  kioskDeviceSetActive: (deviceId, programId) => request('/kiosk/device/set-active', { method: 'POST', body: JSON.stringify({ device_id: deviceId, program_id: programId }) }),
  kioskDeleteDevice: (deviceId) => request('/kiosk/device/delete', { method: 'POST', body: JSON.stringify({ device_id: deviceId }) }),
  kioskDeviceSetLayout: (deviceId, layout) => request('/kiosk/device/set-layout', { method: 'POST', body: JSON.stringify({ device_id: deviceId, layout }) }),

  // Remote power — queue a command for the Pi to pick up on next poll.
  kioskShutdown: () => request('/kiosk/shutdown', { method: 'POST' }),
  kioskPiReboot: () => request('/kiosk/pi-reboot', { method: 'POST' }),

  // Health
  health: () => request('/health'),
};
