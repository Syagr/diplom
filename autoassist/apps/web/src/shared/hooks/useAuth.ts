import { useEffect, useState } from 'react'
import auth from '../../utils/auth'

export function useAuth() {
  const [token, setToken] = useState<string | null>(() => auth.getToken())
  const [role, setRole] = useState<string | null>(() => auth.getRole())
  const [name, setName] = useState<string | null>(() => {
    try { return auth.getUserInfo()?.name ?? null } catch { return null }
  })

  useEffect(() => {
    const on = () => {
      setToken(auth.getToken())
      setRole(auth.getRole())
      try { setName(auth.getUserInfo()?.name ?? null) } catch { setName(null) }
    }
    window.addEventListener('aa-auth-changed', on as EventListener)
    return () => window.removeEventListener('aa-auth-changed', on as EventListener)
  }, [])

  return {
    token,
    role,
    name,
    isAuthenticated: !!token,
    logout: () => auth.logout(),
  }
}

export default useAuth
