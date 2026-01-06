import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import axios from 'axios'

export default function ProofViewer() {
  const { id } = useParams<{ id: string }>()
  const [data, setData] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!id) return
    ;(async () => {
      setLoading(true); setError(null)
      try {
        const r = await axios.get(`/api/orders/${id}/proof`)
        setData(r.data)
      } catch (e:any) {
        setError(e?.response?.data?.error?.message || 'Не вдалося отримати proof')
      } finally {
        setLoading(false)
      }
    })()
  }, [id])

  if (loading) return <div className="max-w-3xl mx-auto bg-white p-6 rounded shadow">Завантаження...</div>
  if (error) return <div className="max-w-3xl mx-auto bg-white p-6 rounded shadow text-red-700">{error}</div>
  if (!data) return <div className="max-w-3xl mx-auto bg-white p-6 rounded shadow">Немає даних.</div>

  const evidence = data?.evidence || data?.attachments || []
  const proofHash = data?.proofHash || data?.hash
  const ipfsUrl = data?.ipfsUrl || data?.ipfs || null

  return (
    <div className="max-w-3xl mx-auto bg-white p-6 rounded shadow">
      <h2 className="text-2xl font-bold mb-4">Proof виконання заявки #{id}</h2>
      <div className="mb-2 text-sm text-gray-700">Хеш доказу: <span className="font-mono break-all">{proofHash || '—'}</span></div>
      {ipfsUrl && (
        <div className="mb-4 text-sm"><a className="text-primary-600 hover:underline" target="_blank" rel="noreferrer" href={ipfsUrl}>Перейти до IPFS</a></div>
      )}
      <div>
        <h3 className="font-semibold mb-2">Докази</h3>
        {evidence.length === 0 ? (
          <div className="text-gray-600">Немає доказів.</div>
        ) : (
          <ul className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {evidence.map((ev:any, i:number) => (
              <li key={i} className="border rounded p-2">
                <div className="text-xs text-gray-600 mb-1">{ev.type || ev.kind || 'item'}</div>
                {ev.url ? (
                  <a className="text-sm text-primary-600 hover:underline break-all" target="_blank" rel="noreferrer" href={ev.url}>{ev.name || ev.url}</a>
                ) : (
                  <div className="text-sm break-all">{ev.name || JSON.stringify(ev)}</div>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
