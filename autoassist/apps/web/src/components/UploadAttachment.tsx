import React, { useRef, useState } from 'react'
import { toProxyUrl } from '../utils/s3'

type Props = { token: string; orderId?: number }

const ALLOWED_MIME = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/heic',
  'video/mp4',
  'application/pdf',
]
const MAX_SIZE = 25 * 1024 * 1024 // 25 MB

function mapKindFromMime(mime: string) {
  if (mime.startsWith('image/')) return 'photo'
  if (mime.startsWith('video/')) return 'video'
  if (mime === 'application/pdf') return 'document'
  return 'document'
}

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
      // client-side validation: type and size
      const mime = file.type || 'application/octet-stream'
      if (!ALLOWED_MIME.includes(mime)) {
        throw new Error(`Unsupported file type: ${mime}. Allowed: ${ALLOWED_MIME.join(', ')}`)
      }
      if (file.size > MAX_SIZE) {
        throw new Error(`File too large: ${(file.size / (1024*1024)).toFixed(2)} MB (max ${(MAX_SIZE/(1024*1024))} MB)`)
      }
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
          kind: mapKindFromMime(file.type || ''),
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
      const completeJson = await completeRes.json()

      let finalUrl: string | null = null
      if (completeJson?.url) {
        finalUrl = completeJson.url
      } else if (completeJson?.id) {
        // request fresh presigned GET URL
        try {
          const ures = await fetch(`/api/attachments/${completeJson.id}/url`, {
            headers: { Authorization: `Bearer ${token}` }
          })
          if (ures.ok) {
            const uj = await ures.json()
            finalUrl = uj?.url ?? null
          }
        } catch (e) { /* ignore */ }
      }

      if (finalUrl) {
        const proxied = toProxyUrl(finalUrl)
        setMsg(<span>✅ Загружено — <a href={proxied} target="_blank" rel="noreferrer">Скачать</a></span> as unknown as string)
      } else {
        setMsg('✅ Загружено')
      }
    } catch (e: any) {
      setMsg(`❌ ${e.message || String(e)}`)
    } finally {
      setBusy(false)
      if (inputRef.current) inputRef.current.value = ''
    }
  }

  return (
    <div style={{ display:'grid', gap:8 }}>
      <input ref={inputRef} type="file" hidden accept={ALLOWED_MIME.join(',')} onChange={onFile} />
      <button onClick={pick} disabled={busy}>{busy ? 'Загрузка…' : 'Загрузить файл'}</button>
      {msg && <div>{msg}</div>}
    </div>
  )
}
