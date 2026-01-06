import { useEffect, useState } from 'react'
import axios from 'axios'

type Receipt = {
  id: number
  orderId?: number
  amount?: number
  currency?: string
  createdAt?: string
  url?: string | null
}

function normalizeError(e: any, fallback: string) {
  const msg = e?.response?.data?.error?.message || e?.response?.data?.message || e?.message || fallback
  if (/not[_ ]?found/i.test(String(msg))) return 'Receipts are not available yet.'
  return String(msg)
}

export default function ReceiptsPage() {
  const [receipts, setReceipts] = useState<Receipt[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  async function load() {
    setLoading(true)
    setError(null)
    try {
      const r = await axios.get('/api/receipts')
      setReceipts(r.data || [])
    } catch (e: any) {
      setError(normalizeError(e, 'Failed to load receipts'))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
  }, [])

  function openReceipt(id: number) {
    const url = `/api/receipts/${id}/file`
    setReceipts((prev: Receipt[]) => prev.map((rc: Receipt) => (rc.id === id ? { ...rc, url } : rc)))
    try {
      window.open(url, '_blank')
    } catch (e: any) {
      setError(normalizeError(e, 'Failed to open receipt'))
    }
  }

  return (
    <div className="max-w-4xl mx-auto bg-white p-6 rounded shadow">
      <h2 className="text-2xl font-bold mb-4">Receipts</h2>
      {loading && <div>Loading...</div>}
      {error && <div className="text-red-700 text-sm mb-2">{error}</div>}
      {!loading && receipts.length === 0 && <div className="text-gray-600">No receipts yet.</div>}
      <ul className="divide-y">
        {receipts.map((r: Receipt) => (
          <li key={r.id} className="py-3 flex items-center justify-between">
            <div>
              <div className="font-medium">
                Receipt #{r.id} {r.orderId ? `(order ${r.orderId})` : ''}
              </div>
              <div className="text-sm text-gray-600">
                Amount: {r.amount ?? '-'} {r.currency ?? ''} - {r.createdAt ? new Date(r.createdAt).toLocaleString() : ''}
              </div>
            </div>
            <div>
              {r.url ? (
                <a className="text-primary-600 hover:underline" target="_blank" href={r.url} rel="noreferrer">
                  Open PDF
                </a>
              ) : (
                <button className="px-3 py-1 bg-primary-600 text-white rounded" onClick={() => openReceipt(r.id)}>
                  Generate link
                </button>
              )}
            </div>
          </li>
        ))}
      </ul>
    </div>
  )
}
