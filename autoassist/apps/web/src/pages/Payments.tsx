import { useEffect, useMemo, useState } from 'react'
import { useParams } from 'react-router-dom'
import axios from 'axios'

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

export default function PaymentPage() {
  const { orderId } = useParams<{ orderId: string }>()
  const [order, setOrder] = useState<any>(null)
  const [txHash, setTxHash] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [paymentId, setPaymentId] = useState<number | null>(null)
  const [creating, setCreating] = useState(false)
  const [completing, setCompleting] = useState(false)
  const [paymentStatus, setPaymentStatus] = useState<string | null>(null)
  const [autoEstimateRequested, setAutoEstimateRequested] = useState(false)
  const [estimateAction, setEstimateAction] = useState<string | null>(null)

  const loadOrder = async () => {
    if (!orderId) return
    try {
      const r = await axios.get(`/api/orders/${orderId}`)
      setOrder(r.data)
    } catch (e: any) {
      setError(e?.response?.data?.error?.message || 'Failed to load order')
    }
  }

  useEffect(() => {
    loadOrder()
  }, [orderId])

  const estimate = order?.estimate ?? null
  const estimateMeta = estimate?.itemsJson?.meta || estimate?.laborJson?.meta || {}
  const estimateSummary = estimateMeta?.summary || null
  const estimateRecommendations = Array.isArray(estimateMeta?.recommendations) ? estimateMeta.recommendations : []
  const estimateFlags = estimateMeta?.flags || {}
  const estimateItems = useMemo(() => pickEstimateItems(estimate), [estimate])
  const laborLines = useMemo(() => pickLaborLines(estimate), [estimate])

  const total = useMemo(() => {
    if (!estimate) return 0
    const rawTotal = Number(estimate.total)
    if (Number.isFinite(rawTotal) && rawTotal > 0) return rawTotal
    const itemsSum = estimateItems.reduce((acc, it) => acc + Number(it.total ?? it.amount ?? it.price ?? it.unitPrice ?? 0), 0)
    const laborSum = laborLines.reduce((acc, it) => acc + Number(it.total ?? 0), 0)
    return itemsSum + laborSum
  }, [estimate, estimateItems, laborLines])

  const currency = estimate?.currency || 'UAH'
  const estimateApproved = Boolean(estimate?.approved)

  const latestPayment = useMemo(() => {
    const list = Array.isArray(order?.payments) ? [...order.payments] : []
    list.sort((a, b) => new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime())
    return list[0] || null
  }, [order])

  useEffect(() => {
    if (!latestPayment) return
    setPaymentId(latestPayment.id)
    setPaymentStatus(latestPayment.status || null)
  }, [latestPayment])

  async function generateEstimate(mode: 'auto' | 'manual') {
    if (!order?.id) return
    setEstimateAction(mode === 'auto' ? 'auto' : 'generating')
    setError(null)
    try {
      const metaProfile = estimate?.itemsJson?.meta?.profile
      const profile = metaProfile || 'STANDARD'
      const urgent = order?.priority === 'urgent' || order?.priority === 'high'
      await axios.post('/api/estimates/auto', {
        orderId: order.id,
        profile,
        urgent,
      })
      await loadOrder()
    } catch (e: any) {
      setError(e?.response?.data?.error?.message || 'Failed to generate estimate')
    } finally {
      setEstimateAction(null)
    }
  }

  useEffect(() => {
    if (!order) return
    if (estimate && total > 0) return
    if (autoEstimateRequested) return
    setAutoEstimateRequested(true)
    generateEstimate('auto')
  }, [order, estimate, total, autoEstimateRequested])

  async function approveEstimate() {
    if (!estimate?.id) return
    setEstimateAction('approving')
    setError(null)
    try {
      await axios.post(`/api/estimates/${estimate.id}/approve`)
      await loadOrder()
    } catch (e: any) {
      setError(e?.response?.data?.error?.message || 'Failed to approve estimate')
    } finally {
      setEstimateAction(null)
    }
  }

  async function initWeb3Payment() {
    if (!orderId || !estimateApproved) {
      setError('Approve the estimate before starting payment.')
      return
    }
    if (!total || total <= 0) {
      setError('Estimate total must be greater than 0. Recalculate the estimate first.')
      return
    }
    setCreating(true)
    setError(null)
    try {
      const r = await axios.post('/api/payments/demo/init', {
        orderId: Number(orderId),
        amount: total,
        currency,
      })
      const pid = r.data?.payment?.id || r.data?.id
      const status = r.data?.payment?.status || r.data?.status || 'PENDING'
      const demoHash = r.data?.demoTxHash
      if (pid) setPaymentId(Number(pid))
      setPaymentStatus(status)
      if (demoHash && !txHash) setTxHash(demoHash)
      setMessage('Payment initialized for Web3 verification.')
    } catch (e: any) {
      setError(e?.response?.data?.error?.message || 'Failed to initialize payment')
    } finally {
      setCreating(false)
    }
  }

  async function demoCompletePayment() {
    if (!orderId || !estimateApproved) {
      setError('Approve the estimate before completing payment.')
      return
    }
    if (!total || total <= 0) {
      setError('Estimate total must be greater than 0. Recalculate the estimate first.')
      return
    }
    setCompleting(true)
    setError(null)
    try {
      const r = await axios.post('/api/payments/demo/complete', {
        orderId: Number(orderId),
        amount: total,
        currency,
      })
      const pid = r.data?.payment?.id || r.data?.id
      const status = r.data?.payment?.status || 'COMPLETED'
      const receiptError = r.data?.receiptError
      if (pid) setPaymentId(Number(pid))
      setPaymentStatus(status)
      if (receiptError) {
        setError(`Payment completed, but receipt failed: ${receiptError}`)
      } else {
        setMessage('Payment completed.')
      }
      await openReceipt(pid)
    } catch (e: any) {
      setError(e?.response?.data?.error?.message || 'Failed to complete payment')
    } finally {
      setCompleting(false)
    }
  }

  async function openReceipt(pid?: number | null) {
    const id = pid || paymentId
    if (!id) return
    try {
      const url = `/api/receipts/${id}/file`
      window.open(url, '_blank')
    } catch (e: any) {
      setError(e?.response?.data?.error?.message || 'Failed to open receipt')
    }
  }

  async function verifyTx() {
    if (!orderId || !txHash) return
    if (!paymentId) {
      setError('Create a Web3 payment first.')
      return
    }
    setSubmitting(true)
    setError(null)
    setMessage(null)
    try {
      const r = await axios.post(`/api/payments/web3/verify`, {
        orderId: Number(orderId),
        paymentId: Number(paymentId),
        txHash,
      })
      const status = r.data?.payment?.status || r.data?.status || 'OK'
      setPaymentStatus(status)
      setMessage(`Verification status: ${status}`)
      await openReceipt(paymentId)
    } catch (e: any) {
      setError(e?.response?.data?.error?.message || 'Failed to verify transaction')
    } finally {
      setSubmitting(false)
    }
  }

  if (!order) {
    return (
      <div className="max-w-3xl mx-auto bg-white p-6 rounded shadow">
        {error ? <div className="text-red-600">{error}</div> : 'Loading...'}
      </div>
    )
  }

  return (
    <div className="max-w-3xl mx-auto bg-white p-6 rounded shadow">
      <h2 className="text-2xl font-bold mb-4">Payment for order #{orderId}</h2>
      {estimate ? (
        <div className="mb-4 space-y-2">
          <h3 className="font-semibold">Estimate</h3>
          <div>Approval: {estimateApproved ? 'Approved' : 'Pending'}</div>
          {estimateSummary && <div>Summary: {estimateSummary}</div>}
          {estimateRecommendations.length > 0 && (
            <ul className="list-disc pl-5 text-sm text-gray-700">
              {estimateRecommendations.map((rec: string, i: number) => (
                <li key={i}>{rec}</li>
              ))}
            </ul>
          )}
          {(estimateFlags?.night || estimateFlags?.urgent || estimateFlags?.suv) && (
            <div className="text-sm text-gray-600">
              Applied modifiers:
              {estimateFlags.night ? ' night' : ''}
              {estimateFlags.urgent ? ' urgent' : ''}
              {estimateFlags.suv ? ' suv' : ''}
            </div>
          )}
          {estimateItems.length > 0 && (
            <ul className="list-disc pl-5 text-sm text-gray-700">
              {estimateItems.map((it: any, i: number) => (
                <li key={i}>{it.title || it.name || it.partNo || 'Item'} - {it.total ?? it.amount ?? it.price ?? it.unitPrice ?? 0}</li>
              ))}
            </ul>
          )}
          {laborLines.length > 0 && (
            <ul className="list-disc pl-5 text-sm text-gray-700">
              {laborLines.map((it: any, i: number) => (
                <li key={i}>{it.name || 'Labor'} - {it.hours ?? 0}h x {it.rate ?? 0} = {it.total ?? 0}</li>
              ))}
            </ul>
          )}
          <div className="font-medium">Total: {total.toFixed(2)} {currency}</div>
          {total <= 0 && (
            <div className="text-xs text-red-600">Estimate total is 0. Recalculate before payment.</div>
          )}
          <div className="flex items-center gap-2">
            <button
              onClick={() => generateEstimate('manual')}
              disabled={estimateAction === 'generating'}
              className="px-3 py-1 border rounded"
            >
              {estimateAction === 'generating' ? 'Recalculating...' : 'Recalculate estimate'}
            </button>
          </div>
          {!estimateApproved && (
            <button
              onClick={approveEstimate}
              disabled={estimateAction === 'approving'}
              className="px-3 py-1 border rounded"
            >
              {estimateAction === 'approving' ? 'Approving...' : 'Approve estimate'}
            </button>
          )}
        </div>
      ) : (
        <div className="mb-4 text-gray-600">
          Estimate is being prepared. Payment unlocks after approval.
          {estimateAction === 'auto' && <span className="ml-2">Auto-calculating...</span>}
          <div className="mt-2">
            <button
              onClick={() => generateEstimate('manual')}
              disabled={estimateAction === 'generating'}
              className="px-3 py-1 border rounded"
            >
              {estimateAction === 'generating' ? 'Calculating...' : 'Generate estimate now'}
            </button>
          </div>
        </div>
      )}

      <div className="mb-6">
        <h3 className="font-semibold mb-2">Classic payment (demo)</h3>
        <div className="text-sm text-gray-600 mb-2">Simulates payment completion for demo.</div>
        <button
          onClick={demoCompletePayment}
          disabled={completing || !estimateApproved}
          className="px-3 py-1 bg-primary-600 text-white rounded disabled:opacity-60"
        >
          {completing ? 'Processing...' : 'Complete payment'}
        </button>
      </div>

      <div className="mt-6">
        <h3 className="font-semibold mb-2">Web3 payment (Polygon Amoy)</h3>
        <div className="text-xs text-gray-500 mb-2">
          Send a transaction in MetaMask and verify using txHash.
        </div>
        <div className="flex flex-wrap gap-2 mb-2">
          <button
            onClick={initWeb3Payment}
            disabled={creating || !estimateApproved}
            className="px-3 py-1 border rounded disabled:opacity-60"
          >
            {creating ? 'Initializing...' : 'Init Web3 payment'}
          </button>
          {paymentStatus && <div className="text-xs text-gray-600">Status: {paymentStatus}</div>}
        </div>
        <div className="flex gap-2 items-center">
          <input
            className="border px-2 py-1 rounded w-full"
            placeholder="Paste txHash..."
            value={txHash}
            onChange={e => setTxHash(e.target.value)}
          />
          <button onClick={verifyTx} disabled={submitting || !txHash} className="px-3 py-1 bg-primary-600 text-white rounded disabled:opacity-60">
            Verify
          </button>
        </div>
      </div>

      {message && <div className="mt-2 text-green-700 text-sm">{message}</div>}
      {error && <div className="mt-2 text-red-700 text-sm">{error}</div>}

      {paymentStatus === 'COMPLETED' && (
        <div className="mt-4">
          <button className="px-3 py-1 border rounded" onClick={() => openReceipt()}>
            Open receipt
          </button>
        </div>
      )}
    </div>
  )
}
