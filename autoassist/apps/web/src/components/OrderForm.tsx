import React, { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import axios from 'axios'
import UploadAttachment from './UploadAttachment'
import auth from '../utils/auth'

interface OrderFormProps {}

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
  priority: string
  pickupLat: string
  pickupLng: string
  pickupAddress: string
}

const API_URL = (import.meta as any).env?.VITE_API_URL || ''

function OrderForm({}: OrderFormProps) {
  const navigate = useNavigate()
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
    priority: 'normal',
    pickupLat: '',
    pickupLng: '',
    pickupAddress: ''
  })

  const [isSubmitting, setIsSubmitting] = useState(false)
  const [submitResult, setSubmitResult] = useState<{ success: boolean; message: string } | null>(null)
  const [createdOrderId, setCreatedOrderId] = useState<number | null>(null)
  const [formError, setFormError] = useState<string | null>(null)
  const maxYear = new Date().getFullYear() + 1
  const minDescriptionLength = 10

  const validateForm = () => {
    if (!formData.clientName.trim()) return 'Client name is required.'
    if (!formData.clientPhone.trim()) return 'Client phone is required.'
    if (formData.clientPhone.trim().length < 6) return 'Phone number looks too short.'
    if (!formData.vehiclePlate.trim()) return 'Vehicle plate is required.'
    if (!formData.description.trim() || formData.description.trim().length < minDescriptionLength) {
      return `Describe the issue in at least ${minDescriptionLength} characters.`
    }
    const hasLat = Boolean(formData.pickupLat)
    const hasLng = Boolean(formData.pickupLng)
    if (hasLat !== hasLng) return 'Provide both latitude and longitude for pickup.'
    return null
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setFormError(null)
    setIsSubmitting(true)
    setSubmitResult(null)

    try {
      const validationMessage = validateForm()
      if (validationMessage) {
        setFormError(validationMessage)
        setIsSubmitting(false)
        return
      }

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
          year: formData.vehicleYear ? parseInt(formData.vehicleYear, 10) : undefined
        },
        category: formData.category,
        description: formData.description || undefined,
        priority: formData.priority || 'normal',
        channel: 'web',
        pickup: (formData.pickupLat && formData.pickupLng) ? {
          lat: parseFloat(formData.pickupLat),
          lng: parseFloat(formData.pickupLng),
          address: formData.pickupAddress || undefined
        } : undefined
      })

      const createdId = response.data?.orderId ?? response.data?.order?.id

      setSubmitResult({
        success: true,
        message: createdId
          ? `Order #${createdId} created successfully.`
          : 'Order created successfully.'
      })
      setCreatedOrderId(createdId ? Number(createdId) : null)

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
        priority: 'normal',
        pickupLat: '',
        pickupLng: '',
        pickupAddress: ''
      })
    } catch (error: any) {
      setSubmitResult({
        success: false,
        message:
          error.response?.data?.error?.message ||
          error.response?.data?.message ||
          error.message ||
          'Failed to create order.'
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
    <div className="max-w-2xl mx-auto">
      <h2 className="text-3xl font-bold mb-6 text-center">
        Create a new order
      </h2>

      <form onSubmit={handleSubmit} className="space-y-6">
        <div className="bg-white p-6 rounded-lg shadow">
          <h3 className="text-lg font-semibold mb-4">Client information</h3>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <input
              type="text"
              placeholder="Client name"
              value={formData.clientName}
              onChange={(e) => setFormData(prev => ({...prev, clientName: e.target.value}))}
              className="w-full p-3 border border-gray-300 rounded-md focus:ring-2 focus:ring-primary-500 focus:border-transparent"
              required
            />

            <input
              type="tel"
              placeholder="Phone (+380...)"
              value={formData.clientPhone}
              onChange={(e) => setFormData(prev => ({...prev, clientPhone: e.target.value}))}
              className="w-full p-3 border border-gray-300 rounded-md focus:ring-2 focus:ring-primary-500 focus:border-transparent"
              required
            />

            <input
              type="email"
              placeholder="Email (optional)"
              value={formData.clientEmail}
              onChange={(e) => setFormData(prev => ({...prev, clientEmail: e.target.value}))}
              className="w-full p-3 border border-gray-300 rounded-md focus:ring-2 focus:ring-primary-500 focus:border-transparent md:col-span-2"
            />
          </div>
        </div>

        <div className="bg-white p-6 rounded-lg shadow">
          <h3 className="text-lg font-semibold mb-4">Vehicle information</h3>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <input
              type="text"
              placeholder="Plate number (AA1234BB)"
              value={formData.vehiclePlate}
              onChange={(e) => setFormData(prev => ({...prev, vehiclePlate: e.target.value}))}
              className="w-full p-3 border border-gray-300 rounded-md focus:ring-2 focus:ring-primary-500 focus:border-transparent"
              required
            />

            <input
              type="text"
              placeholder="VIN (optional)"
              value={formData.vehicleVin}
              onChange={(e) => setFormData(prev => ({...prev, vehicleVin: e.target.value}))}
              className="w-full p-3 border border-gray-300 rounded-md focus:ring-2 focus:ring-primary-500 focus:border-transparent"
            />

            <input
              type="text"
              placeholder="Make (BMW, Mercedes)"
              value={formData.vehicleMake}
              onChange={(e) => setFormData(prev => ({...prev, vehicleMake: e.target.value}))}
              className="w-full p-3 border border-gray-300 rounded-md focus:ring-2 focus:ring-primary-500 focus:border-transparent"
            />

            <input
              type="text"
              placeholder="Model"
              value={formData.vehicleModel}
              onChange={(e) => setFormData(prev => ({...prev, vehicleModel: e.target.value}))}
              className="w-full p-3 border border-gray-300 rounded-md focus:ring-2 focus:ring-primary-500 focus:border-transparent"
            />

            <input
              type="number"
              placeholder="Year"
              value={formData.vehicleYear}
              onChange={(e) => setFormData(prev => ({...prev, vehicleYear: e.target.value}))}
              className="w-full p-3 border border-gray-300 rounded-md focus:ring-2 focus:ring-primary-500 focus:border-transparent"
              min="1990"
              max={maxYear}
            />
          </div>
        </div>

        <div className="bg-white p-6 rounded-lg shadow">
          <h3 className="text-lg font-semibold mb-4">Issue details</h3>

          <select
            value={formData.category}
            onChange={(e) => setFormData(prev => ({...prev, category: e.target.value}))}
            className="w-full p-3 mb-4 border border-gray-300 rounded-md focus:ring-2 focus:ring-primary-500 focus:border-transparent"
            required
          >
            <option value="engine">Engine</option>
            <option value="transmission">Transmission</option>
            <option value="suspension">Suspension</option>
            <option value="electrical">Electrical</option>
            <option value="brakes">Brakes</option>
            <option value="other">Other</option>
          </select>

          <select
            value={formData.priority}
            onChange={(e) => setFormData(prev => ({...prev, priority: e.target.value}))}
            className="w-full p-3 mb-4 border border-gray-300 rounded-md focus:ring-2 focus:ring-primary-500 focus:border-transparent"
          >
            <option value="low">Low priority</option>
            <option value="normal">Normal priority</option>
            <option value="high">High priority</option>
            <option value="urgent">Urgent priority</option>
          </select>

          <textarea
            placeholder="Describe the issue in detail..."
            value={formData.description}
            onChange={(e) => setFormData(prev => ({...prev, description: e.target.value}))}
            className="w-full p-3 border border-gray-300 rounded-md focus:ring-2 focus:ring-primary-500 focus:border-transparent"
            rows={4}
            minLength={minDescriptionLength}
            required
          />
        </div>

        <div className="bg-white p-6 rounded-lg shadow">
          <h3 className="text-lg font-semibold mb-4">Pickup location</h3>

          <div className="grid grid-cols-2 gap-4 mb-4">
            <input
              type="number"
              step="any"
              placeholder="Latitude"
              value={formData.pickupLat}
              onChange={(e) => setFormData(prev => ({...prev, pickupLat: e.target.value}))}
              className="w-full p-3 border border-gray-300 rounded-md focus:ring-2 focus:ring-primary-500 focus:border-transparent"
            />

            <input
              type="number"
              step="any"
              placeholder="Longitude"
              value={formData.pickupLng}
              onChange={(e) => setFormData(prev => ({...prev, pickupLng: e.target.value}))}
              className="w-full p-3 border border-gray-300 rounded-md focus:ring-2 focus:ring-primary-500 focus:border-transparent"
            />
          </div>

          <input
            type="text"
            placeholder="Address (optional)"
            value={formData.pickupAddress}
            onChange={(e) => setFormData(prev => ({...prev, pickupAddress: e.target.value}))}
            className="w-full p-3 mb-4 border border-gray-300 rounded-md focus:ring-2 focus:ring-primary-500 focus:border-transparent"
          />

          <button
            type="button"
            onClick={getCurrentLocation}
            className="w-full bg-gray-100 text-gray-700 py-2 px-4 rounded-md hover:bg-gray-200 transition-colors"
          >
            Use current location
          </button>
        </div>

        {formError && (
          <div className="p-3 rounded-lg bg-red-100 text-red-800 border border-red-200">
            {formError}
          </div>
        )}

        {submitResult && (
          <div className={`p-4 rounded-lg ${
            submitResult.success
              ? 'bg-green-100 text-green-800 border border-green-200'
              : 'bg-red-100 text-red-800 border border-red-200'
          }`}>
            <div>{submitResult.message}</div>
            {submitResult.success && createdOrderId && (
              <div className="mt-2">
                <button
                  type="button"
                  className="px-3 py-1 border rounded text-green-800 hover:bg-green-50"
                  onClick={() => navigate(`/orders/${createdOrderId}`)}
                >
                  Open order
                </button>
              </div>
            )}
          </div>
        )}

        {createdOrderId && (
          <div className="bg-white p-6 rounded-lg shadow">
            <h3 className="text-lg font-semibold mb-2">Attachments</h3>
            <p className="text-sm text-gray-600 mb-3">Add photos or documents to the order.</p>
            <UploadAttachment token={auth.getToken() || undefined} orderId={createdOrderId} onUploaded={() => {}} />
          </div>
        )}

        <button
          type="submit"
          disabled={isSubmitting}
          className="w-full bg-primary-600 text-white py-3 px-6 rounded-md hover:bg-primary-700 disabled:bg-gray-400 disabled:cursor-not-allowed transition-colors font-semibold"
        >
          {isSubmitting ? 'Creating order...' : 'Create order'}
        </button>
      </form>
    </div>
  )
}

export default OrderForm
