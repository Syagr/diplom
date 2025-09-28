import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import axios from 'axios'

function OrderDetails() {
  const { id } = useParams<{ id: string }>()
  const [order, setOrder] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!id) return
    const load = async () => {
      try {
        setLoading(true)
        const r = await axios.get(`/api/orders/${id}`)
        setOrder(r.data)
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
    </div>
  )
}

export default OrderDetails
