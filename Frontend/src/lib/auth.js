// Simple auth helpers — stored in localStorage

export function getStoredAuth() {
  return {
    apiKey:   localStorage.getItem('ping_api_key') || '',
    userName: localStorage.getItem('ping_user_name') || '',
    userEmail:localStorage.getItem('ping_user_email') || '',
  }
}

export function setStoredAuth({ apiKey, name, email }) {
  localStorage.setItem('ping_api_key', apiKey)
  if (name)  localStorage.setItem('ping_user_name', name)
  if (email) localStorage.setItem('ping_user_email', email)
}

export function clearStoredAuth() {
  localStorage.removeItem('ping_api_key')
  localStorage.removeItem('ping_user_name')
  localStorage.removeItem('ping_user_email')
}

export function isAuthenticated() {
  return !!localStorage.getItem('ping_api_key')
}
