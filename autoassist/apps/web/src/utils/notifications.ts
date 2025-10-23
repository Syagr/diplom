import axios from 'axios'

export type NotificationItem = {
  id: number
  type: string
  title?: string
  body?: string
  data?: any
  createdAt: string
  readAt?: string | null
}

export async function getUnreadCount(): Promise<number> {
  const r = await axios.get('/api/notifications/unread-count')
  return Number(r.data?.count || 0)
}

export async function getInbox(limit = 50, offset = 0): Promise<NotificationItem[]> {
  const r = await axios.get('/api/notifications/inbox', { params: { limit, offset } })
  const items = r.data?.items || r.data?.notifications || []
  return items
}

export async function markRead(id: number): Promise<void> {
  try {
    await axios.post(`/api/notifications/${id}/read`)
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
    channels: r.data?.channels || r.data?.prefs?.channels || [],
    types: r.data?.types || r.data?.prefs?.types || [],
    ...r.data,
  }
}

export async function putPreferences(prefs: NotificationPreferences): Promise<void> {
  await axios.put('/api/notifications/preferences', prefs)
}

export default { getUnreadCount, getInbox, markRead, getPreferences, putPreferences }
