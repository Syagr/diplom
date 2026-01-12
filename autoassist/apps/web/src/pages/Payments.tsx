import { useEffect, useMemo, useState } from 'react'
import { useParams } from 'react-router-dom'
import axios from 'axios'
import { useAuth } from '../shared/hooks/useAuth'

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
  const { role } = useAuth()
  const [order, setOrder] = useState<any>(null)
  const [txHash, setTxHash] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [paymentId, setPaymentId] = useState<number | null>(null)
  const [creating, setCreating] = useState(false)
  const [completing, setCompleting] = useState(false)
  const [paymentStatus, setPaymentStatus] = useState<string | null>(null)
  const [estimateAction, setEstimateAction] = useState<string | null>(null)
  const [showCardModal, setShowCardModal] = useState(false)
  const [web3Step, setWeb3Step] = useState<'idle' | 'initialized' | 'confirmed'>('idle')
  const [selectedCardId, setSelectedCardId] = useState('visa-demo')

  const demoCards = useMemo(
    () => [
      {
        id: 'visa-demo',
        label: 'Visa •••• 4242 (demo)',
        holder: 'Pavlo Syahrovski',
        number: '4242 4242 4242 4242',
        expiry: '12/29',
        cvc: '123',
        bank: 'AutoAssist Bank',
      },
      {
        id: 'mc-demo',
        label: 'Mastercard •••• 4444 (demo)',
        holder: 'Olena Kovalenko',
        number: '5555 4444 3333 2222',
        expiry: '08/28',
        cvc: '456',
        bank: 'KyivPay',
      },
    ],
    []
  )
  const activeCard = demoCards.find((c) => c.id === selectedCardId) || demoCards[0]

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
  const payments = Array.isArray(order?.payments) ? order.payments : []
  const hasPayments = payments.length > 0
  const isStaff = ['admin', 'service_manager', 'dispatcher', 'manager'].includes(String(role || '').toLowerCase())

  const latestPayment = useMemo(() => {
    const list = [...payments]
    list.sort((a, b) => new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime())
    return list[0] || null
  }, [payments])

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
    setCreating(true)
    setError(null)
    try {
      const r = await axios.post('/api/payments/demo/init', {
        orderId: Number(orderId),
      })
      const pid = r.data?.payment?.id || r.data?.id
      const status = r.data?.payment?.status || r.data?.status || 'PENDING'
      const demoHash = r.data?.demoTxHash
      if (pid) setPaymentId(Number(pid))
      setPaymentStatus(status)
      if (demoHash) setTxHash(demoHash)
      setWeb3Step('initialized')
      setMessage('Web3 payment initialized. Confirm to complete.')
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
    setCompleting(true)
    setError(null)
    try {
      const r = await axios.post('/api/payments/demo/complete', { orderId: Number(orderId) })
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
      const res = await axios.get(`/api/receipts/${id}/file`, { responseType: 'blob' })
      const blobUrl = URL.createObjectURL(res.data)
      window.open(blobUrl, '_blank')
      setTimeout(() => URL.revokeObjectURL(blobUrl), 60_000)
    } catch (e: any) {
      setError(e?.response?.data?.error?.message || 'Failed to open receipt')
    }
  }

  async function confirmWeb3Payment() {
    if (!orderId || !paymentId || !txHash) return
    setSubmitting(true)
    setError(null)
    setMessage(null)
    try {
      const r = await axios.post('/api/payments/demo/web3/confirm', {
        orderId: Number(orderId),
        paymentId: Number(paymentId),
        txHash,
      })
      const status = r.data?.payment?.status || r.data?.status || 'COMPLETED'
      const receiptError = r.data?.receiptError
      setPaymentStatus(status)
      setWeb3Step('confirmed')
      if (receiptError) {
        setError(`Payment completed, but receipt failed: ${receiptError}`)
      } else {
        setMessage('Web3 payment completed.')
      }
      await openReceipt(paymentId)
    } catch (e: any) {
      setError(e?.response?.data?.error?.message || 'Failed to confirm Web3 payment')
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

  const statusBadge = (status?: string) => {
    const v = String(status || '').toUpperCase()
    if (v === 'COMPLETED' || v === 'PAID') return 'bg-green-100 text-green-800'
    if (v === 'PENDING') return 'bg-yellow-100 text-yellow-800'
    if (v === 'FAILED') return 'bg-red-100 text-red-800'
    return 'bg-gray-100 text-gray-700'
  }

  return (
    <div className="max-w-3xl mx-auto bg-white p-6 rounded shadow">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-2xl font-bold">Payment for order #{orderId}</h2>
          <div className="text-sm text-gray-500">Complete payment after estimate approval.</div>
        </div>
        {paymentStatus && (
          <span className={`px-2 py-1 text-xs rounded-full ${statusBadge(paymentStatus)}`}>
            {paymentStatus}
          </span>
        )}
      </div>

      {estimate ? (
        <div className="mb-6 space-y-2 border rounded p-4 bg-gray-50">
          <div className="flex items-center justify-between">
            <h3 className="font-semibold">Estimate</h3>
            <span className={`px-2 py-1 text-xs rounded-full ${estimateApproved ? 'bg-green-100 text-green-800' : 'bg-yellow-100 text-yellow-800'}`}>
              {estimateApproved ? 'Approved' : 'Pending'}
            </span>
          </div>
          {estimateSummary && <div className="text-sm">Summary: {estimateSummary}</div>}
          {estimateRecommendations.length > 0 && (
            <ul className="list-disc pl-5 text-sm text-gray-700">
              {estimateRecommendations.map((rec: string, i: number) => (
                <li key={i}>{rec}</li>
              ))}
            </ul>
          )}
          {(estimateFlags?.night || estimateFlags?.urgent || estimateFlags?.suv) && (
            <div className="text-xs text-gray-600">
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
          {isStaff && (
            <div className="flex flex-wrap items-center gap-2">
              <button
                onClick={() => generateEstimate('manual')}
                disabled={estimateAction === 'generating'}
                className="px-3 py-1 border rounded"
              >
                {estimateAction === 'generating' ? 'Recalculating...' : 'Recalculate estimate'}
              </button>
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
          )}
        </div>
      ) : (
        <div className="mb-6 text-gray-600 border rounded p-4 bg-gray-50">
          Estimate is being prepared by admin. Payment unlocks after approval.
          {isStaff && (
            <div className="mt-2">
              <button
                onClick={() => generateEstimate('manual')}
                disabled={estimateAction === 'generating'}
                className="px-3 py-1 border rounded"
              >
                {estimateAction === 'generating' ? 'Calculating...' : 'Generate estimate now'}
              </button>
            </div>
          )}
        </div>
      )}

      <div className="grid gap-4 md:grid-cols-2">
        <div className="border rounded p-4">
          <h3 className="font-semibold mb-1">Web3 payment (Polygon Amoy)</h3>
          <div className="text-xs text-gray-500 mb-3">
            Demo flow that looks like a real wallet transaction.
          </div>
          <div className="flex flex-wrap items-center gap-2 mb-3">
            <span className={`px-2 py-1 text-xs rounded-full ${web3Step === 'idle' ? 'bg-gray-100 text-gray-700' : 'bg-green-100 text-green-800'}`}>Wallet connected</span>
            <span className={`px-2 py-1 text-xs rounded-full ${web3Step === 'initialized' || web3Step === 'confirmed' ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-700'}`}>Transaction created</span>
            <span className={`px-2 py-1 text-xs rounded-full ${web3Step === 'confirmed' ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-700'}`}>Confirmed</span>
          </div>
          <div className="flex flex-wrap gap-2 mb-3">
            <button
              onClick={initWeb3Payment}
              disabled={creating || !estimateApproved}
              className="px-3 py-2 border rounded disabled:opacity-60"
            >
              {creating ? 'Preparing...' : 'Start Web3 payment'}
            </button>
            <button
              onClick={confirmWeb3Payment}
              disabled={submitting || !txHash || !paymentId}
              className="px-3 py-2 bg-primary-600 text-white rounded disabled:opacity-60"
            >
              {submitting ? 'Confirming...' : 'Confirm in wallet'}
            </button>
          </div>
          <div className="text-xs text-gray-500 mb-1">Transaction hash</div>
          <div className="border rounded px-3 py-2 text-sm bg-gray-50 break-all">
            {txHash ? txHash : 'Not created yet'}
          </div>
        </div>

        <div className="border rounded p-4 md:col-span-2">
          <h3 className="font-semibold mb-1">Card payment (demo)</h3>
          <div className="text-sm text-gray-600 mb-3">A card checkout flow with a confirmation screen.</div>
          <button
            onClick={() => setShowCardModal(true)}
            disabled={completing || !estimateApproved}
            className="px-3 py-2 border rounded disabled:opacity-60"
          >
            Open card checkout
          </button>
        </div>
      </div>

      {message && <div className="mt-2 text-green-700 text-sm">{message}</div>}
      {error && <div className="mt-2 text-red-700 text-sm">{error}</div>}

      {hasPayments && (
        <div className="mt-6 border rounded p-4">
          <h3 className="font-semibold mb-3">Payment history</h3>
          <div className="space-y-2">
            {payments.map((p: any) => (
              <div key={p.id} className="flex flex-wrap items-center justify-between gap-2 text-sm">
                <div className="flex flex-wrap items-center gap-2">
                  <span className={`px-2 py-1 text-xs rounded-full ${statusBadge(p.status)}`}>{p.status || 'n/a'}</span>
                  <span>#{p.id}</span>
                  <span>{p.method}</span>
                  <span>{Number(p.amount || 0).toFixed(2)} {p.currency || currency}</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-gray-500">{new Date(p.createdAt).toLocaleString()}</span>
                  {p.status === 'COMPLETED' && (
                    <button className="px-2 py-1 border rounded" onClick={() => openReceipt(p.id)}>
                      Open receipt
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {showCardModal && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
          <div className="bg-white rounded shadow-lg w-full max-w-md p-5">
            <h3 className="text-lg font-semibold mb-1">Card checkout (demo)</h3>
            <div className="text-sm text-gray-600 mb-4">
              Amount: {total.toFixed(2)} {currency}
            </div>
            <div className="space-y-2 mb-4 text-sm">
              <label className="flex items-center gap-2">
                <input
                  type="radio"
                  checked={selectedCardId === 'visa-demo'}
                  onChange={() => setSelectedCardId('visa-demo')}
                />
                {demoCards[0].label}
              </label>
              <label className="flex items-center gap-2 text-gray-500">
                <input
                  type="radio"
                  checked={selectedCardId === 'mc-demo'}
                  onChange={() => setSelectedCardId('mc-demo')}
                />
                {demoCards[1].label}
              </label>
            </div>
            <div className="mb-4 rounded-lg border bg-gradient-to-br from-slate-900 to-slate-700 text-white p-4">
              <div className="text-xs uppercase tracking-widest text-slate-200">{activeCard.bank}</div>
              <div className="mt-3 text-lg font-semibold tracking-wider">{activeCard.number}</div>
              <div className="mt-3 flex items-center justify-between text-xs text-slate-200">
                <span>{activeCard.holder}</span>
                <span>{activeCard.expiry}</span>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3 mb-4 text-sm">
              <label className="flex flex-col gap-1">
                <span className="text-xs text-gray-500">Cardholder name</span>
                <input className="border rounded px-2 py-1 bg-gray-50" readOnly value={activeCard.holder} />
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-xs text-gray-500">Expiry</span>
                <input className="border rounded px-2 py-1 bg-gray-50" readOnly value={activeCard.expiry} />
              </label>
              <label className="flex flex-col gap-1 col-span-2">
                <span className="text-xs text-gray-500">Card number</span>
                <input className="border rounded px-2 py-1 bg-gray-50" readOnly value={activeCard.number} />
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-xs text-gray-500">CVC</span>
                <input className="border rounded px-2 py-1 bg-gray-50" readOnly value={activeCard.cvc} />
              </label>
            </div>
            <div className="flex items-center justify-end gap-2">
              <button
                className="px-3 py-2 border rounded"
                onClick={() => {
                  setShowCardModal(false)
                }}
              >
                Cancel
              </button>
              <button
                className="px-3 py-2 bg-primary-600 text-white rounded disabled:opacity-60"
                disabled={completing}
                onClick={async () => {
                  setShowCardModal(false)
                  await demoCompletePayment()
                }}
              >
                {completing ? 'Processing...' : 'Pay now'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
