import React, { useEffect, useState } from 'react'
import axios from 'axios'
import ConnectWallet from '../components/ConnectWallet'
import { getPreferences, putPreferences, NotificationPreferences } from '../utils/notifications'

export default function ProfilePage() {
  const [prefs, setPrefs] = useState<NotificationPreferences>({ channels: [], types: [] })
  const [saving, setSaving] = useState(false)
  const [loaded, setLoaded] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [phone, setPhone] = useState('')

  useEffect(() => {
    let cancelled = false
    async function load() {
      try {
        setError(null)
        // preferences
        const p = await getPreferences().catch(()=>({ channels: [], types: [] }))
        if (!cancelled) setPrefs(p)
        // basic profile (best-effort, optional endpoint)
        try {
          const r = await axios.get('/api/me')
          if (!cancelled && r?.data) {
            setName(r.data.name || '')
            setEmail(r.data.email || '')
            setPhone(r.data.phone || '')
          }
        } catch {}
      } catch (e:any) {
        if (!cancelled) setError(e?.message || 'Не вдалося завантажити налаштування')
      } finally {
        if (!cancelled) setLoaded(true)
      }
    }
    load()
    return () => { cancelled = true }
  }, [])

  const toggleChannel = (ch: string) => {
    setPrefs(prev => {
      const set = new Set(prev.channels || [])
      if (set.has(ch)) set.delete(ch); else set.add(ch)
      return { ...prev, channels: Array.from(set) }
    })
  }

  const toggleType = (t: string) => {
    setPrefs(prev => {
      const set = new Set(prev.types || [])
      if (set.has(t)) set.delete(t); else set.add(t)
      return { ...prev, types: Array.from(set) }
    })
  }

  async function saveAll(e?: React.FormEvent) {
    e?.preventDefault()
    setSaving(true)
    setError(null)
    try {
      await putPreferences(prefs)
      // optional profile save if endpoint exists
      try {
        await axios.put('/api/me', { name, email, phone })
      } catch {}
    } catch (err:any) {
      setError(err?.message || 'Помилка збереження')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <h1 className="text-2xl font-bold">Профіль і налаштування</h1>

      {!loaded ? (
        <div>Завантаження…</div>
      ) : (
        <>
          {error && <div className="text-red-600">{error}</div>}

          <section className="bg-white p-4 rounded shadow">
            <h2 className="font-semibold mb-3">Контакти</h2>
            <form onSubmit={saveAll} className="grid gap-3 max-w-lg">
              <input value={name} onChange={(e: React.ChangeEvent<HTMLInputElement>)=>setName(e.target.value)} placeholder="Ім’я" className="border px-2 py-1 rounded" />
              <input value={email} onChange={(e: React.ChangeEvent<HTMLInputElement>)=>setEmail(e.target.value)} placeholder="Email" className="border px-2 py-1 rounded" />
              <input value={phone} onChange={(e: React.ChangeEvent<HTMLInputElement>)=>setPhone(e.target.value)} placeholder="Телефон" className="border px-2 py-1 rounded" />
              <div>
                <button className="px-3 py-1 bg-primary-600 text-white rounded" disabled={saving}>Зберегти</button>
              </div>
            </form>
          </section>

          <section className="bg-white p-4 rounded shadow">
            <h2 className="font-semibold mb-3">Нотифікації</h2>
            <div className="mb-2 font-medium">Канали</div>
            <div className="flex gap-4 mb-4">
              {['IN_APP','EMAIL'].map(ch => (
                <label key={ch} className="inline-flex items-center gap-2">
                  <input type="checkbox" checked={Boolean(prefs.channels?.includes(ch))} onChange={()=>toggleChannel(ch)} /> {ch}
                </label>
              ))}
            </div>
            <div className="mb-2 font-medium">Типи</div>
            <div className="flex gap-4 flex-wrap">
              {['ORDER_CREATED','ORDER_UPDATED','PAYMENT_CONFIRMED','PAYMENT_FAILED','BROADCAST'].map(t => (
                <label key={t} className="inline-flex items-center gap-2">
                  <input type="checkbox" checked={Boolean(prefs.types?.includes(t))} onChange={()=>toggleType(t)} /> {t}
                </label>
              ))}
            </div>
            <div className="mt-3">
              <button className="px-3 py-1 border rounded" disabled={saving} onClick={saveAll}>Зберегти преференції</button>
            </div>
          </section>

          <section className="bg-white p-4 rounded shadow">
            <h2 className="font-semibold mb-3">Web3 гаманець</h2>
            <p className="text-sm text-gray-600 mb-2">Підключіть MetaMask, увімкніть мережу Polygon Amoy (80002) та виконайте вхід/прив’язку.</p>
            <ConnectWallet />
          </section>
        </>
      )}
    </div>
  )
}
