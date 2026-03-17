// Central API client — all calls go through here

const BASE = import.meta.env.VITE_API_URL || ''

function getApiKey() {
  return localStorage.getItem('ping_api_key') || ''
}

async function request(path, options = {}) {
  const res = await fetch(`${BASE}${path}`, {
    headers: { 'Content-Type': 'application/json', ...options.headers },
    ...options,
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }))
    throw new Error(err.error || `HTTP ${res.status}`)
  }
  return res.json()
}

// ── Auth ────────────────────────────────────────────────
export async function login(apiKey, password) {
  return request('/crm/login', {
    method: 'POST',
    body: JSON.stringify({ api_key: apiKey, password }),
  })
}

// ── Pipeline ─────────────────────────────────────────────
export async function triggerAnalysis(payload) {
  return request('/trigger', {
    method: 'POST',
    body: JSON.stringify(payload),
  })
}

// ── Deals ────────────────────────────────────────────────
export async function fetchDeals() {
  return request(`/deals?api_key=${encodeURIComponent(getApiKey())}`)
}

export async function updateDealStage(searchId, stage) {
  return request(`/deals/${searchId}/stage`, {
    method: 'PATCH',
    body: JSON.stringify({ api_key: getApiKey(), stage }),
  })
}

export function dealDownloadUrl(searchId, fileType) {
  return `${BASE}/deals/${searchId}/download/${fileType}?api_key=${encodeURIComponent(getApiKey())}`
}

// ── Settings / Assumptions ───────────────────────────────
export async function fetchSettings() {
  return request(`/settings?api_key=${encodeURIComponent(getApiKey())}`)
}

export async function saveSettings(data) {
  return request('/settings', {
    method: 'PATCH',
    body: JSON.stringify({ api_key: getApiKey(), ...data }),
  })
}
