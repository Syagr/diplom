import React, { useEffect, useState } from 'react'
import axios from 'axios'

type Profile = { id?: number; name: string; code?: string; active?: boolean; coeffs?: Record<string, number> }

export default function CalcProfilesAdmin() {
  const [items, setItems] = useState<Profile[]>([])
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState<Profile | null>(null)
  const [coeffsText, setCoeffsText] = useState<string>('{}')

  async function load() {
    setLoading(true)
    try {
      const r = await axios.get('/api/calc-profiles')
      setItems(r.data?.items || r.data || [])
    } finally { setLoading(false) }
  }
  useEffect(() => { load() }, [])

  function startCreate() { setEditing({ name: '', code: '', active: true, coeffs: {} }); setCoeffsText('{}') }
  function startEdit(p: Profile) { setEditing({ ...p }); setCoeffsText(JSON.stringify(p.coeffs || {}, null, 2)) }
  function cancelEdit() { setEditing(null) }

  async function saveEdit() {
    if (!editing) return
    let coeffs: Record<string, number> = {}
    try { coeffs = JSON.parse(coeffsText || '{}') } catch { alert('Невірний JSON коефіцієнтів'); return }
    const payload = { ...editing, coeffs }
    if (payload.id) await axios.put(`/api/calc-profiles/${payload.id}`, payload)
    else await axios.post('/api/calc-profiles', payload)
    setEditing(null)
    await load()
  }

  async function remove(id: number) {
    if (!confirm('Видалити профіль?')) return
    await axios.delete(`/api/calc-profiles/${id}`)
    await load()
  }

  return (
    <div className="space-y-3">
      <h1 className="text-2xl font-bold">Адмін — Кальк-профілі</h1>
      <div>
        <button onClick={startCreate} className="px-3 py-1 bg-primary-600 text-white rounded">Додати</button>
      </div>
      <div className="bg-white rounded shadow overflow-auto">
        <table className="min-w-full text-sm">
          <thead className="bg-gray-50"><tr>
            <th className="text-left p-2">Назва</th>
            <th className="text-left p-2">Код</th>
            <th className="text-left p-2">Активний</th>
            <th className="text-left p-2">Коеф.</th>
            <th className="p-2"></th>
          </tr></thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={5} className="p-3">Завантаження…</td></tr>
            ) : items.length === 0 ? (
              <tr><td colSpan={5} className="p-3">Немає записів</td></tr>
            ) : (
              items.map(p => (
                <tr key={p.id} className="border-t">
                  <td className="p-2">{p.name}</td>
                  <td className="p-2">{p.code}</td>
                  <td className="p-2">{p.active ? 'так' : 'ні'}</td>
                  <td className="p-2"><code>{Object.keys(p.coeffs || {}).length}</code></td>
                  <td className="p-2 text-right space-x-2">
                    <button className="px-2 py-0.5 border rounded" onClick={()=>startEdit(p)}>Редагувати</button>
                    {p.id && <button className="px-2 py-0.5 border rounded text-red-600" onClick={()=>remove(p.id!)}>Видалити</button>}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {editing && (
        <div className="fixed inset-0 bg-black/30 flex items-center justify-center">
          <div className="bg-white p-4 rounded shadow max-w-2xl w-full">
            <h2 className="font-semibold mb-3">{editing.id ? 'Редагувати' : 'Новий'} профіль</h2>
            <div className="grid gap-2">
              <input className="border px-2 py-1 rounded" placeholder="Назва" value={editing.name} onChange={(e: React.ChangeEvent<HTMLInputElement>)=>setEditing({ ...editing, name: e.target.value })} />
              <input className="border px-2 py-1 rounded" placeholder="Код" value={editing.code || ''} onChange={(e: React.ChangeEvent<HTMLInputElement>)=>setEditing({ ...editing, code: e.target.value })} />
              <label className="inline-flex items-center gap-2">
                <input type="checkbox" checked={!!editing.active} onChange={(e: React.ChangeEvent<HTMLInputElement>)=>setEditing({ ...editing, active: e.target.checked })} /> Активний
              </label>
              <div>
                <div className="text-sm text-gray-600 mb-1">Коефіцієнти (JSON)</div>
                <textarea className="border rounded w-full h-40 p-2 font-mono text-xs" value={coeffsText} onChange={(e: React.ChangeEvent<HTMLTextAreaElement>)=>setCoeffsText(e.target.value)} />
              </div>
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
