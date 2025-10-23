import { useEffect, useState } from 'react'
import getSocket, { ensureSocket } from '../../utils/socket'

export function useSocket() {
  const [connected, setConnected] = useState(false)

  useEffect(() => {
  let s: any = null
  let mounted = true;
  (async () => {
      try {
        s = await getSocket()
        if (!mounted || !s) return
        const onConnect = () => setConnected(true)
        const onDisconnect = () => setConnected(false)
        s.on && s.on('connect', onConnect)
        s.on && s.on('disconnect', onDisconnect)
        if (s.connected) setConnected(true)
      } catch {}
    })()
    return () => { mounted = false; try { s && s.off && (s.off('connect'), s.off('disconnect')) } catch {} }
  }, [])

  return { connected, refresh: ensureSocket }
}

export default useSocket
