import React, { useRef, useState } from 'react'
import { toProxyUrl } from '../utils/s3'

type Props = { token: string; orderId?: number }

export default function UploadAttachment({ token, orderId = 1 }: Props) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)

  async function pick() {
    inputRef.current?.click()
  }

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setBusy(true); setMsg(null)
    try {
      // 1) presign
      const res = await fetch('/api/attachments/presign-upload', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          orderId,
          fileName: file.name,
          contentType: file.type || 'application/octet-stream',
          size: file.size,
          kind: 'doc',
        }),
      })
      if (!res.ok) throw new Error(`presign ${res.status}`)
      const presign = await res.json()

      // 2) upload (PUT → MinIO через /s3)
      const putUrl = toProxyUrl(presign.putUrl)
      const putRes = await fetch(putUrl, { method: 'PUT', body: file })
      if (!putRes.ok) throw new Error(`put ${putRes.status}`)

      // 3) complete
      const id = presign.attachmentId ?? presign.id
      const completeRes = await fetch(`/api/attachments/${id}/complete`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ etag: '' }),
      })
      if (!completeRes.ok) throw new Error(`complete ${completeRes.status}`)

      setMsg('✅ Загружено')
    } catch (e: any) {
      setMsg(`❌ ${e.message || String(e)}`)
    } finally {
      setBusy(false)
      if (inputRef.current) inputRef.current.value = ''
    }
  }

  return (
    <div style={{ display:'grid', gap:8 }}>
      <input ref={inputRef} type="file" hidden onChange={onFile} />
      <button onClick={pick} disabled={busy}>{busy ? 'Загрузка…' : 'Загрузить файл'}</button>
      {msg && <div>{msg}</div>}
    </div>
  )
}
