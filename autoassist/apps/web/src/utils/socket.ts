import { io, Socket } from 'socket.io-client'
import auth from './auth'

let _socket: Socket | null = null

async function backendHealthy(timeout = 1000): Promise<boolean> {
  // Deduplicate concurrent health checks to avoid multiple simultaneous requests
  // Use a short-lived in-flight promise cache
  const now = Date.now()
  if ((backendHealthy as any)._cache && (backendHealthy as any)._cache.exp > now) {
    return (backendHealthy as any)._cache.p
  }

  const controller = new AbortController()
  const id = setTimeout(() => controller.abort(), timeout)
  const base = (import.meta as any).env?.DEV ? 'http://127.0.0.1:3000' : ''
  const p = fetch(`${base}/healthz`, { signal: controller.signal })
    .then(res => { clearTimeout(id); return res.ok })
    .catch(() => false)

  // cache for 1 second
  ;(backendHealthy as any)._cache = { p, exp: Date.now() + 1000 }
  return p
}

export async function getSocket() {
  const token = auth.getToken() || undefined
  if (_socket) {
    const current = (_socket as any)?.io?.opts?.auth?.token
    if (current !== token) {
      try { _socket.close() } catch (e) { /* ignore */ }
      _socket = null
    }
  }
  if (_socket) return _socket

  // Only attempt to open websocket if backend is reachable to avoid Vite proxy errors
  const ok = await backendHealthy(800)
  if (!ok) {
    // return a not-connected socket proxy that will try later when ensureSocket is called
    // create a socket with autoConnect false so it doesn't immediately attempt to connect
    // Prefer direct backend host in dev to bypass Vite proxy which can log noisy errors
    const base = (import.meta as any).env?.DEV ? 'http://127.0.0.1:3000' : '/'
    _socket = io(base, { path: '/socket.io', transports: ['websocket'], auth: { token }, autoConnect: false })
    return _socket
  }

  // When healthy, connect (prefer direct backend host when in dev)
  const base = (import.meta as any).env?.DEV ? 'http://127.0.0.1:3000' : '/'
  const authPayload: any = { token }
  // Do not send any dev-only auth fields. A valid JWT token is required for socket authentication.
  // Debug: print handshake info so we can verify what is sent to the server
  try { console.debug('[socket] connecting', { base, authPayload, dev: (import.meta as any).env?.DEV }) } catch (e) {}
  _socket = io(base, { path: '/socket.io', transports: ['websocket'], auth: authPayload, reconnectionDelay: 1000, reconnectionAttempts: Infinity })
  // Attach basic diagnostics so connect errors are visible in console
  _socket.on && _socket.on('connect_error', (err: any) => console.warn('WebSocket connect_error', err?.message ?? err))
  return _socket
}

export async function ensureSocket() {
  try { if (_socket) _socket.close() } catch (e) { /* ignore */ }
  _socket = null
  return getSocket()
}

export function closeSocket() {
  if (!_socket) return
  try { _socket.close() } catch (e) { /* ignore */ }
  _socket = null
}

export default getSocket
