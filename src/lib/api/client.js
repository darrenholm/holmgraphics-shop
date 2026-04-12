// src/lib/api/client.js
export const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:3000/api';

async function request(path, options = {}) {
  const token = localStorage.getItem('hg_token');
  const headers = {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...options.headers
  };
  const res = await fetch(`${API_BASE}${path}`, { ...options, headers });
  if (res.status === 401) {
    localStorage.removeItem('hg_token');
    localStorage.removeItem('hg_user');
    window.location.href = '/login';
    return;
  }
  const data = await res.json();
  if (!res.ok) throw new Error(data.message || `API error ${res.status}`);
  return data;
}

export const api = {
  // Auth
  login: (email, password) =>
    request('/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) }),

  // Projects (Jobs)
  getProjects: (params = {}) => {
    const qs = new URLSearchParams(params).toString();
    return request(`/projects${qs ? '?' + qs : ''}`);
  },
  getProject: (id) => request(`/projects/${id}`),
  createProject: (data) =>
    request('/projects', { method: 'POST', body: JSON.stringify(data) }),
  updateProject: (id, data) =>
    request(`/projects/${id}`, { method: 'PUT', body: JSON.stringify(data) }),

  // Clients
  getClients: (search = '') =>
    request(`/clients${search ? '?search=' + encodeURIComponent(search) : ''}`),
  getClient: (id) => request(`/clients/${id}`),
  createClient: (data) =>
    request('/clients', { method: 'POST', body: JSON.stringify(data) }),

  // Status
  getStatuses: () => request('/statuses'),
  updateStatus: (projectId, statusId, note) =>
    request(`/projects/${projectId}/status`, {
      method: 'POST',
      body: JSON.stringify({ statusId, note })
    }),

  // Notes
  getNotes: (projectId) => request(`/projects/${projectId}/notes`),
  addNote: (projectId, text) =>
    request(`/projects/${projectId}/notes`, {
      method: 'POST',
      body: JSON.stringify({ text })
    }),

  // Items
  getItems: (projectId) => request(`/projects/${projectId}/items`),
  addItem: (projectId, item) =>
    request(`/projects/${projectId}/items`, {
      method: 'POST',
      body: JSON.stringify({
        description: item.description,
        qty:         item.qty,
        price:       item.price,
        total:       item.total
      })
    }),

  // Measurements
  addMeasurement: (projectId, m) =>
    request(`/projects/${projectId}/measurements`, {
      method: 'POST',
      body: JSON.stringify(m)
    }),

  // Photos
  getPhotos: (projectId) => request(`/projects/${projectId}/photos`),
  uploadPhotos: async (projectId, files) => {
    const token = localStorage.getItem('hg_token');
    const formData = new FormData();
    for (const file of files) formData.append('photos', file);
    const res = await fetch(`${API_BASE}/projects/${projectId}/photos`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: formData
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.message);
    return data;
  },
  deletePhoto: (projectId, filename) =>
    request(`/projects/${projectId}/photos/${filename}`, { method: 'DELETE' }),

  // Folder path
  updateFolderPath: (projectId, folder_path) =>
    request(`/projects/${projectId}/folder`, {
      method: 'PUT',
      body: JSON.stringify({ folder_path })
    }),
  // Auth — change password
changePassword: (current_password, new_password) =>
  request('/auth/change-password', {
    method: 'POST',
    body: JSON.stringify({ current_password, new_password })
  }),
  // Employees
  getEmployees: () => request('/employees'),

  // Project Types
  getProjectTypes: () => request('/project-types')
};