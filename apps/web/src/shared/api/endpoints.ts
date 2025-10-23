export const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:3000'
export const SOCKET_URL = import.meta.env.VITE_SOCKET_URL || API_BASE_URL

export const endpoints = {
  auth: {
    nonce: '/api/auth/wallet/nonce',
    verify: '/api/auth/wallet/verify',
  },
  orders: {
    root: '/api/orders',
    byId: (id: string) => `/api/orders/${id}`,
    status: (id: string) => `/api/orders/${id}/status`,
    complete: (id: string) => `/api/orders/${id}/complete`,
    proof: (id: string) => `/api/orders/${id}/proof`,
  },
  payments: {
    verify: '/api/payments/web3/verify',
  },
  notifications: {
    root: '/api/notifications',
    read: (id: string) => `/api/notifications/${id}/read`,
    prefs: '/api/notifications/preferences',
    unreadCount: '/api/notifications/unread-count',
  },
  serviceCenters: {
    root: '/api/service-centers',
  },
  calcProfiles: {
    root: '/api/calc-profiles',
  },
  attachments: {
    url: (id: string) => `/api/attachments/${id}/url`,
  },
  health: '/healthz',
} as const
