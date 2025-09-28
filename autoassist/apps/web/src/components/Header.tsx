// No direct React import required (new JSX transform)
import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { closeSocket } from '../utils/socket'
import auth from '../utils/auth'

function parseJwtPayload(token: string | null) {
  if (!token) return null
  try {
    const parts = token.split('.')
    if (parts.length < 2) return null
    const payload = JSON.parse(atob(parts[1].replace(/-/g, '+').replace(/_/g, '/')))
    return payload
  } catch (e) { return null }
}

interface HeaderProps {
  isConnected: boolean
}

function Header({ isConnected }: HeaderProps) {
  const navigate = useNavigate()
  const token = auth.getToken()
  const [pressed, setPressed] = useState<Record<string, boolean>>({})
  const payload = parseJwtPayload(token)
  const explicitRole = localStorage.getItem('aa_user_role') || null
  const detectedRole = auth.getRole()
  const isAdmin = (explicitRole || detectedRole || payload?.role) && String(explicitRole || detectedRole || payload?.role).toLowerCase() === 'admin'
  const userName = (localStorage.getItem('aa_user_name') || payload?.name) ?? null
  const userRole = explicitRole || detectedRole || payload?.role || null
  return (
    <header className="bg-white shadow-sm border-b">
      <div className="container mx-auto px-4 py-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-4">
            <h1 className="text-2xl font-bold text-primary-900">
              AutoAssist+
            </h1>
            <span className="text-sm text-gray-500">
              Сервісно-страхова платформа
            </span>
          </div>
          
          <div className="flex items-center space-x-4">
            <div className="flex items-center space-x-2">
              <div 
                className={`w-2 h-2 rounded-full ${
                  isConnected ? 'bg-green-400' : 'bg-red-400'
                }`}
              />
              <span className="text-sm text-gray-600">
                {isConnected ? 'Підключено' : 'Відключено'}
              </span>
            </div>
            
            <nav className="flex space-x-4 items-center">
              <Link to="/" className="text-primary-600 hover:text-primary-700 font-medium">Нова заявка</Link>
              <Link to="/orders" className="text-gray-600 hover:text-primary-700 font-medium">Заявки</Link>
              <Link to="/demo" className="text-gray-600 hover:text-primary-700 font-medium">Web3</Link>
              {isAdmin && <Link to="/admin" className="text-gray-600 hover:text-primary-700 font-medium">Admin</Link>}
              {/* simple auth controls */}
              {!token ? (
                <>
                  <Link to="/login"
                    onClick={() => {
                      setPressed(p => ({ ...p, login: true }));
                      setTimeout(() => setPressed(p => ({ ...p, login: false })), 180);
                    }}
                    className={`text-sm text-primary-600 border px-2 py-1 rounded transition transform ${pressed.login ? 'bg-primary-100 scale-95 opacity-80' : 'hover:bg-primary-50'}`}>
                    Увійти
                  </Link>
                  <Link to="/register"
                    onClick={() => {
                      setPressed(p => ({ ...p, register: true }));
                      setTimeout(() => setPressed(p => ({ ...p, register: false })), 180);
                    }}
                    className={`text-sm text-gray-600 border px-2 py-1 rounded transition transform ${pressed.register ? 'bg-gray-100 scale-95 opacity-80' : 'hover:bg-gray-50'}`}>
                    Реєстрація
                  </Link>
                </>
              ) : (
                <>
                  <div className="text-sm text-gray-700">
                    <div>{userName ?? `User ${payload?.sub ?? ''}`}</div>
                    <div className="text-xs text-gray-500">{userRole}</div>
                  </div>
                  <button onClick={() => {
                    try { auth.logout() } catch {}
                    try { auth.saveUserInfo(null, null) } catch {}
                    try { closeSocket() } catch {}
                    navigate('/entry')
                  }} className="text-sm text-red-600">Вихід</button>
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