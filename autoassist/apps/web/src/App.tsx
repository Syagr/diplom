import React, { useState, useEffect } from 'react'
import { Routes, Route, Navigate, useNavigate, useLocation } from 'react-router-dom'
import getSocket from './utils/socket'
import OrderForm from './components/OrderForm'
import OrderList from './components/OrderList'
import OrderDetails from './pages/OrderDetails'
import Header from './components/Header'
import UploadAttachment from './components/UploadAttachment'
import ConnectWallet from './components/ConnectWallet'
import AdminPage from './pages/Admin'
import auth from './utils/auth'
import axios from 'axios'

// Use Vite proxy by default (empty = same origin -> '/api' proxy)

// DemoRegister and DemoUploader placed above App to avoid HMR/hoisting runtime errors
function DemoRegister() {
  const [email, setEmail] = React.useState('test1@example.com')
  const [password, setPassword] = React.useState('secret123')
  const [msg, setMsg] = React.useState<string | null>(null)
  async function onRegister(e: React.FormEvent) {
    e.preventDefault(); setMsg(null)
    try {
      const r = await fetch('/api/auth/register', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password })
      })
      const text = await r.text()
      try {
        const j = JSON.parse(text)
        if (r.ok) {
          setMsg('✅ Зарегистрирован')
        } else {
          const msgText = j?.error?.message || j?.message || text
          setMsg('❌ ' + msgText)
        }
      } catch (err) {
        if (r.ok) setMsg('✅ Зарегистрирован')
        else setMsg('❌ ' + text)
      }
    } catch (err:any) { setMsg('❌ ' + (err?.message || String(err))) }
  }
  return (
    <form onSubmit={onRegister} className="space-y-2">
      <div className="flex gap-2">
        <input className="border px-2 py-1" value={email} onChange={e=>setEmail(e.target.value)} placeholder="email" />
        <input className="border px-2 py-1" value={password} onChange={e=>setPassword(e.target.value)} placeholder="password" type="password" />
        <button className="border px-3 py-1">Register</button>
      </div>
      {msg && <div>{msg}</div>}
    </form>
  )
}

function DemoUploader() {
  // Do not offer any demo-login here. UploadAttachment must be used only when
  // the user is properly authenticated via the entry/register flow.
  const token = auth.getToken()
  if (!token) {
    return <div>Будь ласка, увійдіть або зареєструйтесь, щоб завантажувати вкладення.</div>
  }
  return <UploadAttachment token={token} orderId={1} />
}

function ProtectedRoute({ children }: { children: JSX.Element }) {
  // simple token presence check — tokens are stored in localStorage by the auth flow
    const [ok, setOk] = React.useState<boolean>(() => typeof window !== 'undefined' ? !!auth.getToken() : false)
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
  const [mode, setMode] = React.useState<'login'|'register'>(() => initialMode ?? (location.pathname.includes('/register') ? 'register' : 'login'))
  const [email, setEmail] = React.useState('')
  const [password, setPassword] = React.useState('')
  const [errors, setErrors] = React.useState<Record<string,string>>({})
  const [formError, setFormError] = React.useState<string | null>(null)
  const [submitting, setSubmitting] = React.useState(false)

  async function submit(e: React.FormEvent) {
    e.preventDefault(); setErrors({}); setFormError(null); setSubmitting(true)
    try {
      const url = mode === 'login' ? '/api/auth/login' : '/api/auth/register'
        const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password }) })
        const text = await r.text()
        let j: any = null
        try { j = JSON.parse(text) } catch (e) { j = null }

        if (r.ok) {
          // success, accept tokens in several formats
          const t = (j && (j.access || j.accessToken || j.token)) || null
          if (t) {
            try { auth.setToken(t, true) } catch (e) {}
            try {
              const parts = t.split('.')
              if (parts.length >= 2) {
                const payload = JSON.parse(atob(parts[1].replace(/-/g,'+').replace(/_/g,'/')))
                auth.saveUserInfo(payload.name ?? null, payload.role ?? null)
              }
            } catch (e) { /* ignore */ }
            try { (await import('./utils/socket')).ensureSocket() } catch (e) { /* ignore */ }
            navigate('/')
            return
          }
          // if server returned non-token success payload, just navigate home
          navigate('/'); return
        }

        // Error path: prefer structured { error: { code, message } }
        const serverMsg = j?.error?.message || j?.message || text || r.statusText
        // If validation details present, map them
        if (j?.details && Array.isArray(j.details)) {
          const byField: Record<string,string> = {}
          for (const d of j.details) if (d?.field) byField[d.field] = d.message
          setErrors(byField)
        }
        setFormError(serverMsg)
  } catch (err:any) { setFormError(err?.message || String(err)) }
    finally { setSubmitting(false) }
  }

  // keep mode in sync with route when initialMode isn't explicitly provided
  useEffect(() => {
    if (initialMode !== undefined) {
      setMode(initialMode)
      return
    }
    setMode(location.pathname.includes('/register') ? 'register' : 'login')
  }, [initialMode, location.pathname])

  return (
    <div style={{ maxWidth: 520, margin: '60px auto', padding: 24 }}>
      <h1 className="text-2xl font-bold mb-4">{mode === 'login' ? 'Вхід' : 'Реєстрація'}</h1>
      {/* when used as dedicated page, don't show toggle buttons */}
      {initialMode === undefined && (
        <div className="mb-4">
          <button className="mr-2" onClick={()=>setMode('login')}>Увійти</button>
          <button onClick={()=>setMode('register')}>Зареєструватись</button>
        </div>
      )}
      <form onSubmit={submit} className="space-y-3">
        <div>
          <input name="email" className={`w-full border px-2 py-1 ${errors.email ? 'border-red-500' : ''}`} value={email} onChange={e=>setEmail(e.target.value)} placeholder="Електронна пошта" />
          {errors.email && <div className="text-red-500 text-sm mt-1">{errors.email}</div>}
        </div>
        <div>
          <input name="password" type="password" className={`w-full border px-2 py-1 ${errors.password ? 'border-red-500' : ''}`} value={password} onChange={e=>setPassword(e.target.value)} placeholder="Пароль" />
          {errors.password && <div className="text-red-500 text-sm mt-1">{errors.password}</div>}
        </div>
        <div>
          <button className="border px-3 py-1" disabled={submitting}>{mode === 'login' ? 'Увійти' : 'Зареєструватись'}</button>
        </div>
        {formError && <div className="mt-2 text-sm text-red-600">{formError}</div>}
      </form>
    </div>
  )
}

function App() {
  const [isConnected, setIsConnected] = useState(false)

  useEffect(() => {
    // Install axios interceptor that attaches latest token per-request
    const reqInterceptor = axios.interceptors.request.use((cfg) => {
      const t = auth.getToken()
      if (t) (cfg.headers as any) = { ...(cfg.headers || {}), Authorization: `Bearer ${t}` }
      return cfg
    })

    let socket: any = null
    let mounted = true
    ;(async () => {
      try {
        socket = await getSocket()
        if (!mounted || !socket) return

        socket.on('connect', () => {
          console.log('Connected to WebSocket')
          setIsConnected(true)
          socket.emit && socket.emit('join', 'managers')
        })

        socket.on('connect_error', (err: any) => {
          console.warn('WebSocket connect_error', err?.message ?? err)
        })

        socket.on('disconnect', () => {
          console.log('Disconnected from WebSocket')
          setIsConnected(false)
        })

        socket.on('order:new', (data: any) => {
          console.log('New order received:', data)
        })
      } catch (e) {
        console.warn('WebSocket init failed, skipping socket connection')
      }
    })()

    // cleanup on unmount
    return () => {
      mounted = false
      try { if (socket) socket.close && socket.close() } catch (e) {}
      axios.interceptors.request.eject(reqInterceptor)
      window.removeEventListener('aa-auth-changed', () => {})
    }
  }, [])

  return (
    <div className="min-h-screen bg-gray-50">
      <Header isConnected={isConnected} />
      
      <main className="container mx-auto px-4 py-8">
        <Routes>
          <Route path="/entry" element={<Navigate to="/login" replace />} />
          <Route path="/login" element={<AuthEntry initialMode="login" />} />
          <Route path="/register" element={<AuthEntry initialMode="register" />} />
          <Route path="/demo" element={
            <div style={{ maxWidth: 720, margin: '40px auto', display: 'grid', gap: 24 }}>
              <h1>Web3 Демонстрація</h1>
              <DemoRegister />
              <section>
                <h2>Web3</h2>
                <ConnectWallet />
              </section>
              <section>
                <h2>Завантаження вкладень</h2>
                {/* For demo we will perform a quick admin login and pass the token to UploadAttachment */}
                <DemoUploader />
              </section>
            </div>
          } />
          <Route path="/tg" element={<TelegramWebApp />} />

          {/* Protected application routes */}
          <Route path="/" element={<ProtectedRoute><OrderForm /></ProtectedRoute>} />
          <Route path="/orders" element={<ProtectedRoute><OrderList /></ProtectedRoute>} />
          <Route path="/orders/:id" element={<ProtectedRoute><OrderDetails /></ProtectedRoute>} />
          <Route path="/admin" element={<ProtectedRoute><AdminPage /></ProtectedRoute>} />
        </Routes>
      </main>
    </div>
  )
}

// Telegram WebApp component
function TelegramWebApp() {
  return (
    <div className="max-w-md mx-auto">
      <h1 className="text-2xl font-bold mb-6">AutoAssist+ WebApp</h1>
      <OrderForm isTelegram={true} />
    </div>
  )
}

export default App
