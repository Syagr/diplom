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
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  const [cameraActive, setCameraActive] = useState(false)
  const [stream, setStream] = useState<MediaStream | null>(null)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)

  async function pick() {
    inputRef.current?.click()
  }

  async function doPresignAndUpload(body: { fileName: string; contentType: string; size: number }, fileBody: Blob) {
    // 1) presign
    const res = await fetch('/api/attachments/presign-upload', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        orderId,
        fileName: body.fileName,
        contentType: body.contentType,
        size: body.size,
        kind: mapKindFromMime(body.contentType || ''),
      }),
    })
    if (!res.ok) throw new Error(`presign ${res.status}`)
    const presign = await res.json()

    // 2) upload (PUT)
    const putUrl = toProxyUrl(presign.putUrl)
    const putRes = await fetch(putUrl, { method: 'PUT', body: fileBody })
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
  }

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setBusy(true); setMsg(null)
    try {
      const mime = file.type || 'application/octet-stream'
      if (!ALLOWED_MIME.includes(mime)) {
        throw new Error(`Unsupported file type: ${mime}. Allowed: ${ALLOWED_MIME.join(', ')}`)
      }
      if (file.size > MAX_SIZE) {
        throw new Error(`File too large: ${(file.size / (1024*1024)).toFixed(2)} MB (max ${(MAX_SIZE/(1024*1024))} MB)`)
      }
      await doPresignAndUpload({ fileName: file.name, contentType: file.type || 'application/octet-stream', size: file.size }, file)
    } catch (e: any) {
      setMsg(`❌ ${e.message || String(e)}`)
    } finally {
      setBusy(false)
      if (inputRef.current) inputRef.current.value = ''
    }
  }

  async function startCamera() {
    setMsg(null)
    try {
      // Try a permissive constraint first; desktop laptops may ignore facingMode
      let s: MediaStream
      try {
        s = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false })
      } catch (err) {
        // fallback to any video input
        s = await navigator.mediaDevices.getUserMedia({ video: true, audio: false })
      }
      setStream(s)
      setCameraActive(true)
      if (videoRef.current) {
        videoRef.current.srcObject = s
        // Some browsers require waiting for metadata before playing
        const onLoaded = async () => {
          try { await videoRef.current?.play() } catch (e) { /* ignore */ }
          videoRef.current?.removeEventListener('loadedmetadata', onLoaded)
        }
        videoRef.current.addEventListener('loadedmetadata', onLoaded)
      }
    } catch (e:any) {
      setMsg(`❌ Камера недоступна: ${e?.message || String(e)}`)
    }
  }

  function stopCamera() {
    try {
      stream?.getTracks().forEach(t => t.stop())
    } catch {}
    setStream(null)
    setCameraActive(false)
    // cleanup preview
    if (previewUrl) {
      try { URL.revokeObjectURL(previewUrl) } catch {}
      setPreviewUrl(null)
    }
  }

  async function capturePhoto() {
    if (!videoRef.current) return
    setBusy(true); setMsg(null)
    try {
      const v = videoRef.current
      const w = v.videoWidth || 1280
      const h = v.videoHeight || 720
      let c = canvasRef.current
      if (!c) {
        c = document.createElement('canvas')
        canvasRef.current = c
      }
      c.width = w; c.height = h
      const ctx = c.getContext('2d')!
      ctx.drawImage(v, 0, 0, w, h)
      const blob = await new Promise<Blob | null>(resolve => c!.toBlob(b => resolve(b), 'image/jpeg', 0.92))
      if (!blob) throw new Error('Не вдалося отримати знімок')
      if (blob.size > MAX_SIZE) throw new Error('Знімок занадто великий')
      const fileName = `camera-${Date.now()}.jpg`
      // show local preview while upload runs
      try {
        const url = URL.createObjectURL(blob)
        setPreviewUrl(url)
      } catch {}
      await doPresignAndUpload({ fileName, contentType: 'image/jpeg', size: blob.size }, blob)
    } catch (e:any) {
      setMsg(`❌ ${e.message || String(e)}`)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div style={{ display:'grid', gap:8 }}>
      <input ref={inputRef} type="file" hidden accept={ALLOWED_MIME.join(',')} onChange={onFile} />
      <div style={{ display: 'flex', gap: 8 }}>
        <button onClick={pick} disabled={busy}>{busy ? 'Загрузка…' : 'Загрузить файл'}</button>
        {!cameraActive ? (
          <button onClick={startCamera} disabled={busy}>Use camera</button>
        ) : (
          <>
            <button onClick={capturePhoto} disabled={busy}>{busy ? 'Знімаю…' : 'Зняти фото'}</button>
            <button onClick={stopCamera} disabled={busy}>Stop camera</button>
          </>
        )}
      </div>
      {cameraActive && (
        <div>
          <video ref={videoRef} style={{ width: 320, height: 'auto', border: '1px solid #ddd' }} playsInline muted autoPlay />
        </div>
      )}
      {previewUrl && (
        <div>
          <div className="text-sm">Preview</div>
          <img src={previewUrl} alt="preview" style={{ maxWidth: 320, border: '1px solid #ddd' }} />
        </div>
      )}
      {msg && <div>{msg}</div>}
    </div>
  )
}
