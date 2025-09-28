import { useEffect, useState } from 'react'
import getSocket from '../utils/socket'

export default function AdminPage() {
  const [events, setEvents] = useState<Array<{id:string; time:string; type:string; payload:any}>>([])

  useEffect(() => {
    const s = getSocket()
    function add(type:string, payload:any) {
      setEvents(prev => [{ id: String(Date.now()) + Math.random().toString(36).slice(2), time: new Date().toLocaleString(), type, payload }, ...prev].slice(0, 200))
    }

    s.on('order:new', (p:any) => add('order:new', p))
    s.on('attachment:presign', (p:any) => add('attachment:presign', p))
    s.on('attachment:ready', (p:any) => add('attachment:ready', p))
    s.on('notification', (p:any) => add('notification', p))

    // generic catch-all via io "event" isn't available; we subscribe to known events.

    return () => {
      try { s.off('order:new') } catch {}
      try { s.off('attachment:presign') } catch {}
      try { s.off('attachment:ready') } catch {}
      try { s.off('notification') } catch {}
    }
  }, [])

  return (
    <div style={{ maxWidth: 1100, margin: '40px auto' }}>
      <h1 className="text-2xl font-bold mb-4">Admin — Activity history</h1>
      <p className="mb-4 text-sm text-gray-600">This view shows recent platform events for admins (orders, attachments, notifications).</p>

      <div className="border rounded p-3 bg-white shadow-sm">
        <h2 className="font-medium mb-2">Recent events</h2>
        {events.length === 0 ? (
          <div className="text-sm text-gray-500">No events yet</div>
        ) : (
          <ul className="space-y-2">
            {events.map(ev => (
              <li key={ev.id} className="p-2 border rounded bg-gray-50">
                <div className="text-xs text-gray-500">{ev.time} • {ev.type}</div>
                <pre className="text-sm mt-1 max-h-40 overflow-auto">{JSON.stringify(ev.payload, null, 2)}</pre>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
