import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import axios from 'axios'
import { closeSocket } from '../utils/socket'
import auth from '../utils/auth'

function parseJwtPayload(token: string | null) {
  if (!token) return null
  try {
    const parts = token.split('.')
    if (parts.length < 2) return null
    const payload = JSON.parse(atob(parts[1].replace(/-/g, '+').replace(/_/g, '/')))
    return payload
  } catch {
    return null
  }
}

interface HeaderProps {
  isConnected: boolean
}

function Header({ isConnected }: HeaderProps) {
  const navigate = useNavigate()
  const token = auth.getToken()
  const [pressed, setPressed] = useState<Record<string, boolean>>({})
  const [unread, setUnread] = useState<number>(0)
  const payload = parseJwtPayload(token)
  const explicitRole = localStorage.getItem('aa_user_role') || null
  const detectedRole = auth.getRole()
  const isAdmin =
    (explicitRole || detectedRole || payload?.role) &&
    String(explicitRole || detectedRole || payload?.role).toLowerCase() === 'admin'
  const userName = (localStorage.getItem('aa_user_name') || payload?.name) ?? null
  const userRole = explicitRole || detectedRole || payload?.role || null

  useEffect(() => {
    let cancelled = false
    async function load() {
      try {
        if (!auth.getToken()) {
          setUnread(0)
          return
        }
        const r = await axios.get('/api/notifications/unread-count')
        if (!cancelled) setUnread(Number(r.data?.data?.unreadCount ?? 0))
      } catch {
        // ignore
      }
    }
    load()
    const onAuth = () => load()
    window.addEventListener('aa-auth-changed', onAuth as EventListener)
    return () => {
      cancelled = true
      window.removeEventListener('aa-auth-changed', onAuth as EventListener)
    }
  }, [])

  return (
    <header className="bg-white shadow-sm border-b">
      <div className="container mx-auto px-4 py-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-4">
            <h1 className="text-2xl font-bold text-primary-900">AutoAssist+</h1>
            <span className="text-sm text-gray-500">Service and insurance platform</span>
          </div>

          <div className="flex items-center space-x-4">
            <div className="flex items-center space-x-2">
              <div className={`w-2 h-2 rounded-full ${isConnected ? 'bg-green-400' : 'bg-red-400'}`} />
              <span className="text-sm text-gray-600">{isConnected ? 'Connected' : 'Disconnected'}</span>
            </div>

            <nav className="flex space-x-4 items-center">
              <Link to="/orders/new" className="text-primary-600 hover:text-primary-700 font-medium">
                New order
              </Link>
              <Link to="/orders" className="text-gray-600 hover:text-primary-700 font-medium">
                Orders
              </Link>
              <Link to="/receipts" className="text-gray-600 hover:text-primary-700 font-medium">
                Receipts
              </Link>
              <Link to="/profile" className="text-gray-600 hover:text-primary-700 font-medium">
                Profile
              </Link>
              <Link to="/notifications" className="relative text-gray-600 hover:text-primary-700 font-medium">
                Notifications
                {unread > 0 && (
                  <span className="absolute -top-2 -right-3 bg-red-600 text-white text-[10px] px-1.5 py-0.5 rounded-full">
                    {unread}
                  </span>
                )}
              </Link>
              <Link to="/demo" className="text-gray-600 hover:text-primary-700 font-medium">
                Web3
              </Link>
              {isAdmin && (
                <div className="relative group">
                  <Link to="/admin" className="text-gray-600 hover:text-primary-700 font-medium">
                    Admin
                  </Link>
                  <div className="absolute hidden group-hover:block bg-white border rounded shadow p-2 mt-1 whitespace-nowrap">
                    <div className="flex flex-col text-sm">
                      <Link className="hover:text-primary-700" to="/admin/board">
                        Orders board
                      </Link>
                      <Link className="hover:text-primary-700" to="/admin/calc-profiles">
                        Calc profiles
                      </Link>
                      <Link className="hover:text-primary-700" to="/admin/service-centers">
                        Service centers
                      </Link>
                      <Link className="hover:text-primary-700" to="/admin/broadcast">
                        Broadcast
                      </Link>
                    </div>
                  </div>
                </div>
              )}
              {!token ? (
                <>
                  <Link
                    to="/login"
                    onClick={() => {
                      setPressed((p) => ({ ...p, login: true }))
                      setTimeout(() => setPressed((p) => ({ ...p, login: false })), 180)
                    }}
                    className={`text-sm text-primary-600 border px-2 py-1 rounded transition transform ${
                      pressed.login ? 'bg-primary-100 scale-95 opacity-80' : 'hover:bg-primary-50'
                    }`}
                  >
                    Sign in
                  </Link>
                  <Link
                    to="/register"
                    onClick={() => {
                      setPressed((p) => ({ ...p, register: true }))
                      setTimeout(() => setPressed((p) => ({ ...p, register: false })), 180)
                    }}
                    className={`text-sm text-gray-600 border px-2 py-1 rounded transition transform ${
                      pressed.register ? 'bg-gray-100 scale-95 opacity-80' : 'hover:bg-gray-50'
                    }`}
                  >
                    Register
                  </Link>
                </>
              ) : (
                <>
                  <div className="text-sm text-gray-700">
                    <div>{userName ?? `User ${payload?.sub ?? ''}`}</div>
                    <div className="text-xs text-gray-500">{userRole}</div>
                  </div>
                  <button
                    onClick={() => {
                      try {
                        auth.logout()
                      } catch {}
                      try {
                        auth.saveUserInfo(null, null)
                      } catch {}
                      try {
                        closeSocket()
                      } catch {}
                      navigate('/entry')
                    }}
                    className="text-sm text-red-600"
                  >
                    Sign out
                  </button>
                </>
              )}
            </nav>
          </div>
        </div>
      </div>
    </header>
  )
}

export default Header
