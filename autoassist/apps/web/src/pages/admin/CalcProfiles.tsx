import React, { useEffect, useState } from 'react'
import axios from 'axios'

type Profile = {
  id?: number
  name: string
  code?: string
  active?: boolean
  partsCoeff?: number
  laborCoeff?: number
  nightCoeff?: number
  urgentCoeff?: number
  suvCoeff?: number
  laborRate?: number
}

export default function CalcProfilesAdmin() {
  const [items, setItems] = useState<Profile[]>([])
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState<Profile | null>(null)

  async function load() {
    setLoading(true)
    try {
      const r = await axios.get('/api/calc-profiles')
      setItems(r.data?.items || r.data || [])
    } finally {
      setLoading(false)
    }
  }
  useEffect(() => { load() }, [])

  function startCreate() {
    setEditing({
      name: '',
      code: '',
      active: true,
      partsCoeff: 1,
      laborCoeff: 1,
      nightCoeff: 1,
      urgentCoeff: 1,
      suvCoeff: 1,
      laborRate: 400,
    })
  }
  function startEdit(p: Profile) { setEditing({ ...p }) }
  function cancelEdit() { setEditing(null) }

  async function saveEdit() {
    if (!editing) return
    if (!editing.name || !editing.code) {
      alert('Name and code are required.')
      return
    }
    if ((editing.partsCoeff ?? 0) <= 0 || (editing.laborCoeff ?? 0) <= 0 || (editing.laborRate ?? 0) <= 0) {
      alert('Coefficients and labor rate must be positive.')
      return
    }
    const payload = { ...editing }
    if (payload.id) await axios.put(`/api/calc-profiles/${payload.id}`, payload)
    else await axios.post('/api/calc-profiles', payload)
    setEditing(null)
    await load()
  }

  async function remove(id: number) {
    if (!confirm('Delete this calc profile?')) return
    await axios.delete(`/api/calc-profiles/${id}`)
    await load()
  }

  return (
    <div className="space-y-3">
      <h1 className="text-2xl font-bold">Admin — Calc profiles</h1>
      <div>
        <button onClick={startCreate} className="px-3 py-1 bg-primary-600 text-white rounded">Add</button>
      </div>
      <div className="bg-white rounded shadow overflow-auto">
        <table className="min-w-full text-sm">
          <thead className="bg-gray-50"><tr>
            <th className="text-left p-2">Name</th>
            <th className="text-left p-2">Code</th>
            <th className="text-left p-2">Active</th>
            <th className="text-left p-2">Coeffs</th>
            <th className="p-2"></th>
          </tr></thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={5} className="p-3">Loading...</td></tr>
            ) : items.length === 0 ? (
              <tr><td colSpan={5} className="p-3">No profiles found.</td></tr>
            ) : (
              items.map(p => (
                <tr key={p.id} className="border-t">
                  <td className="p-2">{p.name}</td>
                  <td className="p-2">{p.code}</td>
                  <td className="p-2">{p.active ? 'yes' : 'no'}</td>
                  <td className="p-2">{p.partsCoeff ?? '-'} / {p.laborCoeff ?? '-'} / {p.laborRate ?? '-'}</td>
                  <td className="p-2 text-right space-x-2">
                    <button className="px-2 py-0.5 border rounded" onClick={()=>startEdit(p)}>Edit</button>
                    {p.id && <button className="px-2 py-0.5 border rounded text-red-600" onClick={()=>remove(p.id!)}>Delete</button>}
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
            <h2 className="font-semibold mb-3">{editing.id ? 'Edit' : 'Create'} profile</h2>
            <div className="grid gap-2">
              <input className="border px-2 py-1 rounded" placeholder="Name" value={editing.name} onChange={(e: React.ChangeEvent<HTMLInputElement>)=>setEditing({ ...editing, name: e.target.value })} />
              <input className="border px-2 py-1 rounded" placeholder="Code" value={editing.code || ''} onChange={(e: React.ChangeEvent<HTMLInputElement>)=>setEditing({ ...editing, code: e.target.value })} />
              <label className="inline-flex items-center gap-2">
                <input type="checkbox" checked={!!editing.active} onChange={(e: React.ChangeEvent<HTMLInputElement>)=>setEditing({ ...editing, active: e.target.checked })} /> Active
              </label>
              <div className="grid grid-cols-2 gap-2">
                <input className="border px-2 py-1 rounded" placeholder="partsCoeff" type="number" step="0.01" value={editing.partsCoeff ?? ''} onChange={(e: React.ChangeEvent<HTMLInputElement>)=>setEditing({ ...editing, partsCoeff: Number(e.target.value) })} />
                <input className="border px-2 py-1 rounded" placeholder="laborCoeff" type="number" step="0.01" value={editing.laborCoeff ?? ''} onChange={(e: React.ChangeEvent<HTMLInputElement>)=>setEditing({ ...editing, laborCoeff: Number(e.target.value) })} />
                <input className="border px-2 py-1 rounded" placeholder="nightCoeff" type="number" step="0.01" value={editing.nightCoeff ?? ''} onChange={(e: React.ChangeEvent<HTMLInputElement>)=>setEditing({ ...editing, nightCoeff: Number(e.target.value) })} />
                <input className="border px-2 py-1 rounded" placeholder="urgentCoeff" type="number" step="0.01" value={editing.urgentCoeff ?? ''} onChange={(e: React.ChangeEvent<HTMLInputElement>)=>setEditing({ ...editing, urgentCoeff: Number(e.target.value) })} />
                <input className="border px-2 py-1 rounded" placeholder="suvCoeff" type="number" step="0.01" value={editing.suvCoeff ?? ''} onChange={(e: React.ChangeEvent<HTMLInputElement>)=>setEditing({ ...editing, suvCoeff: Number(e.target.value) })} />
                <input className="border px-2 py-1 rounded" placeholder="laborRate" type="number" step="1" value={editing.laborRate ?? ''} onChange={(e: React.ChangeEvent<HTMLInputElement>)=>setEditing({ ...editing, laborRate: Number(e.target.value) })} />
              </div>
            </div>
            <div className="mt-3 flex gap-2 justify-end">
              <button onClick={cancelEdit} className="px-3 py-1 border rounded">Cancel</button>
              <button onClick={saveEdit} className="px-3 py-1 bg-primary-600 text-white rounded">Save</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
