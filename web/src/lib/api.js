const BASE = import.meta.env.VITE_API_URL || '/api';

async function req(path, options = {}) {
  const res = await fetch(`${BASE}${path}`, {
    headers: options.body instanceof FormData ? {} : { 'Content-Type': 'application/json' },
    ...options,
  });
  if (res.status === 204) return null;

  let data = null;
  try {
    data = await res.json();
  } catch {
    /* empty body */
  }

  if (!res.ok) {
    const err = new Error(data?.error || `Request failed (${res.status}).`);
    err.status = res.status;
    err.payload = data;
    throw err;
  }
  return data;
}

export const api = {
  health: () => req('/health'),

  listProjects: () => req('/projects'),
  createProject: (body) => req('/projects', { method: 'POST', body: JSON.stringify(body) }),
  getProject: (id) => req(`/projects/${id}`),
  updateProject: (id, body) => req(`/projects/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
  deleteProject: (id) => req(`/projects/${id}`, { method: 'DELETE' }),

  replaceScope: (id, scopeText) =>
    req(`/projects/${id}/scope`, { method: 'PUT', body: JSON.stringify({ scopeText }) }),
  uploadScope: (id, file) => {
    const form = new FormData();
    form.append('file', file);
    return req(`/projects/${id}/scope/upload`, { method: 'POST', body: form });
  },

  logRequest: (projectId, text) =>
    req(`/projects/${projectId}/requests`, { method: 'POST', body: JSON.stringify({ text }) }),
  recheck: (id) => req(`/requests/${id}/recheck`, { method: 'POST' }),
  patchRequest: (id, body) => req(`/requests/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
  deleteRequest: (id) => req(`/requests/${id}`, { method: 'DELETE' }),

  summary: (id) => req(`/projects/${id}/summary`),
  recap: (id) => req(`/projects/${id}/recap`, { method: 'POST' }),
};

export const CURRENCIES = { USD: '$', EUR: '€', GBP: '£', INR: '₹', CAD: 'C$', AUD: 'A$' };

export function money(amount, currency) {
  const symbol = CURRENCIES[currency] || '$';
  return symbol + Math.round(Number(amount) || 0).toLocaleString();
}

export function hoursLabel(h) {
  const r = Math.round((Number(h) || 0) * 10) / 10;
  return `${r} ${r === 1 ? 'hr' : 'hrs'}`;
}

export const VERDICTS = {
  in_scope: { label: 'Agreed', cls: 'agreed' },
  gray: { label: 'Unclear', cls: 'unclear' },
  creep: { label: 'Outside scope', cls: 'outside' },
};
