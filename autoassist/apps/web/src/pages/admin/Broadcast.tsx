import React, { useState } from 'react'
import axios from 'axios'

export default function BroadcastAdmin() {
  const [title, setTitle] = useState('')
  const [message, setMessage] = useState('')
  const [priority, setPriority] = useState<'LOW'|'MEDIUM'|'HIGH'|'URGENT'>('LOW')
  const [targetRole, setTargetRole] = useState('customer')
  const [channels, setChannels] = useState<string[]>(['IN_APP'])
  const [status, setStatus] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  function toggleChannel(ch: string) {
    setChannels(prev => prev.includes(ch) ? prev.filter(x=>x!==ch) : [...prev, ch])
  }

  async function send(e: React.FormEvent) {
    e.preventDefault()
    setStatus(null); setError(null)
    try {
      const r = await axios.post('/api/notifications/broadcast', { title, message, priority, targetRole, channels })
      const delivered = r.data?.delivered ?? r.data?.count ?? 'ok'
      setStatus(`Надіслано (${delivered})`)
    } catch (e:any) {
      setError(e?.response?.data?.message || e?.message || 'Помилка відправки')
    }
  }

  return (
    <div className="max-w-xl space-y-3">
      <h1 className="text-2xl font-bold">Адмін — Broadcast</h1>
      <form onSubmit={send} className="bg-white p-4 rounded shadow grid gap-3">
        <input value={title} onChange={(e: React.ChangeEvent<HTMLInputElement>)=>setTitle(e.target.value)} placeholder="Заголовок" className="border px-2 py-1 rounded" />
        <textarea value={message} onChange={(e: React.ChangeEvent<HTMLTextAreaElement>)=>setMessage(e.target.value)} placeholder="Повідомлення" className="border p-2 rounded h-32" />
        <div className="flex gap-3 items-center">
          <label className="text-sm">Пріоритет</label>
          <select value={priority} onChange={(e: React.ChangeEvent<HTMLSelectElement>)=>setPriority(e.target.value as any)} className="border px-2 py-1 rounded">
            {['LOW','MEDIUM','HIGH','URGENT'].map(p => <option key={p} value={p}>{p}</option>)}
          </select>
        </div>
        <div className="flex gap-3 items-center">
          <label className="text-sm">Роль</label>
          <select value={targetRole} onChange={(e: React.ChangeEvent<HTMLSelectElement>)=>setTargetRole(e.target.value)} className="border px-2 py-1 rounded">
            {['customer','service_manager','admin'].map(r => <option key={r} value={r}>{r}</option>)}
          </select>
        </div>
        <div className="flex gap-4 items-center">
          <label className="inline-flex items-center gap-2"><input type="checkbox" checked={channels.includes('IN_APP')} onChange={()=>toggleChannel('IN_APP')} /> IN_APP</label>
          <label className="inline-flex items-center gap-2"><input type="checkbox" checked={channels.includes('EMAIL')} onChange={()=>toggleChannel('EMAIL')} /> EMAIL</label>
        </div>
        <div>
          <button className="px-3 py-1 bg-primary-600 text-white rounded" type="submit">Відправити</button>
        </div>
        {status && <div className="text-green-700 text-sm">{status}</div>}
        {error && <div className="text-red-600 text-sm">{error}</div>}
      </form>
    </div>
  )
}
