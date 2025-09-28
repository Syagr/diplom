import { io, Socket } from 'socket.io-client'
import auth from './auth'

let _socket: Socket | null = null

async function backendHealthy(timeout = 1000): Promise<boolean> {
  try {
    const controller = new AbortController()
    const id = setTimeout(() => controller.abort(), timeout)
    // In dev, avoid going through Vite proxy so we don't trigger proxy error logs when backend is down
  const base = (import.meta as any).env?.DEV ? 'http://127.0.0.1:3000' : ''
  // API health endpoint is exposed at /healthz (not /api/healthz)
  const res = await fetch(`${base}/healthz`, { signal: controller.signal })
    clearTimeout(id)
    return res.ok
  } catch (e) {
    return false
  }
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
    _socket = io('/', { path: '/socket.io', transports: ['websocket'], auth: { token }, autoConnect: false })
    return _socket
  }

  _socket = io('/', { path: '/socket.io', transports: ['websocket'], auth: { token } })
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
