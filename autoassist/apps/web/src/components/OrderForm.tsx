import React, { useState } from 'react'
import axios from 'axios'

interface OrderFormProps {
  isTelegram?: boolean
}

interface FormData {
  clientName: string
  clientPhone: string
  clientEmail: string
  vehiclePlate: string
  vehicleVin: string
  vehicleMake: string
  vehicleModel: string
  vehicleYear: string
  category: string
  description: string
  pickupLat: string
  pickupLng: string
  pickupAddress: string
}

const API_URL = (import.meta as any).env?.VITE_API_URL || '' // use Vite proxy '/api' when empty

function OrderForm({ isTelegram = false }: OrderFormProps) {
  const [formData, setFormData] = useState<FormData>({
    clientName: '',
    clientPhone: '',
    clientEmail: '',
    vehiclePlate: '',
    vehicleVin: '',
    vehicleMake: '',
    vehicleModel: '',
    vehicleYear: '',
    category: 'engine',
    description: '',
    pickupLat: '',
    pickupLng: '',
    pickupAddress: ''
  })
  
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [submitResult, setSubmitResult] = useState<{ success: boolean; message: string } | null>(null)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setIsSubmitting(true)
    setSubmitResult(null)

    try {
      const response = await axios.post(`${API_URL}/api/orders`, {
        client: {
          name: formData.clientName,
          phone: formData.clientPhone,
          email: formData.clientEmail || undefined
        },
        vehicle: {
          plate: formData.vehiclePlate,
          vin: formData.vehicleVin || undefined,
          make: formData.vehicleMake || undefined,
          model: formData.vehicleModel || undefined,
          year: formData.vehicleYear ? parseInt(formData.vehicleYear) : undefined
        },
        category: formData.category,
        description: formData.description || undefined,
        channel: isTelegram ? 'telegram' : 'web',
        pickup: (formData.pickupLat && formData.pickupLng) ? {
          lat: parseFloat(formData.pickupLat),
          lng: parseFloat(formData.pickupLng),
          address: formData.pickupAddress || undefined
        } : undefined
      })

      setSubmitResult({
        success: true,
        message: `Заявка #${response.data.order.id} створена успішно!`
      })

      // Reset form
      setFormData({
        clientName: '',
        clientPhone: '',
        clientEmail: '',
        vehiclePlate: '',
        vehicleVin: '',
        vehicleMake: '',
        vehicleModel: '',
        vehicleYear: '',
        category: 'engine',
        description: '',
        pickupLat: '',
        pickupLng: '',
        pickupAddress: ''
      })

    } catch (error: any) {
      setSubmitResult({
        success: false,
        message: error.response?.data?.error || 'Помилка при створенні заявки'
      })
    } finally {
      setIsSubmitting(false)
    }
  }

  const getCurrentLocation = () => {
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (position) => {
          setFormData(prev => ({
            ...prev,
            pickupLat: position.coords.latitude.toString(),
            pickupLng: position.coords.longitude.toString()
          }))
        },
        (error) => {
          console.error('Error getting location:', error)
        }
      )
    }
  }

  return (
    <div className={`${isTelegram ? 'p-4' : 'max-w-2xl mx-auto'}`}>
      <h2 className="text-3xl font-bold mb-6 text-center">
        Створити заявку
      </h2>

      <form onSubmit={handleSubmit} className="space-y-6">
        {/* Client Information */}
        <div className="bg-white p-6 rounded-lg shadow">
          <h3 className="text-lg font-semibold mb-4">Інформація про клієнта</h3>
          
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <input
              type="text"
              placeholder="Ім'я та прізвище"
              value={formData.clientName}
              onChange={(e) => setFormData(prev => ({...prev, clientName: e.target.value}))}
              className="w-full p-3 border border-gray-300 rounded-md focus:ring-2 focus:ring-primary-500 focus:border-transparent"
              required
            />
            
            <input
              type="tel"
              placeholder="Телефон (+380...)"
              value={formData.clientPhone}
              onChange={(e) => setFormData(prev => ({...prev, clientPhone: e.target.value}))}
              className="w-full p-3 border border-gray-300 rounded-md focus:ring-2 focus:ring-primary-500 focus:border-transparent"
              required
            />
            
            <input
              type="email"
              placeholder="Email (опціонально)"
              value={formData.clientEmail}
              onChange={(e) => setFormData(prev => ({...prev, clientEmail: e.target.value}))}
              className="w-full p-3 border border-gray-300 rounded-md focus:ring-2 focus:ring-primary-500 focus:border-transparent md:col-span-2"
            />
          </div>
        </div>

        {/* Vehicle Information */}
        <div className="bg-white p-6 rounded-lg shadow">
          <h3 className="text-lg font-semibold mb-4">Інформація про автомобіль</h3>
          
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <input
              type="text"
              placeholder="Номерний знак (AA1234BB)"
              value={formData.vehiclePlate}
              onChange={(e) => setFormData(prev => ({...prev, vehiclePlate: e.target.value}))}
              className="w-full p-3 border border-gray-300 rounded-md focus:ring-2 focus:ring-primary-500 focus:border-transparent"
              required
            />
            
            <input
              type="text"
              placeholder="VIN (опціонально)"
              value={formData.vehicleVin}
              onChange={(e) => setFormData(prev => ({...prev, vehicleVin: e.target.value}))}
              className="w-full p-3 border border-gray-300 rounded-md focus:ring-2 focus:ring-primary-500 focus:border-transparent"
            />
            
            <input
              type="text"
              placeholder="Марка (BMW, Mercedes, тощо)"
              value={formData.vehicleMake}
              onChange={(e) => setFormData(prev => ({...prev, vehicleMake: e.target.value}))}
              className="w-full p-3 border border-gray-300 rounded-md focus:ring-2 focus:ring-primary-500 focus:border-transparent"
            />
            
            <input
              type="text"
              placeholder="Модель"
              value={formData.vehicleModel}
              onChange={(e) => setFormData(prev => ({...prev, vehicleModel: e.target.value}))}
              className="w-full p-3 border border-gray-300 rounded-md focus:ring-2 focus:ring-primary-500 focus:border-transparent"
            />
            
            <input
              type="number"
              placeholder="Рік випуску"
              value={formData.vehicleYear}
              onChange={(e) => setFormData(prev => ({...prev, vehicleYear: e.target.value}))}
              className="w-full p-3 border border-gray-300 rounded-md focus:ring-2 focus:ring-primary-500 focus:border-transparent"
              min="1990"
              max="2024"
            />
          </div>
        </div>

        {/* Problem Information */}
        <div className="bg-white p-6 rounded-lg shadow">
          <h3 className="text-lg font-semibold mb-4">Опис проблеми</h3>
          
          <select
            value={formData.category}
            onChange={(e) => setFormData(prev => ({...prev, category: e.target.value}))}
            className="w-full p-3 mb-4 border border-gray-300 rounded-md focus:ring-2 focus:ring-primary-500 focus:border-transparent"
            required
          >
            <option value="engine">Двигун</option>
            <option value="transmission">Трансмісія</option>
            <option value="suspension">Підвіска</option>
            <option value="electrical">Електрика</option>
            <option value="brakes">Гальма</option>
            <option value="other">Інше</option>
          </select>
          
          <textarea
            placeholder="Детальний опис проблеми..."
            value={formData.description}
            onChange={(e) => setFormData(prev => ({...prev, description: e.target.value}))}
            className="w-full p-3 border border-gray-300 rounded-md focus:ring-2 focus:ring-primary-500 focus:border-transparent"
            rows={4}
          />
        </div>

        {/* Location Information */}
        <div className="bg-white p-6 rounded-lg shadow">
          <h3 className="text-lg font-semibold mb-4">Місцезнаходження</h3>
          
          <div className="grid grid-cols-2 gap-4 mb-4">
            <input
              type="number"
              step="any"
              placeholder="Широта"
              value={formData.pickupLat}
              onChange={(e) => setFormData(prev => ({...prev, pickupLat: e.target.value}))}
              className="w-full p-3 border border-gray-300 rounded-md focus:ring-2 focus:ring-primary-500 focus:border-transparent"
            />
            
            <input
              type="number"
              step="any"
              placeholder="Довгота"
              value={formData.pickupLng}
              onChange={(e) => setFormData(prev => ({...prev, pickupLng: e.target.value}))}
              className="w-full p-3 border border-gray-300 rounded-md focus:ring-2 focus:ring-primary-500 focus:border-transparent"
            />
          </div>
          
          <input
            type="text"
            placeholder="Адреса"
            value={formData.pickupAddress}
            onChange={(e) => setFormData(prev => ({...prev, pickupAddress: e.target.value}))}
            className="w-full p-3 mb-4 border border-gray-300 rounded-md focus:ring-2 focus:ring-primary-500 focus:border-transparent"
          />
          
          <button
            type="button"
            onClick={getCurrentLocation}
            className="w-full bg-gray-100 text-gray-700 py-2 px-4 rounded-md hover:bg-gray-200 transition-colors"
          >
            📍 Отримати поточне місцезнаходження
          </button>
        </div>

        {/* Submit Result */}
        {submitResult && (
          <div className={`p-4 rounded-lg ${
            submitResult.success 
              ? 'bg-green-100 text-green-800 border border-green-200' 
              : 'bg-red-100 text-red-800 border border-red-200'
          }`}>
            {submitResult.message}
          </div>
        )}

        {/* Submit Button */}
        <button
          type="submit"
          disabled={isSubmitting}
          className="w-full bg-primary-600 text-white py-3 px-6 rounded-md hover:bg-primary-700 disabled:bg-gray-400 disabled:cursor-not-allowed transition-colors font-semibold"
        >
          {isSubmitting ? 'Створення заявки...' : 'Створити заявку'}
        </button>
      </form>
    </div>
  )
}

export default OrderForm