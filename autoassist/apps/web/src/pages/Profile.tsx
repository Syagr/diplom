import React, { useEffect, useState } from 'react'
import axios from 'axios'
import ConnectWallet from '../components/ConnectWallet'
import { getPreferences, putPreferences, NotificationPreferences } from '../utils/notifications'

export default function ProfilePage() {
  const [prefs, setPrefs] = useState<NotificationPreferences>({ channels: [], types: [] })
  const [prefsSaving, setPrefsSaving] = useState(false)
  const [profileSaving, setProfileSaving] = useState(false)
  const [loaded, setLoaded] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [status, setStatus] = useState<string | null>(null)
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [phone, setPhone] = useState('')
  const [walletAddress, setWalletAddress] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    async function load() {
      try {
        setError(null)
        setStatus(null)
        const p = await getPreferences().catch(() => ({ channels: [], types: [] }))
        if (!cancelled) setPrefs(p)
        try {
          const r = await axios.get('/api/me')
          if (!cancelled && r?.data) {
            setName(r.data.name || '')
            setEmail(r.data.email || '')
            setPhone(r.data.phone || '')
            setWalletAddress(r.data.walletAddress || null)
          }
        } catch {}
      } catch (e: any) {
        if (!cancelled) setError(e?.message || 'Failed to load profile')
      } finally {
        if (!cancelled) setLoaded(true)
      }
    }
    load()
    return () => {
      cancelled = true
    }
  }, [])

  const toggleChannel = (ch: string) => {
    setPrefs((prev) => {
      const set = new Set(prev.channels || [])
      if (set.has(ch)) set.delete(ch)
      else set.add(ch)
      return { ...prev, channels: Array.from(set) }
    })
  }

  const toggleType = (t: string) => {
    setPrefs((prev) => {
      const set = new Set(prev.types || [])
      if (set.has(t)) set.delete(t)
      else set.add(t)
      return { ...prev, types: Array.from(set) }
    })
  }

  async function saveProfile(e?: React.FormEvent) {
    e?.preventDefault()
    setProfileSaving(true)
    setError(null)
    setStatus(null)
    try {
      await axios.put('/api/me', { name, email, phone })
      setStatus('Profile saved')
    } catch (err: any) {
      setError(err?.response?.data?.error?.message || err?.message || 'Failed to save profile')
    } finally {
      setProfileSaving(false)
    }
  }

  async function savePreferences() {
    setPrefsSaving(true)
    setError(null)
    setStatus(null)
    try {
      if (!prefs.channels || prefs.channels.length === 0) {
        throw new Error('Select at least one notification channel')
      }
      if (prefs.channels.includes('EMAIL') && !email.trim()) {
        throw new Error('Add an email address to enable email notifications')
      }
      await putPreferences(prefs)
      setStatus('Preferences saved')
    } catch (err: any) {
      setError(err?.message || 'Failed to save preferences')
    } finally {
      setPrefsSaving(false)
    }
  }

  const canEmail = Boolean(email.trim())

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <h1 className="text-2xl font-bold">Profile and Settings</h1>

      {!loaded ? (
        <div>Loading...</div>
      ) : (
        <>
          {error && <div className="text-red-600">{error}</div>}
          {status && <div className="text-green-700 text-sm">{status}</div>}

          <section className="bg-white p-4 rounded shadow">
            <h2 className="font-semibold mb-3">Contact info</h2>
            <form onSubmit={saveProfile} className="grid gap-3 max-w-lg">
              <input
                value={name}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => setName(e.target.value)}
                placeholder="Name"
                className="border px-2 py-1 rounded"
              />
              <input
                value={email}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => setEmail(e.target.value)}
                placeholder="Email"
                className="border px-2 py-1 rounded"
              />
              <input
                value={phone}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => setPhone(e.target.value)}
                placeholder="Phone"
                className="border px-2 py-1 rounded"
              />
              <div>
                <button className="px-3 py-1 bg-primary-600 text-white rounded" disabled={profileSaving}>
                  {profileSaving ? 'Saving...' : 'Save contact'}
                </button>
              </div>
            </form>
          </section>

          <section className="bg-white p-4 rounded shadow">
            <h2 className="font-semibold mb-3">Notifications</h2>
            <div className="mb-2 font-medium">Channels</div>
            <div className="flex gap-4 mb-4">
              <label className="inline-flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={Boolean(prefs.channels?.includes('IN_APP'))}
                  onChange={() => toggleChannel('IN_APP')}
                />
                IN_APP
              </label>
              <label className="inline-flex items-center gap-2">
                <input
                  type="checkbox"
                  disabled={!canEmail}
                  checked={Boolean(prefs.channels?.includes('EMAIL'))}
                  onChange={() => toggleChannel('EMAIL')}
                />
                EMAIL
              </label>
            </div>
            {!canEmail && (
              <div className="text-xs text-gray-500 mb-2">
                Add an email address to enable EMAIL notifications.
              </div>
            )}
            <div className="mb-2 font-medium">Types</div>
            <div className="flex gap-4 flex-wrap">
              {['ORDER_CREATED', 'ORDER_UPDATED', 'PAYMENT_CONFIRMED', 'PAYMENT_FAILED', 'BROADCAST'].map(
                (t) => (
                  <label key={t} className="inline-flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={Boolean(prefs.types?.includes(t))}
                      onChange={() => toggleType(t)}
                    />
                    {t}
                  </label>
                ),
              )}
            </div>
            <div className="mt-3">
              <button className="px-3 py-1 border rounded" disabled={prefsSaving} onClick={savePreferences}>
                {prefsSaving ? 'Saving...' : 'Save preferences'}
              </button>
            </div>
          </section>

          <section className="bg-white p-4 rounded shadow">
            <h2 className="font-semibold mb-3">Web3 wallet</h2>
            <p className="text-sm text-gray-600 mb-2">
              Connect MetaMask, switch to Polygon Amoy (80002), then link the wallet to your profile.
            </p>
            <div className="mb-2 text-sm text-gray-600">
              {walletAddress ? `Wallet linked: ${walletAddress}` : 'Wallet not linked'}
            </div>
            <ConnectWallet onLinked={(addr) => setWalletAddress(addr)} linkedAddress={walletAddress} mode="profile" />
          </section>
        </>
      )}
    </div>
  )
}
