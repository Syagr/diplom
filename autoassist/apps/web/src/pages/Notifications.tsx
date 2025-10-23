import { useEffect, useState } from 'react'
import { getInbox, getUnreadCount, markRead, getPreferences, putPreferences, type NotificationItem, type NotificationPreferences } from '../utils/notifications'
import getSocket from '../utils/socket'

export default function NotificationsPage() {
  const [items, setItems] = useState<NotificationItem[]>([])
  const [unread, setUnread] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const limit = 20
  const [offset, setOffset] = useState(0)
  const [unreadOnly, setUnreadOnly] = useState(false)
  const [typeFilter, setTypeFilter] = useState<string>('')
  const [prefs, setPrefs] = useState<NotificationPreferences | null>(null)
  const [savingPrefs, setSavingPrefs] = useState(false)

  useEffect(() => {
    let mounted = true
    async function load() {
      try {
        setLoading(true)
        const [cnt, inbox, pr] = await Promise.all([
          getUnreadCount(),
          getInbox(limit, offset),
          getPreferences().catch(() => null as any)
        ])
        if (!mounted) return
        setUnread(cnt)
        setItems(inbox)
        if (pr) setPrefs(pr)
        setError(null)
      } catch (e:any) {
        if (!mounted) return
        setError(e?.message || 'Не вдалося завантажити сповіщення')
      } finally { if (mounted) setLoading(false) }
    }
    load()

    // Listen for live notifications via socket and prepend
    ;(async () => {
      try {
        const s = await getSocket()
        if (!s) return
        const onNotif = (payload:any) => {
          setItems(prev => [{
            id: payload?.id || Date.now(),
            type: payload?.type || 'inapp',
            title: payload?.title || payload?.subject || 'Нове сповіщення',
            body: payload?.body || payload?.message || '',
            data: payload?.data || null,
            createdAt: new Date().toISOString(),
            readAt: null,
          }, ...prev])
          setUnread(u => u + 1)
        }
        s.on('notification', onNotif)
      } catch {}
    })()

    return () => { mounted = false }
  }, [limit, offset])

  async function handleMarkRead(n: NotificationItem) {
    try { await markRead(n.id) } catch {}
    setItems(prev => prev.map(it => it.id === n.id ? { ...it, readAt: new Date().toISOString() } : it))
    setUnread(u => Math.max(0, u - 1))
  }

  async function reloadWithFilters() {
    setLoading(true); setError(null)
    try {
      const inbox = await getInbox(limit, offset)
      let filtered = inbox as NotificationItem[]
      if (unreadOnly) filtered = filtered.filter(x => !x.readAt)
      if (typeFilter) filtered = filtered.filter(x => (x.type || '').toLowerCase() === typeFilter.toLowerCase())
      setItems(filtered)
    } catch (e:any) {
      setError(e?.message || 'Не вдалося оновити список')
    } finally { setLoading(false) }
  }

  async function savePreferences() {
    if (!prefs) return
    setSavingPrefs(true)
    try { await putPreferences(prefs) } finally { setSavingPrefs(false) }
  }

  return (
    <div className="max-w-3xl mx-auto">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-2xl font-bold">Сповіщення</h2>
        <div className="text-sm text-gray-600">Непрочитані: {unread}</div>
      </div>
      <div className="bg-white rounded shadow p-3 mb-4">
        <div className="flex flex-wrap gap-3 items-center">
          <label className="text-sm text-gray-700 flex items-center gap-2">
            <input type="checkbox" checked={unreadOnly} onChange={e => setUnreadOnly(e.target.checked)} /> Лише непрочитані
          </label>
          <div className="text-sm text-gray-700 flex items-center gap-2">
            Тип:
            <input className="border px-2 py-1 rounded" placeholder="напр. ORDER_UPDATED" value={typeFilter} onChange={e=>setTypeFilter(e.target.value)} />
          </div>
          <div className="ml-auto flex items-center gap-2">
            <button className="px-3 py-1 border rounded" onClick={() => setOffset(Math.max(0, offset - limit))}>Назад</button>
            <button className="px-3 py-1 border rounded" onClick={() => setOffset(offset + limit)}>Вперед</button>
            <button className="px-3 py-1 bg-primary-600 text-white rounded" onClick={reloadWithFilters}>Застосувати</button>
          </div>
        </div>
      </div>
      {loading ? (
        <div>Завантаження…</div>
      ) : error ? (
        <div className="text-red-600">{error}</div>
      ) : (
        <ul className="space-y-3">
          {items.map(n => (
            <li key={n.id} className={`p-3 rounded border ${n.readAt ? 'bg-white' : 'bg-yellow-50'}`}>
              <div className="flex items-start justify-between">
                <div>
                  <div className="font-medium">{n.title || n.type}</div>
                  {n.body && <div className="text-sm text-gray-700 mt-0.5">{n.body}</div>}
                  {n.data && <pre className="text-xs text-gray-500 mt-1 max-h-28 overflow-auto">{JSON.stringify(n.data, null, 2)}</pre>}
                </div>
                {!n.readAt && (
                  <button className="text-sm text-primary-700 hover:underline" onClick={() => handleMarkRead(n)}>Позначити прочитаним</button>
                )}
              </div>
            </li>
          ))}
          {items.length === 0 && (
            <li className="text-gray-500">Сповіщень поки що немає</li>
          )}
        </ul>
      )}

      {/* Preferences */}
      <div className="mt-6 bg-white p-4 rounded shadow">
        <h3 className="font-semibold mb-3">Налаштування сповіщень</h3>
        {!prefs ? (
          <div className="text-sm text-gray-600">Завантаження налаштувань…</div>
        ) : (
          <div className="space-y-3">
            <div>
              <div className="text-sm text-gray-700 mb-1">Канали</div>
              <label className="text-sm text-gray-700 mr-4">
                <input type="checkbox" checked={(prefs.channels || []).includes('IN_APP')}
                  onChange={e => setPrefs(prev => ({ ...(prev||{}), channels: Array.from(new Set([...(prev?.channels||[]).filter(c=>c!=='IN_APP'), ...(e.target.checked?['IN_APP']:[]) ])) }))} /> In‑App
              </label>
              <label className="text-sm text-gray-700">
                <input type="checkbox" checked={(prefs.channels || []).includes('EMAIL')}
                  onChange={e => setPrefs(prev => ({ ...(prev||{}), channels: Array.from(new Set([...(prev?.channels||[]).filter(c=>c!=='EMAIL'), ...(e.target.checked?['EMAIL']:[]) ])) }))} /> Email
              </label>
            </div>
            <div className="text-xs text-gray-500">Типи можна уточнити пізніше на адмін‑сторонах (поточні: {(prefs.types||[]).join(', ') || '—'})</div>
            <button className="px-3 py-1 bg-primary-600 text-white rounded" disabled={savingPrefs} onClick={savePreferences}>{savingPrefs ? 'Збереження…' : 'Зберегти'}</button>
          </div>
        )}
      </div>
    </div>
  )
}
