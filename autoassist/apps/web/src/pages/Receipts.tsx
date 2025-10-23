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

export default function ReceiptsPage() {
  const [receipts, setReceipts] = useState<Receipt[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  async function load() {
    setLoading(true); setError(null)
    try {
      const r = await axios.get('/api/receipts')
      setReceipts(r.data || [])
    } catch (e:any) {
      setError(e?.response?.data?.error || 'Не вдалося завантажити чеки')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [])

  async function getUrl(id:number) {
    try {
      const r = await axios.post(`/api/receipts/${id}/url`)
      const url = r.data?.url
      if (url) {
  setReceipts((prev: Receipt[]) => prev.map((rc: Receipt) => rc.id === id ? { ...rc, url } : rc))
        try { window.open(url, '_blank') } catch {}
      }
    } catch (e:any) {
      setError(e?.response?.data?.error || 'Помилка отримання посилання на чек')
    }
  }

  return (
    <div className="max-w-4xl mx-auto bg-white p-6 rounded shadow">
      <h2 className="text-2xl font-bold mb-4">Квитанції</h2>
      {loading && <div>Завантаження…</div>}
      {error && <div className="text-red-700 text-sm mb-2">{error}</div>}
      {!loading && receipts.length === 0 && <div className="text-gray-600">Поки що немає квитанцій</div>}
      <ul className="divide-y">
  {receipts.map((r: Receipt) => (
          <li key={r.id} className="py-3 flex items-center justify-between">
            <div>
              <div className="font-medium">Чек #{r.id} {r.orderId ? `(заявка ${r.orderId})` : ''}</div>
              <div className="text-sm text-gray-600">Сума: {r.amount ?? '-'} {r.currency ?? ''} • {r.createdAt ? new Date(r.createdAt).toLocaleString() : ''}</div>
            </div>
            <div>
              {r.url ? (
                <a className="text-primary-600 hover:underline" target="_blank" href={r.url} rel="noreferrer">Відкрити PDF</a>
              ) : (
                <button className="px-3 py-1 bg-primary-600 text-white rounded" onClick={() => getUrl(r.id)}>Отримати посилання</button>
              )}
            </div>
          </li>
        ))}
      </ul>
    </div>
  )
}
