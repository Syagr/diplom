import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import axios from 'axios'
import UploadAttachment from '../components/UploadAttachment'
import auth from '../utils/auth'

type EstimateItem = {
  name?: string
  title?: string
  partNo?: string
  amount?: number
  price?: number
  total?: number
  unitPrice?: number
  qty?: number
  quantity?: number
}

type LaborLine = {
  name?: string
  hours?: number
  rate?: number
  total?: number
}

function normalizeError(e: any, fallback: string) {
  const msg = e?.response?.data?.error?.message || e?.response?.data?.message || e?.message || fallback
  if (/not[_ ]?found/i.test(String(msg))) return 'Not found.'
  return String(msg)
}

function formatStatus(status?: string) {
  if (!status) return '-'
  const map: Record<string, string> = {
    NEW: 'New',
    TRIAGE: 'Triage',
    QUOTE: 'Estimate ready',
    APPROVED: 'Approved',
    SCHEDULED: 'Scheduled',
    INSERVICE: 'In service',
    READY: 'Ready',
    DELIVERED: 'Delivered',
    CLOSED: 'Closed',
    CANCELLED: 'Cancelled',
  }
  return map[status] || status
}

function pickEstimateItems(estimate: any): EstimateItem[] {
  if (!estimate) return []
  const items = estimate.itemsJson?.items || estimate.itemsJson?.parts || estimate.items || []
  if (!Array.isArray(items)) return []
  return items
}

function pickLaborLines(estimate: any): LaborLine[] {
  if (!estimate) return []
  const lines = estimate.laborJson?.lines || estimate.laborJson?.tasks || []
  if (!Array.isArray(lines)) return []
  return lines
}

export default function OrderDetails() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const [order, setOrder] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [timeline, setTimeline] = useState<any[]>([])
  const [attachments, setAttachments] = useState<any[]>([])
  const [attachmentsLoading, setAttachmentsLoading] = useState(false)
  const [centers, setCenters] = useState<any[]>([])
  const [centersLoading, setCentersLoading] = useState(false)
  const [receiptError, setReceiptError] = useState<string | null>(null)
  const [autoEstimateRequested, setAutoEstimateRequested] = useState(false)
  const [estimateAction, setEstimateAction] = useState<string | null>(null)
  const [estimateError, setEstimateError] = useState<string | null>(null)

  const fetchOrder = async () => {
    if (!id) return
    try {
      setLoading(true)
      const r = await axios.get(`/api/orders/${id}`)
      setOrder(r.data)
      if (Array.isArray(r.data?.timeline)) {
        setTimeline(r.data.timeline)
      } else {
        setTimeline([])
      }
    } catch (e: any) {
      setError(normalizeError(e, 'Failed to load order'))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchOrder()
  }, [id])

  useEffect(() => {
    if (!order?.locations) return
    const pickup = order.locations.find((l: any) => l.kind === 'pickup')
    if (!pickup || pickup.lat == null || pickup.lng == null) return
    let cancelled = false
    async function loadCenters() {
      try {
        setCentersLoading(true)
        const params = new URLSearchParams({
          lat: String(pickup.lat),
          lng: String(pickup.lng),
          limit: '10',
        }).toString()
        const res = await axios.get(`/api/service-centers/nearby?${params}`, { withCredentials: true })
        if (!cancelled) setCenters(res.data?.items || [])
      } catch {
        if (!cancelled) setCenters([])
      } finally {
        if (!cancelled) setCentersLoading(false)
      }
    }
    loadCenters()
    return () => { cancelled = true }
  }, [order])

  useEffect(() => {
    if (!id) return
    const loadAttachments = async () => {
      try {
        setAttachmentsLoading(true)
        const r = await axios.get(`/api/attachments/order/${id}`)
        setAttachments(r.data?.items || [])
      } catch {
        setAttachments([])
      } finally {
        setAttachmentsLoading(false)
      }
    }
    loadAttachments()
  }, [id])

  const payment = useMemo(() => {
    const list = Array.isArray(order?.payments) ? [...order.payments] : []
    list.sort((a, b) => new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime())
    return list[0] || null
  }, [order])

  const paymentCompleted = payment?.status === 'COMPLETED' || payment?.completed

  const estimate = order?.estimate ?? null
  const estimateMeta = estimate?.itemsJson?.meta || estimate?.laborJson?.meta || {}
  const estimateSummary = estimateMeta?.summary || null
  const estimateRecommendations = Array.isArray(estimateMeta?.recommendations) ? estimateMeta.recommendations : []
  const estimateFlags = estimateMeta?.flags || {}
  const pickupLocation = useMemo(() => {
    if (!order?.locations) return null
    return order.locations.find((l: any) => l.kind === 'pickup') || order.locations[0] || null
  }, [order])
  const estimateItems = useMemo(() => pickEstimateItems(estimate), [estimate])
  const laborLines = useMemo(() => pickLaborLines(estimate), [estimate])
  const estimateTotal = useMemo(() => {
    if (!estimate) return null
    const rawTotal = Number(estimate.total)
    if (Number.isFinite(rawTotal) && rawTotal > 0) return rawTotal
    const itemsSum = estimateItems.reduce((acc, it) => acc + Number(it.total ?? it.amount ?? it.price ?? it.unitPrice ?? 0), 0)
    const laborSum = laborLines.reduce((acc, it) => acc + Number(it.total ?? 0), 0)
    return itemsSum + laborSum
  }, [estimate, estimateItems, laborLines])

  const estimateCurrency = estimate?.currency || payment?.currency || 'UAH'
  const estimateApproved = Boolean(estimate?.approved)

  async function generateEstimate(mode: 'auto' | 'manual') {
    if (!order?.id) return
    setEstimateAction(mode === 'auto' ? 'auto' : 'generating')
    setEstimateError(null)
    try {
      const metaProfile = estimate?.itemsJson?.meta?.profile
      const profile = metaProfile || 'STANDARD'
      const urgent = order?.priority === 'urgent' || order?.priority === 'high'
      await axios.post('/api/estimates/auto', {
        orderId: order.id,
        profile,
        urgent,
      })
      await fetchOrder()
    } catch (e: any) {
      setEstimateError(normalizeError(e, 'Failed to generate estimate'))
    } finally {
      setEstimateAction(null)
    }
  }

  useEffect(() => {
    if (!order || estimate || autoEstimateRequested) return
    setAutoEstimateRequested(true)
    generateEstimate('auto')
  }, [order, estimate, autoEstimateRequested])

  async function openReceipt() {
    if (!payment?.id) return
    setReceiptError(null)
    try {
      const url = `/api/receipts/${payment.id}/file`
      window.open(url, '_blank')
    } catch (e: any) {
      setReceiptError(e?.response?.data?.error?.message || 'Failed to open receipt')
    }
  }

  async function openAttachment(att: any) {
    const url = `/api/attachments/${att.id}/file`
    try {
      window.open(url, '_blank')
    } catch {
      // ignore
    }
  }

  async function approveEstimate() {
    if (!estimate?.id) return
    setEstimateAction('approving')
    setEstimateError(null)
    try {
      await axios.post(`/api/estimates/${estimate.id}/approve`)
      await fetchOrder()
    } catch (e: any) {
      setEstimateError(normalizeError(e, 'Failed to approve estimate'))
    } finally {
      setEstimateAction(null)
    }
  }

  if (loading) return <div>Loading...</div>
  if (error) return <div className="text-red-600">{error}</div>
  if (!order) return <div>Order not found.</div>

  return (
    <div className="max-w-4xl mx-auto bg-white p-6 rounded shadow space-y-6">
      <div>
        <h2 className="text-2xl font-bold">Order #{order.id}</h2>
        <div className="text-sm text-gray-600">Status: {formatStatus(order.status)}</div>
        {order.priority && <div className="text-sm text-gray-600">Priority: {order.priority}</div>}
      </div>

      <div>
        <h3 className="font-semibold">Issue</h3>
        <div className="text-gray-700">{order.description || '-'}</div>
      </div>

      {timeline.length > 0 && (
        <div>
          <h3 className="font-semibold">Timeline</h3>
          <ul className="mt-2 space-y-1">
            {timeline.map((ev: any, idx: number) => (
              <li key={ev.id || idx} className="text-sm text-gray-700">
                <span className="text-gray-500 mr-2">
                  {ev.createdAt ? new Date(ev.createdAt).toLocaleString() : ''}
                </span>
                <span className="font-medium">{ev.event || ev.type || ev.status || 'event'}</span>
                {ev.note && <span className="ml-2">- {ev.note}</span>}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <h3 className="font-semibold">Client</h3>
          <div>{order.client?.name} | {order.client?.phone}</div>
          {order.client?.email && <div className="text-sm text-gray-600">{order.client.email}</div>}
        </div>
        <div>
          <h3 className="font-semibold">Vehicle</h3>
          <div>{order.vehicle?.make} {order.vehicle?.model} | {order.vehicle?.plate}</div>
          {order.vehicle?.year && <div className="text-sm text-gray-600">Year: {order.vehicle.year}</div>}
        </div>
      </div>

      <div>
        <h3 className="font-semibold">Locations</h3>
        <ul className="text-sm text-gray-700">
          {(order.locations || []).map((l: any) => {
            const kindLabel = l.kind === 'pickup' ? 'Pickup' : l.kind === 'dropoff' ? 'Dropoff' : l.kind
            return (
              <li key={l.id}>
                <strong>{kindLabel}:</strong> {l.address || `${l.lat}, ${l.lng}`}
              </li>
            )
          })}
        </ul>
      </div>

      <div>
        <h3 className="font-semibold">Nearby service centers</h3>
        {centersLoading ? (
          <div className="text-sm text-gray-600">Loading nearby centers...</div>
        ) : centers.length === 0 ? (
          <div className="text-sm text-gray-600">No centers found nearby.</div>
        ) : (
          <ul className="text-sm text-gray-700 space-y-1">
            {centers.map((c: any) => (
              <li key={c.id}>
                <strong>{c.name}</strong>{c.distanceKm != null ? ` - ${Number(c.distanceKm).toFixed(1)} km` : ''}
                {c.address ? <span className="text-gray-600"> ({c.address})</span> : null}
              </li>
            ))}
          </ul>
        )}
        {order?.serviceCenter && (
          <div className="text-xs text-gray-600 mt-2">
            Assigned center: {order.serviceCenter.name}
            {order.serviceCenter.address ? ` (${order.serviceCenter.address})` : ''}
          </div>
        )}
        {pickupLocation && order?.serviceCenter && (
          <div className="text-xs text-gray-500 mt-1">
            <a
              className="text-primary-600 hover:underline"
              target="_blank"
              rel="noreferrer"
              href={`https://www.google.com/maps/dir/?api=1&origin=${pickupLocation.lat},${pickupLocation.lng}&destination=${order.serviceCenter.lat},${order.serviceCenter.lng}`}
            >
              Open directions in Google Maps
            </a>
          </div>
        )}
      </div>

      <div>
        <h3 className="font-semibold">Estimate</h3>
        {estimate ? (
          <div className="text-sm text-gray-700 space-y-2">
            <div>Approval: {estimateApproved ? 'Approved' : 'Pending'}</div>
            {estimateSummary && <div>Summary: {estimateSummary}</div>}
            {estimateRecommendations.length > 0 && (
              <div>
                <div className="font-medium">Recommendations</div>
                <ul className="list-disc pl-5">
                  {estimateRecommendations.map((rec: string, i: number) => (
                    <li key={i}>{rec}</li>
                  ))}
                </ul>
              </div>
            )}
            {estimateMeta?.profile && <div>Calc profile: {estimateMeta.profile}</div>}
            {(estimateMeta?.coeffParts || estimateMeta?.coeffLabor) && (
              <div>
                Coefficients: parts x{Number(estimateMeta.coeffParts || 1).toFixed(2)}, labor x{Number(estimateMeta.coeffLabor || 1).toFixed(2)}
              </div>
            )}
            {(estimateFlags?.night || estimateFlags?.urgent || estimateFlags?.suv) && (
              <div>
                Applied modifiers:
                {estimateFlags.night ? ' night' : ''}
                {estimateFlags.urgent ? ' urgent' : ''}
                {estimateFlags.suv ? ' suv' : ''}
              </div>
            )}
            {(estimateMeta?.cat || estimateMeta?.baseParts || estimateMeta?.baseLaborHours || estimateMeta?.laborRate) && (
              <div>
                Pricing basis: {estimateMeta.cat ? `category ${estimateMeta.cat}` : 'category n/a'}
                {estimateMeta.baseParts ? `, base parts ${estimateMeta.baseParts}` : ''}
                {estimateMeta.baseLaborHours ? `, base labor ${estimateMeta.baseLaborHours}h` : ''}
                {estimateMeta.laborRate ? `, labor rate ${estimateMeta.laborRate}` : ''}
              </div>
            )}
            {estimateItems.length > 0 && (
              <div>
                <div className="font-medium">Items</div>
                <ul className="list-disc pl-5">
                  {estimateItems.map((it, i) => (
                    <li key={i}>
                      {it.title || it.name || it.partNo || 'Item'}
                      {it.qty || it.quantity ? ` x${it.qty ?? it.quantity}` : ''} - {it.total ?? it.amount ?? it.price ?? it.unitPrice ?? 0}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {laborLines.length > 0 && (
              <div>
                <div className="font-medium">Labor</div>
                <ul className="list-disc pl-5">
                  {laborLines.map((it, i) => (
                    <li key={i}>
                      {it.name || 'Labor'} - {it.hours ?? 0}h x {it.rate ?? 0} = {it.total ?? 0}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            <div className="font-medium">
              Total: {estimateTotal != null ? estimateTotal.toFixed(2) : '-'} {estimateCurrency}
            </div>
            {estimateTotal != null && estimateTotal <= 0 && (
              <div className="text-xs text-red-600">
                Estimate total is 0. Recalculate to proceed with payment.
              </div>
            )}
            <div className="flex items-center gap-2">
              <button
                className="px-3 py-1 border rounded"
                onClick={() => generateEstimate('manual')}
                disabled={estimateAction === 'generating'}
              >
                {estimateAction === 'generating' ? 'Recalculating...' : 'Recalculate estimate'}
              </button>
              {estimateError && <div className="text-xs text-red-600">{estimateError}</div>}
            </div>
            {!estimateApproved && (
              <div className="flex items-center gap-2">
                <button
                  className="px-3 py-1 border rounded"
                  onClick={approveEstimate}
                  disabled={estimateAction === 'approving'}
                >
                  {estimateAction === 'approving' ? 'Approving...' : 'Approve estimate'}
                </button>
              </div>
            )}
          </div>
        ) : (
          <div className="text-sm text-gray-600">
            Estimate is being prepared.
            {estimateAction === 'auto' && <span className="ml-2">Auto-calculating...</span>}
            {estimateError && <div className="text-xs text-red-600 mt-1">{estimateError}</div>}
            <div className="mt-2">
              <button
                className="px-3 py-1 border rounded"
                onClick={() => generateEstimate('manual')}
                disabled={estimateAction === 'generating'}
              >
                {estimateAction === 'generating' ? 'Calculating...' : 'Generate estimate now'}
              </button>
            </div>
          </div>
        )}
      </div>

      <div>
        <h3 className="font-semibold">Payment</h3>
        {payment ? (
          <div className="text-sm text-gray-700">
            <div>Status: {payment.status || 'PENDING'}</div>
            {payment.invoiceUrl && (
              <a className="text-primary-600 hover:underline" href={payment.invoiceUrl} target="_blank" rel="noreferrer">
                Open invoice
              </a>
            )}
            {paymentCompleted && (
              <div className="mt-2">
                <button className="px-3 py-1 border rounded" onClick={openReceipt}>
                  Open receipt
                </button>
                {receiptError && <div className="text-xs text-red-600 mt-1">{receiptError}</div>}
              </div>
            )}
          </div>
        ) : (
          <div className="text-sm text-gray-600">Payment is not initiated yet.</div>
        )}

        {estimate && estimateApproved && !paymentCompleted && (
          <div className="mt-3">
            <button className="px-3 py-1 bg-primary-600 text-white rounded" onClick={() => navigate(`/payments/${order.id}`)}>
              Proceed to payment
            </button>
          </div>
        )}
        {estimate && !estimateApproved && (
          <div className="mt-2 text-xs text-gray-500">Approve the estimate to unlock payment.</div>
        )}
      </div>

      <div>
        <h3 className="font-semibold">Attachments</h3>
        <div className="mt-2">
          <UploadAttachment token={auth.getToken() || undefined} orderId={order.id} onUploaded={() => {
            axios.get(`/api/attachments/order/${order.id}`).then(r => setAttachments(r.data?.items || [])).catch(() => {})
          }} />
        </div>
        <div className="mt-3">
          {attachmentsLoading ? (
            <div className="text-sm text-gray-600">Loading...</div>
          ) : attachments.length === 0 ? (
            <div className="text-sm text-gray-600">No attachments.</div>
          ) : (
            <ul className="space-y-2">
              {attachments.map((att: any) => {
                const fileUrl = `/api/attachments/${att.id}/file`
                const isImage = String(att.contentType || '').startsWith('image/')
                return (
                  <li key={att.id} className="border rounded p-2">
                    <div className="flex items-center justify-between">
                      <button className="text-primary-600 hover:underline" onClick={() => openAttachment(att)}>
                        {att.filename || `Attachment #${att.id}`}
                      </button>
                      <span className="text-xs text-gray-500">{att.contentType || ''}</span>
                    </div>
                    {isImage && (
                      <img className="mt-2 max-h-48 rounded border" src={fileUrl} alt={att.filename || `attachment-${att.id}`} />
                    )}
                  </li>
                )
              })}
            </ul>
          )}
        </div>
      </div>

      {(order?.status === 'DELIVERED' || order?.status === 'CLOSED' || order?.proofHash) && (
        <div>
          <button className="px-3 py-1 border rounded" onClick={() => navigate(`/orders/${order.id}/proof`)}>
            Open proof
          </button>
        </div>
      )}
    </div>
  )
}
