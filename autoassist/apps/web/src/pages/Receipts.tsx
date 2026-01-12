import { useEffect, useState } from 'react'
import axios from 'axios'

type Receipt = {
  id: number
  orderId?: number
  amount?: number | string
  currency?: string
  createdAt?: string
  url?: string | null
}

function normalizeError(e: any, fallback: string) {
  const msg = e?.response?.data?.error?.message || e?.response?.data?.message || e?.message || fallback
  if (e?.response?.status === 401 || /unauthorized/i.test(String(msg))) {
    return 'Please sign in to view receipts.'
  }
  if (/not[_ ]?found/i.test(String(msg))) return 'Receipts are not available yet.'
  return String(msg)
}

export default function ReceiptsPage() {
  const [receipts, setReceipts] = useState<Receipt[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const formatAmount = (amount?: number | string, currency?: string) => {
    if (amount == null) return 'n/a'
    const numericAmount = Number(amount)
    if (!Number.isFinite(numericAmount)) return String(amount)
    return `${numericAmount.toFixed(2)} ${currency ?? ''}`.trim()
  }

  const formatDate = (value?: string) => {
    if (!value) return 'n/a'
    try {
      return new Date(value).toLocaleString()
    } catch (_e) {
      return value
    }
  }

  async function load() {
    setLoading(true)
    setError(null)
    try {
      const r = await axios.get('/api/receipts')
      const payload = r.data
      const items = Array.isArray(payload)
        ? payload
        : Array.isArray(payload?.items)
          ? payload.items
          : Array.isArray(payload?.receipts)
            ? payload.receipts
            : []
      setReceipts(items)
    } catch (e: any) {
      setError(normalizeError(e, 'Failed to load receipts'))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
  }, [])

  async function openReceipt(id: number) {
    try {
      const res = await axios.get(`/api/receipts/${id}/file`, { responseType: 'blob' })
      const blobUrl = URL.createObjectURL(res.data)
      setReceipts((prev: Receipt[]) => prev.map((rc: Receipt) => (rc.id === id ? { ...rc, url: blobUrl } : rc)))
      window.open(blobUrl, '_blank')
      setTimeout(() => URL.revokeObjectURL(blobUrl), 60_000)
    } catch (e: any) {
      setError(normalizeError(e, 'Failed to open receipt'))
    }
  }

  return (
    <div className="max-w-5xl mx-auto">
      <div className="bg-white shadow-sm border border-slate-200 rounded-2xl p-6">
        <div className="flex items-start justify-between mb-4">
          <div>
            <p className="text-sm text-slate-500">Documents</p>
            <h2 className="text-2xl font-semibold text-slate-900">Receipts</h2>
            <p className="text-sm text-slate-500 mt-1">Download payment receipts and share with clients.</p>
          </div>
          <div className="text-sm text-slate-500">{receipts.length} total</div>
        </div>

        {loading && <div className="text-slate-600 text-sm">Loading receipts...</div>}
        {error && <div className="text-red-700 text-sm mb-3">{error}</div>}
        {!loading && receipts.length === 0 && <div className="text-slate-600">No receipts yet.</div>}

        <div className="grid gap-4">
          {receipts.map((r: Receipt) => {
            const hasLink = Boolean(r.url)
            return (
              <div
                key={r.id}
                className="rounded-xl border border-slate-200 shadow-sm bg-gradient-to-br from-white via-white to-slate-50/80 p-5 hover:shadow-md transition"
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="space-y-1">
                    <div className="text-xs uppercase tracking-wide text-slate-500">Receipt</div>
                    <div className="text-lg font-semibold text-slate-900">PAY-{r.id}</div>
                    <div className="text-sm text-slate-500">Order #{r.orderId ?? 'n/a'}</div>
                  </div>
                  <div className="text-right space-y-1">
                    <div className="text-2xl font-semibold text-slate-900">{formatAmount(r.amount, r.currency)}</div>
                    <div className="text-sm text-slate-500">{formatDate(r.createdAt)}</div>
                    <div className={`inline-flex items-center px-2 py-1 rounded-full text-xs font-medium ${hasLink ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700'}`}>
                      {hasLink ? 'PDF ready' : 'Needs link'}
                    </div>
                  </div>
                </div>

                <div className="mt-4 flex flex-wrap items-center justify-between gap-3 text-sm text-slate-600">
                  <div className="flex flex-wrap gap-3">
                    <span className="px-2.5 py-1 rounded-lg bg-slate-100 text-slate-700">Currency: {r.currency ?? 'n/a'}</span>
                    <span className="px-2.5 py-1 rounded-lg bg-slate-100 text-slate-700">Receipt #{r.id}</span>
                    {r.orderId && <span className="px-2.5 py-1 rounded-lg bg-slate-100 text-slate-700">Order #{r.orderId ?? 'n/a'}</span>}
                  </div>
                  <div className="flex items-center gap-2">
                  {hasLink && (
                    <button
                      className="px-3 py-2 rounded-lg border border-slate-200 text-primary-700 hover:bg-primary-50"
                      onClick={() => openReceipt(r.id)}
                    >
                      Open PDF
                    </button>
                  )}
                  <button
                    className="px-3.5 py-2 rounded-lg bg-primary-600 text-white font-medium hover:bg-primary-700"
                    onClick={() => openReceipt(r.id)}
                  >
                    {hasLink ? 'Refresh link' : 'Generate link'}
                    </button>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

