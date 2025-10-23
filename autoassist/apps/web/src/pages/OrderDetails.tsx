import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import axios from 'axios'

function OrderDetails() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const [order, setOrder] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [timeline, setTimeline] = useState<any[]>([])

  useEffect(() => {
    if (!id) return
    const load = async () => {
      try {
        setLoading(true)
        const r = await axios.get(`/api/orders/${id}`)
        setOrder(r.data)
        // best-effort timeline fetch (optional endpoint)
        try {
          const t = await axios.get(`/api/orders/${id}/timeline`)
          setTimeline(Array.isArray(t.data?.items) ? t.data.items : (t.data || []))
        } catch {}
      } catch (e:any) {
        setError(e.response?.data?.error || 'Помилка при завантаженні заявки')
      } finally { setLoading(false) }
    }
    load()
  }, [id])

  if (loading) return <div>Завантаження...</div>
  if (error) return <div className="text-red-600">{error}</div>
  if (!order) return <div>Заявку не знайдено</div>

  return (
    <div className="max-w-3xl mx-auto bg-white p-6 rounded shadow">
      <h2 className="text-2xl font-bold mb-4">Заявка #{order.id}</h2>
      <p className="mb-2"><strong>Категорія:</strong> {order.category}</p>
      <p className="mb-2"><strong>Опис:</strong> {order.description || '-'}</p>
      {timeline && timeline.length > 0 && (
        <div className="mt-4">
          <h3 className="font-semibold">Таймлайн</h3>
          <ul className="mt-2 space-y-1">
            {timeline.map((ev:any, idx:number) => (
              <li key={ev.id || idx} className="text-sm text-gray-700">
                <span className="text-gray-500 mr-2">{ev.createdAt ? new Date(ev.createdAt).toLocaleString() : ''}</span>
                <span className="font-medium">{ev.type || ev.status || 'event'}</span>
                {ev.note && <span className="ml-2">— {ev.note}</span>}
              </li>
            ))}
          </ul>
        </div>
      )}
      <h3 className="mt-4 font-semibold">Клієнт</h3>
      <p>{order.client?.name} — {order.client?.phone}</p>
      <h3 className="mt-4 font-semibold">Автомобіль</h3>
      <p>{order.vehicle?.make} {order.vehicle?.model} — {order.vehicle?.plate}</p>
      <h3 className="mt-4 font-semibold">Локації</h3>
      <ul>
        {(order.locations || []).map((l:any) => {
          const kindLabel = l.kind === 'pickup' ? 'Місце виклику' : (l.kind === 'dropoff' ? 'Місце доставки' : l.kind)
          return (<li key={l.id}><strong>{kindLabel}:</strong> {l.address || `${l.lat}, ${l.lng}`}</li>)
        })}
      </ul>
      <div className="mt-6 flex flex-wrap gap-3">
        {/* Pay CTA if quote exists and not paid */}
        {order?.estimate && !order?.payment?.completed && (
          <button className="px-3 py-1 bg-primary-600 text-white rounded" onClick={() => navigate(`/payments/${order.id}`)}>Оплатити</button>
        )}
        {/* Receipt link if available */}
        {order?.payment?.receiptUrl && (
          <a target="_blank" rel="noreferrer" className="px-3 py-1 border rounded text-primary-700" href={order.payment.receiptUrl}>Відкрити чек</a>
        )}
        {/* Proof viewer when completed */}
        {(order?.status === 'DELIVERED' || order?.status === 'CLOSED' || order?.proofHash) && (
          <button className="px-3 py-1 border rounded" onClick={() => navigate(`/orders/${order.id}/proof`)}>Доказ виконання</button>
        )}
      </div>
    </div>
  )
}

export default OrderDetails
