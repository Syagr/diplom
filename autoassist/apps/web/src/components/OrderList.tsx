import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import axios from 'axios'

interface Order {
  id: number
  status: string
  category: string
  priority: string
  createdAt: string
  client: {
    name: string
    phone: string
    email?: string
  }
  vehicle: {
    plate: string
    make?: string
    model?: string
    year?: number
  }
  locations?: Array<{ id: number; orderId: number; kind: string; lat?: number; lng?: number; address?: string }>
}

const API_URL = (import.meta as any).env?.VITE_API_URL || '' // use Vite proxy '/api' when empty

function OrderList() {
  const [orders, setOrders] = useState<Order[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const navigate = useNavigate()

  useEffect(() => {
    fetchOrders()
  }, [])

  const fetchOrders = async () => {
    try {
      setLoading(true)
      const response = await axios.get(`${API_URL}/api/orders`)
      setOrders(response.data.orders)
      setError(null)
    } catch (err: any) {
      setError(err.response?.data?.error || 'Помилка завантаження заявок')
    } finally {
      setLoading(false)
    }
  }

  const getStatusColor = (status: string) => {
    const colors = {
      NEW: 'bg-blue-100 text-blue-800',
      TRIAGE: 'bg-yellow-100 text-yellow-800',
      QUOTE: 'bg-purple-100 text-purple-800',
      APPROVED: 'bg-green-100 text-green-800',
      SCHEDULED: 'bg-indigo-100 text-indigo-800',
      INSERVICE: 'bg-orange-100 text-orange-800',
      READY: 'bg-emerald-100 text-emerald-800',
      DELIVERED: 'bg-gray-100 text-gray-800',
      CLOSED: 'bg-gray-100 text-gray-800',
      CANCELLED: 'bg-red-100 text-red-800'
    }
    return colors[status as keyof typeof colors] || 'bg-gray-100 text-gray-800'
  }

  const getStatusText = (status: string) => {
    const texts = {
      NEW: 'Нова',
      TRIAGE: 'Сортування',
      QUOTE: 'Кошторис',
      APPROVED: 'Затверджено',
      SCHEDULED: 'Заплановано',
      INSERVICE: 'В роботі',
      READY: 'Готово',
      DELIVERED: 'Видано',
      CLOSED: 'Закрито',
      CANCELLED: 'Скасовано'
    }
    return texts[status as keyof typeof texts] || status
  }

  const getPriorityColor = (priority: string) => {
    const colors = {
      low: 'bg-gray-100 text-gray-600',
      normal: 'bg-blue-100 text-blue-600',
      high: 'bg-orange-100 text-orange-600',
      urgent: 'bg-red-100 text-red-600'
    }
    return colors[priority as keyof typeof colors] || 'bg-gray-100 text-gray-600'
  }

  if (loading) {
    return (
      <div className="flex justify-center items-center h-64">
        <div className="text-lg">Завантаження заявок...</div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded">
        {error}
        <button
          onClick={fetchOrders}
          className="ml-4 underline hover:no-underline"
        >
          Спробувати знову
        </button>
      </div>
    )
  }

  return (
    <div className="max-w-6xl mx-auto">
      <div className="flex justify-between items-center mb-6">
        <h2 className="text-3xl font-bold">Заявки</h2>
        <button
          onClick={fetchOrders}
          className="bg-primary-600 text-white px-4 py-2 rounded-md hover:bg-primary-700"
        >
          Оновити
        </button>
      </div>

      {orders.length === 0 ? (
        <div className="text-center py-12 bg-white rounded-lg shadow">
          <div className="text-gray-500 text-lg">Заявок поки немає</div>
          <a
            href="/"
            className="text-primary-600 hover:text-primary-700 underline mt-2 inline-block"
          >
            Створити першу заявку
          </a>
        </div>
      ) : (
        <div className="grid gap-4">
          {orders.map((order) => (
            <div key={order.id} className="bg-white rounded-lg shadow p-6">
              <div className="flex items-start justify-between mb-4">
                <div>
                  <h3 className="text-xl font-semibold mb-2">
                    Заявка #{order.id}
                  </h3>
                  <div className="flex items-center space-x-4 text-sm text-gray-600">
                    <span>{new Date(order.createdAt).toLocaleString('uk-UA')}</span>
                    <span>{order.category}</span>
                  </div>
                </div>
                <div className="flex items-center space-x-2">
                  <span className={`px-2 py-1 rounded-full text-xs font-medium ${getPriorityColor(order.priority)}`}>
                    {order.priority}
                  </span>
                  <span className={`px-3 py-1 rounded-full text-sm font-medium ${getStatusColor(order.status)}`}>
                    {getStatusText(order.status)}
                  </span>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <h4 className="font-medium text-gray-900 mb-1">Клієнт</h4>
                  <p className="text-gray-600">{order.client.name}</p>
                  <p className="text-gray-600">{order.client.phone}</p>
                </div>
                <div>
                  <h4 className="font-medium text-gray-900 mb-1">Автомобіль</h4>
                  <p className="text-gray-600">
                    {order.vehicle.make} {order.vehicle.model}
                  </p>
                  <p className="text-gray-600">{order.vehicle.plate}</p>
                </div>
              </div>
              {/* show pickup address if available */}
              {order.locations && order.locations.length > 0 && (
                <div className="mt-3 text-sm text-gray-700">
                  {(() => {
                    const pickup = order.locations.find((l:any) => l.kind === 'pickup')
                    if (pickup) return (<div><strong>Місце виклику:</strong> {pickup.address || `${pickup.lat}, ${pickup.lng}`}</div>)
                    return null
                  })()}
                </div>
              )}
              <div className="mt-4 pt-4 border-t border-gray-200">
                <button onClick={() => navigate(`/orders/${order.id}`)} className="text-primary-600 hover:text-primary-700 font-medium">
                  Переглянути деталі →
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

export default OrderList