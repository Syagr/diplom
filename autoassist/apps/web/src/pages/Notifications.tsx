import { useEffect, useState } from 'react'
import {
  getInbox,
  getUnreadCount,
  markRead,
  getPreferences,
  putPreferences,
  type NotificationItem,
  type NotificationPreferences,
} from '../utils/notifications'
import getSocket from '../utils/socket'

function normalizeError(e: any, fallback: string) {
  const msg = e?.response?.data?.error?.message || e?.response?.data?.message || e?.message || fallback
  if (/not[_ ]?found/i.test(String(msg))) return 'Notifications are not available yet.'
  return String(msg)
}

const TYPE_LABELS: Record<string, string> = {
  ORDER_CREATED: 'Order created',
  ORDER_UPDATED: 'Order updated',
  PAYMENT_CONFIRMED: 'Payment confirmed',
  PAYMENT_FAILED: 'Payment failed',
  BROADCAST: 'Broadcast',
  SYSTEM_ALERT: 'System alert',
}

function formatType(type?: string) {
  if (!type) return 'Notification'
  if (TYPE_LABELS[type]) return TYPE_LABELS[type]
  return type.replace(/_/g, ' ').toLowerCase().replace(/^\w/, (c) => c.toUpperCase())
}

function formatDate(value?: string) {
  if (!value) return '-'
  try {
    return new Date(value).toLocaleString()
  } catch {
    return value
  }
}

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
          getInbox(limit, offset, unreadOnly, typeFilter || undefined),
          getPreferences().catch(() => null as any),
        ])
        if (!mounted) return
        setUnread(cnt)
        setItems(inbox)
        if (pr) setPrefs(pr)
        setError(null)
      } catch (e: any) {
        if (!mounted) return
        setError(normalizeError(e, 'Failed to load notifications'))
      } finally {
        if (mounted) setLoading(false)
      }
    }
    load()

    ;(async () => {
      try {
        const s = await getSocket()
        if (!s) return
        const onNotif = (payload: any) => {
          setItems((prev) => [
            {
              id: payload?.id || Date.now(),
              type: payload?.type || 'IN_APP',
              title: payload?.title || payload?.subject || 'Notification',
              body: payload?.body || payload?.message || '',
              priority: payload?.priority,
              order: payload?.order || null,
              action: payload?.action || null,
              createdAt: new Date().toISOString(),
              readAt: null,
            },
            ...prev,
          ])
          setUnread((u) => u + 1)
        }
        s.on('notification', onNotif)
      } catch {}
    })()

    return () => {
      mounted = false
    }
  }, [limit, offset])

  async function handleMarkRead(n: NotificationItem) {
    try {
      await markRead(n.id)
    } catch {}
    setItems((prev) =>
      prev.map((it) => (it.id === n.id ? { ...it, readAt: new Date().toISOString() } : it)),
    )
    setUnread((u) => Math.max(0, u - 1))
  }

  async function reloadWithFilters() {
    setLoading(true)
    setError(null)
    try {
      const inbox = await getInbox(limit, offset, unreadOnly, typeFilter || undefined)
      setItems(inbox as NotificationItem[])
    } catch (e: any) {
      setError(normalizeError(e, 'Failed to apply filters'))
    } finally {
      setLoading(false)
    }
  }

  async function savePreferences() {
    if (!prefs) return
    if (!prefs.channels || prefs.channels.length === 0) {
      setError('Select at least one notification channel')
      return
    }
    setSavingPrefs(true)
    try {
      await putPreferences(prefs)
    } finally {
      setSavingPrefs(false)
    }
  }

  return (
    <div className="max-w-3xl mx-auto">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-2xl font-bold">Notifications</h2>
        <div className="text-sm text-gray-600">Unread: {unread}</div>
      </div>
      <div className="bg-white rounded shadow p-3 mb-4">
        <div className="flex flex-wrap gap-3 items-center">
          <label className="text-sm text-gray-700 flex items-center gap-2">
            <input type="checkbox" checked={unreadOnly} onChange={(e) => setUnreadOnly(e.target.checked)} />
            Unread only
          </label>
          <div className="text-sm text-gray-700 flex items-center gap-2">
            Type:
            <input
              className="border px-2 py-1 rounded"
              placeholder="ORDER_UPDATED"
              value={typeFilter}
              onChange={(e) => setTypeFilter(e.target.value)}
            />
          </div>
          <div className="ml-auto flex items-center gap-2">
            <button className="px-3 py-1 border rounded" onClick={() => setOffset(Math.max(0, offset - limit))}>
              Back
            </button>
            <button className="px-3 py-1 border rounded" onClick={() => setOffset(offset + limit)}>
              Next
            </button>
            <button className="px-3 py-1 bg-primary-600 text-white rounded" onClick={reloadWithFilters}>
              Apply
            </button>
          </div>
        </div>
      </div>
      {loading ? (
        <div>Loading...</div>
      ) : error ? (
        <div className="text-red-600">{error}</div>
      ) : (
        <ul className="space-y-3">
          {items.map((n) => (
            <li key={n.id} className={`p-3 rounded border ${n.readAt ? 'bg-white' : 'bg-yellow-50'}`}>
              <div className="flex items-start justify-between">
                <div>
                  <div className="font-medium">{n.title || formatType(n.type)}</div>
                  {n.body && <div className="text-sm text-gray-700 mt-0.5">{n.body}</div>}
                  <div className="text-xs text-gray-500 mt-1">{formatDate(n.createdAt)}</div>
                  {n.order?.id && (
                    <div className="text-xs text-gray-600 mt-1">
                      Order #{n.order.id}{n.order.status ? ` · ${n.order.status}` : ''}
                    </div>
                  )}
                  {n.action?.url && (
                    <a className="text-xs text-primary-600 hover:underline mt-1 inline-block" href={n.action.url}>
                      {n.action.label || 'Open'}
                    </a>
                  )}
                </div>
                {!n.readAt && (
                  <button className="text-sm text-primary-700 hover:underline" onClick={() => handleMarkRead(n)}>
                    Mark as read
                  </button>
                )}
              </div>
            </li>
          ))}
          {items.length === 0 && <li className="text-gray-500">No notifications yet.</li>}
        </ul>
      )}

      <div className="mt-6 bg-white p-4 rounded shadow">
        <h3 className="font-semibold mb-3">Notification preferences</h3>
        {!prefs ? (
          <div className="text-sm text-gray-600">Loading preferences...</div>
        ) : (
          <div className="space-y-3">
            <div>
              <div className="text-sm text-gray-700 mb-1">Channels</div>
              <label className="text-sm text-gray-700 mr-4">
                <input
                  type="checkbox"
                  checked={(prefs.channels || []).includes('IN_APP')}
                  onChange={(e) =>
                    setPrefs((prev) => ({
                      ...(prev || {}),
                      channels: Array.from(
                        new Set([
                          ...(prev?.channels || []).filter((c) => c !== 'IN_APP'),
                          ...(e.target.checked ? ['IN_APP'] : []),
                        ]),
                      ),
                    }))
                  }
                />{' '}
                In-app
              </label>
              <label className="text-sm text-gray-700">
                <input
                  type="checkbox"
                  checked={(prefs.channels || []).includes('EMAIL')}
                  onChange={(e) =>
                    setPrefs((prev) => ({
                      ...(prev || {}),
                      channels: Array.from(
                        new Set([
                          ...(prev?.channels || []).filter((c) => c !== 'EMAIL'),
                          ...(e.target.checked ? ['EMAIL'] : []),
                        ]),
                      ),
                    }))
                  }
                />{' '}
                Email
              </label>
            </div>
            <div className="text-xs text-gray-500">
              Types: {(prefs.types || []).join(', ') || '-'}
            </div>
            <button className="px-3 py-1 bg-primary-600 text-white rounded" disabled={savingPrefs} onClick={savePreferences}>
              {savingPrefs ? 'Saving...' : 'Save preferences'}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
