import React, { useEffect, useMemo, useState } from 'react'
import axios from 'axios'
import getSocket from '../../utils/socket'

type Order = {
  id: number
  status: string
  category?: string
  priority?: string
  createdAt?: string
  client?: { name?: string; phone?: string }
  estimate?: { total?: number }
}

export default function OrdersBoard() {
  const [items, setItems] = useState<Order[]>([])
  const [loading, setLoading] = useState(true)
  const [status, setStatus] = useState<string>('')
  const [search, setSearch] = useState('')

  const params = useMemo(() => {
    const p: any = { limit: 50 }
    if (status) p.status = status
    if (search) p.q = search
    return p
  }, [status, search])

  async function load() {
    setLoading(true)
    try {
      const r = await axios.get('/api/orders', { params })
      const list: Order[] = r.data?.items || r.data || []
      setItems(list)
    } finally { setLoading(false) }
  }

  useEffect(() => { load() }, [params])

  useEffect(() => {
    let sock: any
    (async () => {
      try {
        sock = await getSocket()
        if (!sock) return
        const onCreated = () => load()
        const onUpdated = () => load()
        sock.on && sock.on('order:created', onCreated)
        sock.on && sock.on('order:updated', onUpdated)
      } catch {}
    })()
    return () => { try { if (sock) { sock.off && sock.off('order:created'); sock.off && sock.off('order:updated') } } catch {} }
  }, [])

  return (
    <div className="space-y-3">
      <h1 className="text-2xl font-bold">Адмін — Заявки</h1>
      <div className="flex gap-2 items-center">
  <select value={status} onChange={(e: React.ChangeEvent<HTMLSelectElement>)=>setStatus(e.target.value)} className="border px-2 py-1 rounded">
          <option value="">Статус: всі</option>
          {['NEW','QUOTE','APPROVED','READY','DELIVERED','CANCELLED','CLOSED'].map(s=> (
            <option key={s} value={s}>{s}</option>
          ))}
        </select>
  <input placeholder="Пошук (ім’я/тел/категорія)" value={search} onChange={(e: React.ChangeEvent<HTMLInputElement>)=>setSearch(e.target.value)} className="border px-2 py-1 rounded w-64" />
        <button onClick={load} className="px-3 py-1 border rounded">Оновити</button>
      </div>
      <div className="bg-white rounded shadow overflow-auto">
        <table className="min-w-full text-sm">
          <thead className="bg-gray-50">
            <tr>
              <th className="text-left p-2">ID</th>
              <th className="text-left p-2">Статус</th>
              <th className="text-left p-2">Клієнт</th>
              <th className="text-left p-2">Категорія</th>
              <th className="text-left p-2">Сума</th>
              <th className="text-left p-2">Створено</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td className="p-3" colSpan={6}>Завантаження…</td></tr>
            ) : items.length === 0 ? (
              <tr><td className="p-3" colSpan={6}>Немає записів</td></tr>
            ) : (
              items.map(o => (
                <tr key={o.id} className="border-t">
                  <td className="p-2">{o.id}</td>
                  <td className="p-2"><span className="px-2 py-0.5 rounded bg-gray-100">{o.status}</span></td>
                  <td className="p-2">{o.client?.name} {o.client?.phone ? `(${o.client.phone})` : ''}</td>
                  <td className="p-2">{o.category || '-'}</td>
                  <td className="p-2">{o.estimate?.total ?? '—'}</td>
                  <td className="p-2">{o.createdAt ? new Date(o.createdAt).toLocaleString() : '—'}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
