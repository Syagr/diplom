import React, { useEffect, useState } from 'react'
import axios from 'axios'

type Center = { id?: number; name: string; phone?: string; email?: string; city?: string; address?: string; lat: number; lng: number }

export default function ServiceCentersAdmin() {
  const [items, setItems] = useState<Center[]>([])
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState<Center | null>(null)

  async function load() {
    setLoading(true)
    try {
      const r = await axios.get('/api/service-centers')
      setItems(r.data?.items || r.data || [])
    } finally { setLoading(false) }
  }

  useEffect(() => { load() }, [])

  function startCreate() {
    setEditing({ name: '', city: '', address: '', lat: 50.45, lng: 30.523, phone: '', email: '' })
  }
  function startEdit(c: Center) { setEditing({ ...c }) }
  function cancelEdit() { setEditing(null) }

  async function saveEdit() {
    if (!editing) return
    const payload = { ...editing }
    if (payload.id) {
      await axios.put(`/api/service-centers/${payload.id}`, payload)
    } else {
      await axios.post('/api/service-centers', payload)
    }
    setEditing(null)
    await load()
  }

  async function remove(id: number) {
    if (!confirm('Видалити сервіс-центр?')) return
    await axios.delete(`/api/service-centers/${id}`)
    await load()
  }

  return (
    <div className="space-y-3">
      <h1 className="text-2xl font-bold">Адмін — Сервіс-центри</h1>
      <div>
        <button onClick={startCreate} className="px-3 py-1 bg-primary-600 text-white rounded">Додати</button>
      </div>

      <div className="bg-white rounded shadow overflow-auto">
        <table className="min-w-full text-sm">
          <thead className="bg-gray-50">
            <tr>
              <th className="text-left p-2">Назва</th>
              <th className="text-left p-2">Місто</th>
              <th className="text-left p-2">Адреса</th>
              <th className="text-left p-2">Координати</th>
              <th className="text-left p-2">Контакти</th>
              <th className="p-2"></th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={6} className="p-3">Завантаження…</td></tr>
            ) : items.length === 0 ? (
              <tr><td colSpan={6} className="p-3">Немає записів</td></tr>
            ) : (
              items.map(c => (
                <tr key={c.id} className="border-t">
                  <td className="p-2">{c.name}</td>
                  <td className="p-2">{c.city}</td>
                  <td className="p-2">{c.address}</td>
                  <td className="p-2">{c.lat}, {c.lng}</td>
                  <td className="p-2">{c.phone || ''} {c.email ? `(${c.email})` : ''}</td>
                  <td className="p-2 text-right space-x-2">
                    <button className="px-2 py-0.5 border rounded" onClick={()=>startEdit(c)}>Редагувати</button>
                    {c.id && <button className="px-2 py-0.5 border rounded text-red-600" onClick={()=>remove(c.id!)}>Видалити</button>}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {editing && (
        <div className="fixed inset-0 bg-black/30 flex items-center justify-center">
          <div className="bg-white p-4 rounded shadow max-w-lg w-full">
            <h2 className="font-semibold mb-3">{editing.id ? 'Редагувати' : 'Новий'} сервіс-центр</h2>
            <div className="grid gap-2">
              <input className="border px-2 py-1 rounded" placeholder="Назва" value={editing.name} onChange={(e: React.ChangeEvent<HTMLInputElement>)=>setEditing({ ...editing, name: e.target.value })} />
              <input className="border px-2 py-1 rounded" placeholder="Місто" value={editing.city || ''} onChange={(e: React.ChangeEvent<HTMLInputElement>)=>setEditing({ ...editing, city: e.target.value })} />
              <input className="border px-2 py-1 rounded" placeholder="Адреса" value={editing.address || ''} onChange={(e: React.ChangeEvent<HTMLInputElement>)=>setEditing({ ...editing, address: e.target.value })} />
              <div className="flex gap-2">
                <input className="border px-2 py-1 rounded w-1/2" placeholder="Lat" value={editing.lat} onChange={(e: React.ChangeEvent<HTMLInputElement>)=>setEditing({ ...editing, lat: Number(e.target.value) || 0 })} />
                <input className="border px-2 py-1 rounded w-1/2" placeholder="Lng" value={editing.lng} onChange={(e: React.ChangeEvent<HTMLInputElement>)=>setEditing({ ...editing, lng: Number(e.target.value) || 0 })} />
              </div>
              <input className="border px-2 py-1 rounded" placeholder="Телефон" value={editing.phone || ''} onChange={(e: React.ChangeEvent<HTMLInputElement>)=>setEditing({ ...editing, phone: e.target.value })} />
              <input className="border px-2 py-1 rounded" placeholder="Email" value={editing.email || ''} onChange={(e: React.ChangeEvent<HTMLInputElement>)=>setEditing({ ...editing, email: e.target.value })} />
            </div>
            <div className="mt-3 flex gap-2 justify-end">
              <button onClick={cancelEdit} className="px-3 py-1 border rounded">Скасувати</button>
              <button onClick={saveEdit} className="px-3 py-1 bg-primary-600 text-white rounded">Зберегти</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
