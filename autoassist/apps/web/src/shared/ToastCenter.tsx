import { useEffect, useState } from 'react'
import getSocket from '../utils/socket'

type Toast = {
  id: number
  title: string
  body?: string
  level: 'info' | 'success' | 'warn' | 'error'
}

function levelFromPriority(p?: string): Toast['level'] {
  const v = (p || '').toUpperCase()
  if (v === 'URGENT') return 'error'
  if (v === 'HIGH') return 'warn'
  if (v === 'MEDIUM') return 'success'
  return 'info'
}

export default function ToastCenter() {
  const [toasts, setToasts] = useState<Toast[]>([])

  useEffect(() => {
  let mounted = true
  let s: any
    (async () => {
      try {
  s = await getSocket()
  if (!mounted || !s) return
        const onNotif = (payload: any) => {
          const t: Toast = {
            id: Date.now() + Math.floor(Math.random() * 1000),
            title: payload?.title || payload?.subject || 'Повідомлення',
            body: payload?.body || payload?.message || '',
            level: levelFromPriority(payload?.priority),
          }
          setToasts(prev => [t, ...prev].slice(0, 5))
          setTimeout(() => {
            setToasts(prev => prev.filter(x => x.id !== t.id))
          }, 5000)
        }
        if (s && typeof s.on === 'function') {
          s.on('notification', onNotif)
        }
      } catch {}
    })()
    return () => { mounted = false }
  }, [])

  if (toasts.length === 0) return null

  return (
    <div className="fixed top-4 right-4 z-50 space-y-2">
      {toasts.map(t => (
        <div key={t.id} className={
          `max-w-sm rounded shadow px-3 py-2 border text-sm ` +
          (t.level==='error' ? 'bg-red-50 border-red-200 text-red-800' :
           t.level==='warn' ? 'bg-yellow-50 border-yellow-200 text-yellow-800' :
           t.level==='success' ? 'bg-green-50 border-green-200 text-green-800' :
           'bg-blue-50 border-blue-200 text-blue-800')
        }>
          <div className="font-semibold">{t.title}</div>
          {t.body && <div>{t.body}</div>}
        </div>
      ))}
    </div>
  )
}
