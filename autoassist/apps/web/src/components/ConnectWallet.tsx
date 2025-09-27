import React, { useEffect, useState } from 'react'
import { BrowserProvider, formatEther } from 'ethers'

export default function ConnectWallet() {
  const [address, setAddress] = useState<string | null>(null)
  const [balance, setBalance] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)

  async function connect() {
    try {
      if (!(window as any).ethereum) throw new Error('Metamask not found')
      const provider = new BrowserProvider((window as any).ethereum)
      const accounts = await provider.send('eth_requestAccounts', [])
      const addr = accounts[0]
      setAddress(addr)
      const bal = await provider.getBalance(addr)
      setBalance(formatEther(bal))
    } catch (e: any) {
      setErr(e?.message || String(e))
    }
  }

  return (
    <div style={{ display: 'grid', gap: 8 }}>
      <button onClick={connect}>Connect wallet</button>
      {address && <div>Address: {address}</div>}
      {balance && <div>Balance (MATIC): {balance}</div>}
      {err && <div style={{ color: 'crimson' }}>Error: {err}</div>}
    </div>
  )
}
