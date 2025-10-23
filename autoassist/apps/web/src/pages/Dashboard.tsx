import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import axios from 'axios'
import { getInbox, NotificationItem } from '../utils/notifications'

type Order = {
  id: number
  status: string
  category?: string
  priority?: string
  createdAt: string
}

export default function DashboardPage() {
  const [orders, setOrders] = useState<Order[]>([])
  const [notes, setNotes] = useState<NotificationItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const navigate = useNavigate()

  useEffect(() => {
    let cancelled = false
    async function load() {
      setLoading(true); setError(null)
      try {
        const [o, n] = await Promise.all([
          axios.get('/api/orders', { params: { limit: 5 } }),
          getInbox(5, 0),
        ])
        if (!cancelled) {
          setOrders((o.data?.orders || o.data || []).slice(0, 5))
          setNotes(n)
        }
      } catch (e:any) {
        if (!cancelled) setError(e?.response?.data?.error || 'Не вдалося завантажити дашборд')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    return () => { cancelled = true }
  }, [])

  return (
    <div className="max-w-5xl mx-auto grid gap-6">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold">Мої заявки</h2>
        <Link to="/orders/new" className="px-3 py-1 bg-primary-600 text-white rounded">Нова заявка</Link>
      </div>
      {error && <div className="text-red-700 text-sm">{error}</div>}
      {loading ? (
        <div>Завантаження…</div>
      ) : orders.length === 0 ? (
        <div className="bg-white p-6 rounded shadow text-gray-600">Поки що немає заявок</div>
      ) : (
        <ul className="bg-white rounded shadow divide-y">
          {orders.map((o) => (
            <li key={o.id} className="p-4 flex items-center justify-between">
              <div>
                <div className="font-medium">Заявка #{o.id}</div>
                <div className="text-sm text-gray-600">{new Date(o.createdAt).toLocaleString('uk-UA')} • {o.category ?? '-'} • {o.status}</div>
              </div>
              <button className="text-primary-600" onClick={() => navigate(`/orders/${o.id}`)}>Деталі →</button>
            </li>
          ))}
        </ul>
      )}
      <div>
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-xl font-semibold">Останні сповіщення</h3>
          <Link to="/notifications" className="text-primary-600">Всі сповіщення →</Link>
        </div>
        {notes.length === 0 ? (
          <div className="bg-white p-6 rounded shadow text-gray-600">Немає сповіщень</div>
        ) : (
          <ul className="bg-white rounded shadow divide-y">
            {notes.map(n => (
              <li key={n.id} className="p-4">
                <div className="font-medium">{n.title ?? n.type}</div>
                <div className="text-sm text-gray-700">{n.body ?? ''}</div>
                <div className="text-xs text-gray-500">{new Date(n.createdAt).toLocaleString('uk-UA')}</div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
