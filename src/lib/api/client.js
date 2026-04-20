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
      description:  item.description,
      qty:          item.qty,
      price:        item.price,
      total:        item.total,
      qb_item_name: item.qb_item_name || null
    })
  }),
  updateItem: (projectId, itemId, item) =>
  request(`/projects/${projectId}/items/${itemId}`, {
    method: 'PUT',
    body: JSON.stringify({
      description:  item.description,
      qty:          item.qty,
      price:        item.price,
      total:        item.total,
      qb_item_name: item.qb_item_name || null
    })
  }),

  deleteItem: (projectId, itemId) =>
    request(`/projects/${projectId}/items/${itemId}`, { method: 'DELETE' }),
  // Measurements
  addMeasurement: (projectId, m) =>
    request(`/projects/${projectId}/measurements`, {
      method: 'POST',
      body: JSON.stringify(m)
    }),

  // Photos
  //
  // Photo objects from the API look like:
  //   { id, filename, category, show_in_gallery, uploaded, uploaded_by, url }
  // where `category` is one of: signs_led | vehicle_wraps | apparel | printing | other
  //
  getPhotos: (projectId) => request(`/projects/${projectId}/photos`),
  uploadPhotos: async (projectId, files, category) => {
    const token = localStorage.getItem('hg_token');
    const formData = new FormData();
    for (const file of files) formData.append('photos', file);
    if (category) formData.append('category', category);
    const res = await fetch(`${API_BASE}/projects/${projectId}/photos`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: formData
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.message);
    return data;
  },
  // Accepts either a numeric photo id (preferred) or a legacy filename.
  deletePhoto: (projectId, idOrFilename) =>
    request(`/projects/${projectId}/photos/${encodeURIComponent(idOrFilename)}`, {
      method: 'DELETE'
    }),
  // Admin-only curation. Pass whichever fields you want to change.
  //   updatePhoto(42, 1234, { show_in_gallery: true, category: 'signs_led' })
  updatePhoto: (projectId, photoId, patch) =>
    request(`/projects/${projectId}/photos/${photoId}`, {
      method: 'PATCH',
      body: JSON.stringify(patch)
    }),
  // Public — no auth required.
  getGallery: (category) => {
    const qs = category ? `?category=${encodeURIComponent(category)}` : '';
    return request(`/projects/gallery${qs}`);
  },

  // Admin-only. Every photo in the system, with project description + client
  // name, for the bulk curation page. Pass { unpublished: true } to narrow to
  // photos not yet flagged show_in_gallery.
  getAllPhotos: ({ unpublished = false } = {}) => {
    const qs = unpublished ? '?unpublished=1' : '';
    return request(`/projects/photos/all${qs}`);
  },

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
