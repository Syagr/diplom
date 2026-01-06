import { useEffect, useState } from 'react'
import getSocket from '../utils/socket'

function getAuthHeader() {
  try {
    const t = localStorage.getItem('aa_token')
    return t ? { Authorization: `Bearer ${t}` } : {}
  } catch {
    return {}
  }
}

type AuditEvent = {
  id: string
  time: string
  type: string
  payload: any
}

export default function AdminPage() {
  const [events, setEvents] = useState<AuditEvent[]>([])

  useEffect(() => {
    let mounted = true
    let socketInstance: any = null

    function add(type: string, payload: any) {
      setEvents((prev) => [
        { id: String(Date.now()) + Math.random().toString(36).slice(2), time: new Date().toLocaleString(), type, payload },
        ...prev,
      ].slice(0, 200))
    }

    ;(async () => {
      try {
        const s = await getSocket()
        if (!mounted || !s) return
        socketInstance = s

        const onOrderNew = (p: any) => add('order:new', p)
        const onPresign = (p: any) => add('attachment:presign', p)
        const onReady = (p: any) => add('attachment:ready', p)
        const onNotification = (p: any) => add('notification', p)

        s.on('order:new', onOrderNew)
        s.on('order:created', onOrderNew)
        s.on('attachment:presign', onPresign)
        s.on('attachment:ready', onReady)
        s.on('notification', onNotification)
      } catch (err) {
        console.warn('Admin socket init failed', err)
      }
    })()

    ;(async () => {
      try {
        const headers: HeadersInit = { 'Content-Type': 'application/json', ...(getAuthHeader() as Record<string, string>) }
        const res = await fetch('/api/admin/audit', {
          headers,
          credentials: 'include',
          cache: 'no-store' as RequestCache,
        })
        if (!res.ok) {
          console.warn('Failed to fetch audit events', await res.text())
          return
        }
        const data = await res.json()
        if (!mounted) return
        const items = Array.isArray(data) ? data : (data?.items || [])
        const mapped = items
          .map((e: any) => ({ id: String(e.id), time: new Date(e.createdAt).toLocaleString(), type: e.type, payload: e.payload || {} }))
          .filter((ev: any) => {
            if (ev.type === 'estimate:created' && ev.payload && ev.payload._estimateApproved) return false
            return true
          })
        setEvents(mapped)
      } catch (e) {
        console.warn('Failed to load audit events', e)
      }
    })()

    return () => {
      mounted = false
      try {
        if (socketInstance) {
          socketInstance.off('order:new')
          socketInstance.off('order:created')
          socketInstance.off('attachment:presign')
          socketInstance.off('attachment:ready')
          socketInstance.off('notification')
        }
      } catch {}
    }
  }, [])

  async function approveEstimate(estimateId: number) {
    try {
      const res = await fetch(`/api/estimates/${estimateId}/approve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(getAuthHeader() as Record<string, string>) },
        credentials: 'include',
      })
      if (!res.ok) {
        const txt = await res.text()
        console.warn('Approve failed', txt)
        return
      }

      try {
        await res.json()
        setEvents((prev) =>
          prev.filter((ev) => {
            const id = Number(ev.payload?.estimateId || ev.payload?.estimate?.id || 0)
            return id !== estimateId
          })
        )
      } catch (e) {
        console.warn('Failed to parse approve response, falling back to audit refetch', e)
      }

      const r2 = await fetch('/api/admin/audit', {
        headers: { 'Content-Type': 'application/json', ...(getAuthHeader() as Record<string, string>) },
        credentials: 'include',
        cache: 'no-store' as RequestCache,
      })
      if (r2.ok) {
        const d = await r2.json()
        const items = Array.isArray(d) ? d : (d?.items || [])
        const mapped = items
          .map((e: any) => ({ id: String(e.id), time: new Date(e.createdAt).toLocaleString(), type: e.type, payload: e.payload || {} }))
          .filter((ev: any) => {
            if (ev.type === 'estimate:created' && ev.payload && ev.payload._estimateApproved) return false
            return true
          })
        setEvents(mapped)
      }
    } catch (e) {
      console.warn('Approve error', e)
    }
  }

  return (
    <div style={{ maxWidth: 1100, margin: '40px auto' }}>
      <h1 className="text-2xl font-bold mb-4">Admin Activity log</h1>
      <div className="mb-4 text-sm">
        <a href="/admin/board" className="mr-3 text-primary-700">Board</a>
        <a href="/admin/calc-profiles" className="mr-3 text-primary-700">Calc profiles</a>
        <a href="/admin/service-centers" className="mr-3 text-primary-700">Service centers</a>
        <a href="/admin/broadcast" className="text-primary-700">Broadcast</a>
      </div>
      <p className="mb-4 text-sm text-gray-600">
        This page aggregates recent platform events for admins (orders, attachments, notifications).
      </p>

      <div className="border rounded p-3 bg-white shadow-sm">
        <h2 className="font-medium mb-2">Recent events</h2>
        {events.length === 0 ? (
          <div className="text-sm text-gray-500">No events yet.</div>
        ) : (
          <ul className="space-y-2">
            {events.map((ev) => (
              <li key={ev.id} className="p-2 border rounded bg-gray-50">
                <div className="text-xs text-gray-500">{ev.time} - {ev.type}</div>
                <pre className="text-sm mt-1 max-h-40 overflow-auto">{JSON.stringify(ev.payload, null, 2)}</pre>
                {ev.payload && (ev.payload.estimateId || ev.payload.estimate?.id) ? (
                  <div className="mt-2">
                    {ev.payload._estimateApproved ? (
                      <button className="px-3 py-1 bg-gray-300 text-gray-700 rounded" disabled>Already approved</button>
                    ) : (
                      <button
                        className="px-3 py-1 bg-green-500 text-white rounded"
                        onClick={() => approveEstimate(Number(ev.payload.estimateId || ev.payload.estimate.id))}
                      >
                        Approve estimate
                      </button>
                    )}
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
