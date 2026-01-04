import React, { useEffect, useState } from 'react'
import { Routes, Route, Navigate, useNavigate, useLocation } from 'react-router-dom'
import axios from 'axios'
import { ensureSocket } from './utils/socket'
import auth from './utils/auth'
import Header from './components/Header'
import OrderForm from './components/OrderForm'
import OrderList from './components/OrderList'
import OrderDetails from './pages/OrderDetails'
import PaymentPage from './pages/Payments'
import ReceiptsPage from './pages/Receipts'
import ProofViewer from './pages/Proof'
import DashboardPage from './pages/Dashboard'
import ConnectWallet from './components/ConnectWallet'
import AdminPage from './pages/Admin'
import ProfilePage from './pages/Profile'
import OrdersBoard from './pages/admin/OrdersBoard'
import CalcProfilesAdmin from './pages/admin/CalcProfiles'
import ServiceCentersAdmin from './pages/admin/ServiceCenters'
import BroadcastAdmin from './pages/admin/Broadcast'
import MapPage from './pages/Map'
import NotificationsPage from './pages/Notifications'
import ToastCenter from './shared/ToastCenter'

function ProtectedRoute({ children }: { children: JSX.Element }) {
  const [ok, setOk] = React.useState<boolean>(() =>
    typeof window !== 'undefined' ? !!auth.getToken() : false,
  )
  React.useEffect(() => {
    const on = () => setOk(!!auth.getToken())
    window.addEventListener('aa-auth-changed', on as EventListener)
    return () => window.removeEventListener('aa-auth-changed', on as EventListener)
  }, [])
  if (!ok) return <Navigate to="/entry" replace />
  return children
}

function AuthEntry({ initialMode }: { initialMode?: 'login' | 'register' }) {
  const navigate = useNavigate()
  const location = useLocation()
  const [mode, setMode] = React.useState<'login' | 'register'>(() =>
    initialMode ?? (location.pathname.includes('/register') ? 'register' : 'login'),
  )
  const [email, setEmail] = React.useState('')
  const [password, setPassword] = React.useState('')
  const [errors, setErrors] = React.useState<Record<string, string>>({})
  const [formError, setFormError] = React.useState<string | null>(null)
  const [submitting, setSubmitting] = React.useState(false)
  const [walletLoading, setWalletLoading] = React.useState(false)

  function normalizeAuthError(raw: string) {
    if (/not[_ ]?found/i.test(raw)) return 'Auth endpoint not available. Check API.'
    return raw
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setErrors({})
    setFormError(null)
    setSubmitting(true)
    try {
      const url = mode === 'login' ? '/api/auth/login' : '/api/auth/register'
      const r = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      })
      const text = await r.text()
      let j: any = null
      try {
        j = JSON.parse(text)
      } catch {
        j = null
      }

      if (r.ok) {
        const t = (j && (j.access || j.accessToken || j.token)) || null
        if (t) {
          try {
            auth.setToken(t, true)
          } catch {}
          try {
            const parts = t.split('.')
            if (parts.length >= 2) {
              const payload = JSON.parse(
                atob(parts[1].replace(/-/g, '+').replace(/_/g, '/')),
              )
              auth.saveUserInfo(payload.name ?? null, payload.role ?? null)
            }
          } catch {}
          try {
            const sock = await import('./utils/socket')
            sock.ensureSocket()
          } catch {}
          navigate('/')
          return
        }
        navigate('/')
        return
      }

      const serverMsg = normalizeAuthError(
        j?.error?.message || j?.message || text || r.statusText,
      )
      if (j?.details && Array.isArray(j.details)) {
        const byField: Record<string, string> = {}
        for (const d of j.details) if (d?.field) byField[d.field] = d.message
        setErrors(byField)
      }
      setFormError(serverMsg)
    } catch (err: any) {
      setFormError(err?.message || String(err))
    } finally {
      setSubmitting(false)
    }
  }

  function getEthereum(): any {
    const eth = (window as any).ethereum
    if (!eth) return null
    if (Array.isArray(eth.providers)) {
      return eth.providers.find((p: any) => p.isMetaMask) || eth.providers[0] || eth
    }
    return eth
  }

  async function walletLogin() {
    setWalletLoading(true)
    setFormError(null)
    try {
      const eth = getEthereum()
      if (!eth) throw new Error('Wallet not detected. Install and enable the extension.')
      const provider = new (await import('ethers')).BrowserProvider(eth as any)
      await eth.request({ method: 'eth_requestAccounts' })
      const signer = await provider.getSigner()
      const address = await signer.getAddress()
      const nonceRes = await fetch(`/api/wallet/nonce?address=${encodeURIComponent(address)}`)
      if (!nonceRes.ok) throw new Error('Failed to fetch nonce')
      const nonceJson = await nonceRes.json()
      const nonce = nonceJson.nonce ?? nonceJson.data?.nonce
      if (!nonce) throw new Error('Nonce missing in response')
      const msg = `AutoAssist Wallet auth nonce: ${nonce}`
      const sig = await signer.signMessage(msg)
      const verifyRes = await fetch('/api/wallet/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ address, signature: sig }),
      })
      if (!verifyRes.ok) {
        const t = await verifyRes.text().catch(() => null)
        throw new Error(t || 'Wallet login failed')
      }
      const j = await verifyRes.json()
      const token =
        (j.token && (j.token.access || j.token)) ||
        j.access ||
        j.accessToken
      if (!token) throw new Error('Token missing from response')
      try {
        auth.setToken(token, true)
      } catch {}
      try {
        const parts = token.split('.')
        if (parts.length >= 2) {
          const payload = JSON.parse(atob(parts[1].replace(/-/g, '+').replace(/_/g, '/')))
          auth.saveUserInfo(payload.name ?? null, payload.role ?? null)
        }
      } catch {}
      try {
        const sock = await import('./utils/socket')
        sock.ensureSocket()
      } catch {}
      navigate('/')
    } catch (e: any) {
      setFormError(e?.message || String(e))
    } finally {
      setWalletLoading(false)
    }
  }

  useEffect(() => {
    if (initialMode !== undefined) {
      setMode(initialMode)
      return
    }
    setMode(location.pathname.includes('/register') ? 'register' : 'login')
  }, [initialMode, location.pathname])

  return (
    <div style={{ maxWidth: 520, margin: '60px auto', padding: 24 }}>
      <h1 className="text-2xl font-bold mb-4">
        {mode === 'login' ? 'Sign in' : 'Register'}
      </h1>
      {initialMode === undefined && (
        <div className="mb-4">
          <button className="mr-2" onClick={() => setMode('login')}>
            Sign in
          </button>
          <button onClick={() => setMode('register')}>Register</button>
        </div>
      )}
      <form onSubmit={submit} className="space-y-3">
        <div>
          <input
            name="email"
            className={`w-full border px-2 py-1 ${errors.email ? 'border-red-500' : ''}`}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="Email"
          />
          {errors.email && <div className="text-red-500 text-sm mt-1">{errors.email}</div>}
        </div>
        <div>
          <input
            name="password"
            type="password"
            className={`w-full border px-2 py-1 ${errors.password ? 'border-red-500' : ''}`}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Password"
          />
          {errors.password && (
            <div className="text-red-500 text-sm mt-1">{errors.password}</div>
          )}
        </div>
        <div>
          <button className="border px-3 py-1" disabled={submitting}>
            {mode === 'login' ? 'Sign in' : 'Register'}
          </button>
        </div>
        <div>
          <button
            type="button"
            className="border px-3 py-1"
            onClick={walletLogin}
            disabled={walletLoading}
          >
            {walletLoading ? 'Connecting wallet...' : 'Sign in with wallet'}
          </button>
        </div>
        {formError && <div className="mt-2 text-sm text-red-600">{formError}</div>}
      </form>
    </div>
  )
}

function App() {
  const [isConnected, setIsConnected] = useState(false)

  useEffect(() => {
    const reqInterceptor = axios.interceptors.request.use((cfg) => {
      const t = auth.getToken()
      if (t) (cfg.headers as any) = { ...(cfg.headers || {}), Authorization: `Bearer ${t}` }
      return cfg
    })

    let socket: any = null
    let mounted = true
    const attachSocket = (s: any) => {
      if (!s) return
      s.off?.('connect')
      s.off?.('disconnect')
      s.off?.('connect_error')
      s.off?.('order:new')

      setIsConnected(!!s.connected)
      s.on('connect', () => {
        setIsConnected(true)
        s.emit && s.emit('join', 'managers')
      })
      s.on('connect_error', (err: any) => {
        console.warn('WebSocket connect_error', err?.message ?? err)
        setIsConnected(false)
      })
      s.on('disconnect', () => {
        setIsConnected(false)
      })
      s.on('order:new', (data: any) => {
        console.log('New order received:', data)
      })
    }

    const initSocket = async () => {
      try {
        socket = await ensureSocket()
        if (!mounted || !socket) return
        attachSocket(socket)
      } catch (e) {
        console.warn('WebSocket init failed, skipping socket connection')
      }
    }

    initSocket()
    const onAuth = () => {
      setIsConnected(false)
      void initSocket()
    }
    window.addEventListener('aa-auth-changed', onAuth as EventListener)

    return () => {
      mounted = false
      try {
        if (socket) socket.close && socket.close()
      } catch {}
      axios.interceptors.request.eject(reqInterceptor)
      window.removeEventListener('aa-auth-changed', onAuth as EventListener)
    }
  }, [])

  return (
    <div className="min-h-screen bg-gray-50">
      <Header isConnected={isConnected} />
      <ToastCenter />

      <main className="container mx-auto px-4 py-8">
        <Routes>
          <Route path="/entry" element={<Navigate to="/login" replace />} />
          <Route path="/login" element={<AuthEntry initialMode="login" />} />
          <Route path="/register" element={<AuthEntry initialMode="register" />} />
          <Route
            path="/demo"
            element={
              <div style={{ maxWidth: 720, margin: '40px auto', display: 'grid', gap: 24 }}>
                <h1>Web3 Demo</h1>
                <section>
                  <h2>Wallet</h2>
                  <ConnectWallet />
                </section>
              </div>
            }
          />

          <Route path="/" element={<ProtectedRoute><DashboardPage /></ProtectedRoute>} />
          <Route path="/orders/new" element={<ProtectedRoute><OrderForm /></ProtectedRoute>} />
          <Route path="/orders" element={<ProtectedRoute><OrderList /></ProtectedRoute>} />
          <Route path="/orders/:id" element={<ProtectedRoute><OrderDetails /></ProtectedRoute>} />
          <Route path="/orders/:id/proof" element={<ProtectedRoute><ProofViewer /></ProtectedRoute>} />
          <Route path="/payments/:orderId" element={<ProtectedRoute><PaymentPage /></ProtectedRoute>} />
          <Route path="/receipts" element={<ProtectedRoute><ReceiptsPage /></ProtectedRoute>} />
          <Route path="/notifications" element={<ProtectedRoute><NotificationsPage /></ProtectedRoute>} />
          <Route path="/profile" element={<ProtectedRoute><ProfilePage /></ProtectedRoute>} />
          <Route path="/admin" element={<ProtectedRoute><AdminPage /></ProtectedRoute>} />
          <Route path="/admin/board" element={<ProtectedRoute><OrdersBoard /></ProtectedRoute>} />
          <Route path="/admin/calc-profiles" element={<ProtectedRoute><CalcProfilesAdmin /></ProtectedRoute>} />
          <Route path="/admin/service-centers" element={<ProtectedRoute><ServiceCentersAdmin /></ProtectedRoute>} />
          <Route path="/admin/broadcast" element={<ProtectedRoute><BroadcastAdmin /></ProtectedRoute>} />
          <Route path="/map" element={<ProtectedRoute><MapPage /></ProtectedRoute>} />
        </Routes>
      </main>
    </div>
  )
}

export default App
