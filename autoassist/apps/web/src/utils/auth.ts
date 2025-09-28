export function getToken() {
  try { return localStorage.getItem('aa_token') || sessionStorage.getItem('aa_token') || null } catch { return null }
}

export function setToken(token: string | null, persist = true) {
  try {
    if (!token) {
      localStorage.removeItem('aa_token'); sessionStorage.removeItem('aa_token')
    } else {
      if (persist) localStorage.setItem('aa_token', token); else sessionStorage.setItem('aa_token', token)
    }
  } catch {}
  // notify listeners
  try { window.dispatchEvent(new CustomEvent('aa-auth-changed')) } catch {}
}

export function saveUserInfo(name: string | null, role: string | null) {
  try {
    if (name) localStorage.setItem('aa_user_name', name); else localStorage.removeItem('aa_user_name')
    if (role) localStorage.setItem('aa_user_role', role); else localStorage.removeItem('aa_user_role')
  } catch {}
  try { window.dispatchEvent(new CustomEvent('aa-auth-changed')) } catch {}
}

export function getUserInfo() {
  try { return { name: localStorage.getItem('aa_user_name') || null, role: localStorage.getItem('aa_user_role') || null } } catch { return { name: null, role: null } }
}

export function logout() {
  setToken(null)
  saveUserInfo(null, null)
}

export function isAuthenticated() {
  return !!getToken()
}

export default { getToken, setToken, saveUserInfo, getUserInfo, logout, isAuthenticated }
