import axios from 'axios'

export type NotificationItem = {
  id: number
  type: string
  title?: string
  body?: string
  priority?: string
  order?: { id: number; status?: string } | null
  action?: { label?: string; url?: string } | null
  createdAt: string
  readAt?: string | null
}

export async function getUnreadCount(): Promise<number> {
  const r = await axios.get('/api/notifications/unread-count')
  return Number(r.data?.data?.unreadCount ?? 0)
}

export async function getInbox(limit = 50, offset = 0, unreadOnly?: boolean, type?: string): Promise<NotificationItem[]> {
  const page = Math.floor(offset / limit) + 1
  const r = await axios.get('/api/notifications', {
    params: {
      page,
      limit,
      unreadOnly: unreadOnly ? 'true' : 'false',
      ...(type ? { type } : {}),
    },
  })
  const items = r.data?.data?.notifications || []
  return items.map((n: any) => ({
    id: n.id,
    type: n.type,
    title: n.title,
    body: n.message,
    priority: n.priority,
    order: n.order || null,
    action: n.action || null,
    createdAt: n.createdAt,
    readAt: n.readAt ?? null,
  }))
}

export async function markRead(id: number): Promise<void> {
  try {
    await axios.put(`/api/notifications/${id}/read`)
  } catch (e) {
    // ignore errors silently to avoid blocking UI
  }
}

export type NotificationPreferences = {
  channels?: string[]
  types?: string[]
  [k: string]: any
}

export async function getPreferences(): Promise<NotificationPreferences> {
  const r = await axios.get('/api/notifications/preferences')
  // normalize to simple shape
  return {
    channels: r.data?.data?.channels || r.data?.channels || r.data?.prefs?.channels || [],
    types: r.data?.data?.types || r.data?.types || r.data?.prefs?.types || [],
    ...(r.data?.data || r.data || {}),
  }
}

export async function putPreferences(prefs: NotificationPreferences): Promise<void> {
  await axios.put('/api/notifications/preferences', prefs)
}

export default { getUnreadCount, getInbox, markRead, getPreferences, putPreferences }
