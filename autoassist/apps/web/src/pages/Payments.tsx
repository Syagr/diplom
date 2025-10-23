import { useEffect, useMemo, useState } from 'react'
import { useParams } from 'react-router-dom'
import axios from 'axios'

export default function PaymentPage() {
  const { orderId } = useParams<{ orderId: string }>()
  const [order, setOrder] = useState<any>(null)
  const [txHash, setTxHash] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!orderId) return
    ;(async () => {
      try {
        const r = await axios.get(`/api/orders/${orderId}`)
        setOrder(r.data)
      } catch (e:any) {
        setError(e?.response?.data?.error || 'Не вдалося завантажити замовлення')
      }
    })()
  }, [orderId])

  const total = useMemo(() => {
    const items = order?.estimate?.items || []
    const labor = Number(order?.estimate?.labor || 0)
    const sum = items.reduce((acc:number, it:any) => acc + Number(it.amount || it.price || 0), 0)
    return sum + labor
  }, [order])

  async function verifyTx() {
    if (!orderId || !txHash) return
    setSubmitting(true); setError(null); setMessage(null)
    try {
      const r = await axios.post(`/api/payments/web3/verify`, { orderId: Number(orderId), txHash })
      const status = r.data?.status || r.data?.result || 'OK'
      const receiptUrl = r.data?.receiptUrl || r.data?.receipt?.url || null
      setMessage(`Статус платежу: ${status}` + (receiptUrl ? ` | Чек: ${receiptUrl}` : ''))
      if (receiptUrl) {
        // try to open in new tab
        try { window.open(receiptUrl, '_blank') } catch {}
      }
    } catch (e:any) {
      setError(e?.response?.data?.error || 'Помилка перевірки транзакції')
    } finally {
      setSubmitting(false)
    }
  }

  if (!order) {
    return (
      <div className="max-w-3xl mx-auto bg-white p-6 rounded shadow">
        {error ? <div className="text-red-600">{error}</div> : 'Завантаження…'}
      </div>
    )
  }

  return (
    <div className="max-w-3xl mx-auto bg-white p-6 rounded shadow">
      <h2 className="text-2xl font-bold mb-4">Оплата заявки #{orderId}</h2>
      {order.estimate ? (
        <div className="mb-4">
          <h3 className="font-semibold mb-2">Кошторис</h3>
          <ul className="list-disc pl-5 text-sm text-gray-700">
            {(order.estimate.items || []).map((it:any, i:number) => (
              <li key={i}>{it.title || it.name || 'Позиція'} — {it.amount ?? it.price}</li>
            ))}
          </ul>
          <div className="mt-2 text-sm">Роботи: {order.estimate.labor ?? 0}</div>
          <div className="mt-1 font-medium">Разом: {total}</div>
        </div>
      ) : (
        <div className="mb-4 text-gray-600">Кошторис відсутній</div>
      )}

      <div className="mt-6">
        <h3 className="font-semibold mb-2">Web3 оплата (Polygon Amoy)</h3>
        <div className="text-xs text-gray-500 mb-2">Після відправлення транзакції у MetaMask — вставте txHash для перевірки</div>
        <div className="flex gap-2 items-center">
          <input
            className="border px-2 py-1 rounded w-full"
            placeholder="Вставте txHash..."
            value={txHash}
            onChange={e=>setTxHash(e.target.value)}
          />
          <button onClick={verifyTx} disabled={submitting || !txHash} className="px-3 py-1 bg-primary-600 text-white rounded disabled:opacity-60">
            Перевірити
          </button>
        </div>
        {message && <div className="mt-2 text-green-700 text-sm">{message}</div>}
        {error && <div className="mt-2 text-red-700 text-sm">{error}</div>}
      </div>
    </div>
  )
}
