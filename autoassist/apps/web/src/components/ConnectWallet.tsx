import { useEffect, useMemo, useState } from 'react'
import { BrowserProvider, formatEther } from 'ethers'
import auth from '../utils/auth'

type State = {
  provider?: BrowserProvider
  signer?: any
  address?: string
  chainId?: number
  balance?: string
  status?: string
  error?: string | null
  connecting?: boolean
  linking?: boolean
}

const AMOY_HEX = '0x13882' // 80002

function getEthereum(): any {
  const eth = (window as any).ethereum
  if (!eth) return null
  if (Array.isArray(eth.providers)) {
    return eth.providers.find((p: any) => p.isMetaMask) || eth.providers[0] || eth
  }
  return eth
}

async function ensureAmoyNetwork(): Promise<void> {
  const eth = getEthereum()
  if (!eth) throw new Error('Wallet not detected')
  try {
    await eth.request({
      method: 'wallet_switchEthereumChain',
      params: [{ chainId: AMOY_HEX }],
    })
  } catch (e: any) {
    if (e?.code === 4902) {
      await eth.request({
        method: 'wallet_addEthereumChain',
        params: [
          {
            chainId: AMOY_HEX,
            chainName: 'Polygon Amoy',
            nativeCurrency: { name: 'POL', symbol: 'POL', decimals: 18 },
            rpcUrls: ['https://rpc-amoy.polygon.technology'],
            blockExplorerUrls: ['https://www.oklink.com/amoy'],
          },
        ],
      })
    } else {
      throw e
    }
  }
}

type Props = {
  onLinked?: (address: string) => void
  linkedAddress?: string | null
  mode?: 'demo' | 'profile'
}

function normalizeWalletError(err: any): string {
  const raw = String(err?.message || err || '')
  if (/no active wallet found/i.test(raw)) {
    return 'Wallet is locked or has no active account. Open the wallet and unlock/select an account.'
  }
  if (/user rejected/i.test(raw) || err?.code === 4001) {
    return 'Connection rejected in wallet.'
  }
  if (err?.code === -32002) {
    return 'Wallet already has a pending request. Open the extension and finish it.'
  }
  if (/not detected/i.test(raw)) {
    return 'Wallet not detected. Install and enable the extension.'
  }
  return raw || 'Wallet error'
}

export default function ConnectWallet({ onLinked, linkedAddress, mode = 'demo' }: Props = {}) {
  const [st, setSt] = useState<State>({
    status: '',
    error: null,
  })

  const short = useMemo(
    () => (st.address ? `${st.address.slice(0, 6)}...${st.address.slice(-4)}` : undefined),
    [st.address],
  )

  async function refreshBasics(provider: BrowserProvider) {
    const network = await provider.getNetwork()
    const signer = await provider.getSigner()
    const address = await signer.getAddress()
    const bal = await provider.getBalance(address)
    setSt((s) => ({
      ...s,
      provider,
      signer,
      address,
      chainId: Number(network.chainId),
      balance: formatEther(bal),
    }))
  }

  async function connect(): Promise<{ signer: any; address: string }> {
    try {
      setSt((s) => ({ ...s, error: null, status: 'Connecting...', connecting: true }))
      const eth = getEthereum()
      if (!eth) throw new Error('Wallet not detected. Install and enable the extension.')
      const provider = new BrowserProvider(eth)
      try {
        const existing = await eth.request({ method: 'eth_accounts' })
        if (!existing || existing.length === 0) {
          try {
            await eth.request({
              method: 'wallet_requestPermissions',
              params: [{ eth_accounts: {} }],
            })
          } catch {}
        }
        const accounts = await eth.request({ method: 'eth_requestAccounts' })
        if (!accounts || accounts.length === 0) throw new Error('No active account in wallet')
      } catch (err: any) {
        if (err?.code === 4001) throw new Error('Connection rejected in wallet')
        if (err?.code === -32002) throw new Error('Wallet already has a pending request')
        throw err
      }
      await refreshBasics(provider)
      const signer = await provider.getSigner()
      const address = await signer.getAddress()
      setSt((s) => ({ ...s, status: 'Connected', connecting: false }))
      return { signer, address }
    } catch (e: any) {
      setSt((s) => ({ ...s, error: normalizeWalletError(e), status: '', connecting: false }))
      throw e
    }
  }

  async function switchToAmoy() {
    try {
      await ensureAmoyNetwork()
      if (st.provider) await refreshBasics(st.provider)
    } catch (e: any) {
      setSt((s) => ({ ...s, error: normalizeWalletError(e) }))
    }
  }

  async function requestNonce(address: string) {
    const url = `/api/wallet/nonce?address=${encodeURIComponent(address)}`
    const r = await fetch(url)
    if (!r.ok) throw new Error('Failed to fetch nonce')
    const j = await r.json()
    const nonce = j.nonce ?? j.data?.nonce
    if (!nonce) throw new Error('Nonce missing in response')
    return nonce as string
  }

  async function verifySignature(address: string, signature: string) {
    const body: any = { address, signature }
    const r = await fetch('/api/wallet/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    if (!r.ok) {
      const text = await r.text().catch(() => null)
      let msg = text || 'Verification failed'
      try {
        const j = text ? JSON.parse(text) : null
        msg = j?.error?.message || j?.message || msg
      } catch {}
      throw new Error(msg)
    }
    const j = await r.json()
    const token =
      (j.token && (j.token.access || j.token)) ||
      j.access ||
      j.accessToken
    if (!token) throw new Error('Token missing from response')
    try {
      auth.setToken(token, true)
    } catch {}
    try {
      const parts = token.split('.')
      if (parts.length >= 2) {
        const payload = JSON.parse(atob(parts[1].replace(/-/g, '+').replace(/_/g, '/')))
        auth.saveUserInfo(payload.name ?? null, payload.role ?? null)
      }
    } catch {}
    try {
      const sock = await import('../utils/socket')
      sock.ensureSocket()
    } catch {}
    return token
  }

  async function ensureConnected(): Promise<{ signer: any; address: string }> {
    if (st.provider) {
      try {
        const signer = await st.provider.getSigner()
        const address = await signer.getAddress()
        if (!st.address || address.toLowerCase() !== st.address.toLowerCase()) {
          setSt((s) => ({ ...s, signer, address }))
        }
        return { signer, address }
      } catch {
        // fall through to connect
      }
    }
    return connect()
  }

  async function registerWithWallet() {
    try {
      const { signer, address } = await ensureConnected()
      const nonce = await requestNonce(address)
      const msg = `AutoAssist Wallet auth nonce: ${nonce}`
      const sig = await signer.signMessage(msg)
      await verifySignature(address, sig)
      setSt((s) => ({ ...s, status: 'Registered and logged in', error: null }))
    } catch (e: any) {
      setSt((s) => ({ ...s, error: normalizeWalletError(e) }))
    }
  }

  async function linkWallet() {
    if (!auth.isAuthenticated()) {
      return setSt((s) => ({ ...s, error: 'Please login first to link wallet' }))
    }
    try {
      setSt((s) => ({ ...s, linking: true, error: null }))
      const { signer, address } = await ensureConnected()
      const nonce = await requestNonce(address)
      const msg = `AutoAssist Wallet link nonce: ${nonce}`
      const sig = await signer.signMessage(msg)
      const r = await fetch('/api/wallet/link', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${auth.getToken()}`,
        },
        body: JSON.stringify({ address, signature: sig }),
      })
      if (!r.ok) throw new Error('Link failed')
      setSt((s) => ({ ...s, status: 'Wallet linked', error: null, linking: false }))
      if (onLinked) onLinked(address)
    } catch (e: any) {
      setSt((s) => ({ ...s, error: normalizeWalletError(e), linking: false }))
    }
  }

  useEffect(() => {
    const eth = getEthereum()
    if (!eth) return
    const onAccounts = async () => {
      const accounts = await eth.request({ method: 'eth_accounts' }).catch(() => [])
      if (!accounts || accounts.length === 0) {
        setSt((s) => ({ ...s, address: undefined, status: 'Disconnected' }))
        return
      }
      if (st.provider) await refreshBasics(st.provider)
    }
    const onChain = async () => {
      if (st.provider) await refreshBasics(st.provider)
    }
    eth.on?.('accountsChanged', onAccounts)
    eth.on?.('chainChanged', onChain)
    ;(async () => {
      const accounts = await eth.request({ method: 'eth_accounts' }).catch(() => [])
      if (!accounts || accounts.length === 0) return
      try {
        const provider = new BrowserProvider(eth)
        await refreshBasics(provider)
        setSt((s) => ({ ...s, status: 'Connected' }))
      } catch {
        // ignore auto-connect errors
      }
    })()
    return () => {
      eth.removeListener?.('accountsChanged', onAccounts)
      eth.removeListener?.('chainChanged', onChain)
    }
  }, [st.provider])

  return (
    <div className="rounded-2xl p-4 border shadow-sm">
      <h3 className="text-lg font-semibold mb-2">Web3 (Polygon Amoy)</h3>
      {linkedAddress ? (
        <div className="text-xs text-gray-600 mb-2">Linked wallet: {linkedAddress}</div>
      ) : (
        <div className="text-xs text-gray-500 mb-2">No linked wallet</div>
      )}

      {!st.address ? (
        <button onClick={connect} className="px-4 py-2 rounded-xl border hover:bg-gray-50" disabled={st.connecting}>
          {st.connecting ? 'Connecting...' : 'Connect Wallet'}
        </button>
      ) : (
        <div className="space-y-2">
          <div className="text-sm">
            <div>
              <span className="font-medium">Address:</span> {short}
            </div>
            <div>
              <span className="font-medium">ChainId:</span> {st.chainId ?? '-'}
            </div>
            <div>
              <span className="font-medium">Balance:</span> {st.balance ? `${st.balance} POL` : '-'}
            </div>
            {st.chainId && st.chainId !== 80002 && (
              <div className="text-xs text-amber-600 mt-1">
                You are on the wrong network. Switch to Polygon Amoy (80002).
              </div>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button onClick={switchToAmoy} className="px-3 py-1.5 rounded-xl border hover:bg-gray-50">
              Switch to Amoy
            </button>
            {mode === 'demo' && (
              <button onClick={registerWithWallet} className="px-3 py-1.5 rounded-xl border hover:bg-gray-50">
                Register with wallet
              </button>
            )}
            <button onClick={linkWallet} className="px-3 py-1.5 rounded-xl border hover:bg-gray-50" disabled={st.linking}>
              {st.linking ? 'Linking...' : 'Link wallet'}
            </button>
          </div>
        </div>
      )}

      {(st.status || st.error) && (
        <div className="mt-3 text-sm">
          {st.status && <div className="text-gray-700">OK: {st.status}</div>}
          {st.error && <div className="text-red-600">Error: {st.error}</div>}
        </div>
      )}
    </div>
  )
}
