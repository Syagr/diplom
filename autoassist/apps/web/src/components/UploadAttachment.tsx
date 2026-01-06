import React, { useRef, useState } from 'react'

type Props = { token?: string; orderId: number; onUploaded?: () => void }

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

export default function UploadAttachment({ token, orderId, onUploaded }: Props) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)

  function pick() {
    inputRef.current?.click()
  }
  async function doDirectUpload(body: { fileName: string; contentType: string; size: number }, fileBody: Blob) {
    const headers: Record<string, string> = {}
    if (token) headers.Authorization = `Bearer ${token}`
    const form = new FormData()
    form.append('orderId', String(orderId))
    form.append('kind', mapKindFromMime(body.contentType || ''))
    form.append('file', fileBody, body.fileName)

    const res = await fetch('/api/attachments/upload', {
      method: 'POST',
      headers,
      credentials: 'include',
      body: form,
    })
    if (!res.ok) throw new Error(`upload ${res.status}`)

    setMsg('Upload complete.')
    if (onUploaded) onUploaded()
  }

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setBusy(true)
    setMsg(null)
    try {
      const mime = file.type || 'application/octet-stream'
      if (!ALLOWED_MIME.includes(mime)) {
        throw new Error(`Непідтримуваний тип: ${mime}`)
      }
      if (file.size > MAX_SIZE) {
        throw new Error(`Файл завеликий: ${(file.size / (1024 * 1024)).toFixed(2)} МБ`) 
      }
      await doDirectUpload({ fileName: file.name, contentType: file.type || 'application/octet-stream', size: file.size }, file)
    } catch (e: any) {
      setMsg(e?.message || 'Помилка завантаження')
    } finally {
      setBusy(false)
      if (inputRef.current) inputRef.current.value = ''
    }
  }

  return (
    <div className="space-y-2">
      <input ref={inputRef} type="file" hidden accept={ALLOWED_MIME.join(',')} onChange={onFile} />
      <button onClick={pick} disabled={busy} className="px-3 py-1 border rounded">
        {busy ? 'Завантаження...' : 'Додати файл'}
      </button>
      {msg && <div className="text-sm text-gray-600">{msg}</div>}
    </div>
  )
}
