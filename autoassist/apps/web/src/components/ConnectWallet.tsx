import { useEffect, useMemo, useState } from "react";
import { BrowserProvider, ethers, formatEther, parseEther } from "ethers";
import auth from '../utils/auth'

type State = {
  provider?: BrowserProvider;
  signer?: ethers.Signer;
  address?: string;
  chainId?: number;
  balance?: string; // in ETH/MATIC (formatted)
  status?: string;
  error?: string | null;
  sending?: boolean;
  signing?: boolean;
  recipient: string;
};

const AMOY_HEX = "0x13882"; // 80002
const AMOY_DEC = 80002;

async function ensureAmoyNetwork(): Promise<void> {
  // пытаемся переключиться; если не добавлена — добавим
  try {
    await (window as any).ethereum.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: AMOY_HEX }],
    });
  } catch (e: any) {
    if (e?.code === 4902) {
      // сеть не добавлена — добавим
      await (window as any).ethereum.request({
        method: "wallet_addEthereumChain",
        params: [
          {
            chainId: AMOY_HEX,
            chainName: "Polygon Amoy",
            nativeCurrency: { name: "MATIC", symbol: "MATIC", decimals: 18 },
            rpcUrls: ["https://rpc-amoy.polygon.technology"],
            blockExplorerUrls: ["https://www.oklink.com/amoy"],
          },
        ],
      });
    } else {
      throw e;
    }
  }
}

export default function ConnectWallet() {
  const [st, setSt] = useState<State>({
    status: "",
    error: null,
    recipient: "",
  });

  const short = useMemo(
    () =>
      st.address
        ? `${st.address.slice(0, 6)}…${st.address.slice(-4)}`
        : undefined,
    [st.address]
  );

  async function refreshBasics(provider: BrowserProvider) {
    const network = await provider.getNetwork();
    const signer = await provider.getSigner();
    const address = await signer.getAddress();
    const bal = await provider.getBalance(address);
    setSt((s) => ({
      ...s,
      provider,
      signer,
      address,
      chainId: Number(network.chainId),
      balance: formatEther(bal),
    }));
  }

  async function connect() {
    try {
      setSt((s) => ({ ...s, error: null, status: "Connecting…" }));
      if (!(window as any).ethereum) {
        throw new Error("Нет injected-кошелька. Установите MetaMask.");
      }
      const provider = new BrowserProvider((window as any).ethereum);
      await (window as any).ethereum.request({ method: "eth_requestAccounts" });
      await refreshBasics(provider);
      setSt((s) => ({ ...s, status: "Connected" }));
    } catch (e: any) {
      setSt((s) => ({ ...s, error: e?.message ?? String(e), status: "" }));
    }
  }

  async function switchToAmoy() {
    try {
      await ensureAmoyNetwork();
      if (st.provider) await refreshBasics(st.provider);
    } catch (e: any) {
      setSt((s) => ({ ...s, error: e?.message ?? String(e) }));
    }
  }

  async function signMessage() {
    if (!st.signer) return;
    try {
      setSt((s) => ({ ...s, error: null, signing: true, status: "Signing…" }));
      const msg = `AutoAssist+ demo: ${new Date().toISOString()}`;
      const sig = await st.signer.signMessage(msg);
      setSt((s) => ({
        ...s,
        signing: false,
        status: "Signed",
        error: null,
      }));
      alert(`✅ Signed!\n\nMessage:\n${msg}\n\nSignature:\n${sig}`);
    } catch (e: any) {
      setSt((s) => ({
        ...s,
        signing: false,
        status: "",
        error: e?.message ?? String(e),
      }));
    }
  }

  // Wallet auth flows (frontend). Backend endpoints expected:
  // GET  /api/auth/wallet/nonce?address=0x...
  // POST /api/auth/wallet/verify  { address, signature, name? } -> { token }
  async function requestNonce(address: string) {
    const url = `/api/auth/wallet/nonce?address=${encodeURIComponent(address)}`
    const r = await fetch(url)
    if (!r.ok) throw new Error('Не вдалось отримати nonce')
    const j = await r.json()
    return j.nonce as string
  }

  async function verifySignature(address: string, signature: string, name?: string) {
    const body: any = { address, signature }
    if (name) body.name = name
    const r = await fetch('/api/auth/wallet/verify', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    if (!r.ok) {
      const t = await r.text().catch(()=>null)
      throw new Error(t || 'Verification failed')
    }
    const j = await r.json()
    const token = j.token || j.access || j.accessToken
    if (token) {
      try { auth.setToken(token, true) } catch {}
      try { const parts = token.split('.'); if (parts.length>=2) { const payload = JSON.parse(atob(parts[1].replace(/-/g,'+').replace(/_/g,'/'))); auth.saveUserInfo(payload.name ?? null, payload.role ?? null) } } catch {}
      try { (await import('../utils/socket')).ensureSocket() } catch {}
      return token
    }
    throw new Error('Token missing from response')
  }

  async function registerWithWallet() {
    if (!st.signer) return setSt(s=>({...s, error: 'Connect wallet first'}))
    try {
      const address = await st.signer.getAddress()
      const nonce = await requestNonce(address)
      const msg = `AutoAssist Wallet auth nonce: ${nonce}`
      const sig = await st.signer.signMessage(msg)
      // optional: ask for display name
      const name = window.prompt('Enter a display name for your account (optional)') || undefined
      await verifySignature(address, sig, name)
      setSt(s=>({...s, status: 'Registered and logged in', error: null}))
    } catch (e:any) {
      setSt(s=>({...s, error: e?.message ?? String(e)}))
    }
  }

  async function linkWallet() {
    if (!st.signer) return setSt(s=>({...s, error: 'Connect wallet first'}))
    if (!auth.isAuthenticated()) return setSt(s=>({...s, error: 'Please login via email/password first to link wallet'}))
    try {
      const address = await st.signer.getAddress()
      const nonce = await requestNonce(address)
      const msg = `AutoAssist Wallet link nonce: ${nonce}`
      const sig = await st.signer.signMessage(msg)
      // POST to protected endpoint to link wallet to current user
      const r = await fetch('/api/wallet/link', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${auth.getToken()}` }, body: JSON.stringify({ address, signature: sig }) })
      if (!r.ok) throw new Error('Link failed')
      setSt(s=>({...s, status: 'Wallet linked', error: null}))
    } catch (e:any) {
      setSt(s=>({...s, error: e?.message ?? String(e)}))
    }
  }

  async function sendTx() {
    if (!st.signer || !st.address) return;
    try {
      setSt((s) => ({ ...s, sending: true, status: "Sending…", error: null }));
      const to = st.recipient?.trim() || st.address; // по умолчанию — себе
      if (!ethers.isAddress(to)) throw new Error("Неверный адрес получателя");

      // убедимся, что мы в Amoy
      const network = await st.signer.provider!.getNetwork();
      if (Number(network.chainId) !== AMOY_DEC) {
        await ensureAmoyNetwork();
      }

      const tx = await st.signer.sendTransaction({
        to,
        value: parseEther("0.001"),
      });
      const rec = await tx.wait();
      setSt((s) => ({
        ...s,
        sending: false,
        status: `Tx mined: ${rec?.hash ?? tx.hash}`,
      }));
      alert(`✅ Sent 0.001 MATIC to ${to}\nTx: ${tx.hash}`);
      // обновим баланс
      if (st.provider) await refreshBasics(st.provider);
    } catch (e: any) {
      setSt((s) => ({
        ...s,
        sending: false,
        status: "",
        error: e?.message ?? String(e),
      }));
    }
  }

  useEffect(() => {
    const eth = (window as any).ethereum;
    if (!eth) return;
    const onAccounts = async () => {
      if (st.provider) await refreshBasics(st.provider);
    };
    const onChain = async () => {
      if (st.provider) await refreshBasics(st.provider);
    };
    eth.on?.("accountsChanged", onAccounts);
    eth.on?.("chainChanged", onChain);
    return () => {
      eth.removeListener?.("accountsChanged", onAccounts);
      eth.removeListener?.("chainChanged", onChain);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [st.provider]);

  return (
    <div className="rounded-2xl p-4 border shadow-sm">
      <h3 className="text-lg font-semibold mb-2">Web3 (Polygon Amoy)</h3>

      {!st.address ? (
        <button
          onClick={connect}
          className="px-4 py-2 rounded-xl border hover:bg-gray-50"
        >
          Connect Wallet
        </button>
      ) : (
        <div className="space-y-2">
          <div className="text-sm">
            <div>
              <span className="font-medium">Address:</span> {short}
            </div>
            <div>
              <span className="font-medium">ChainId:</span>{" "}
              {st.chainId ?? "—"}
            </div>
            <div>
              <span className="font-medium">Balance:</span>{" "}
              {st.balance ? `${st.balance} MATIC` : "—"}
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={switchToAmoy}
              className="px-3 py-1.5 rounded-xl border hover:bg-gray-50"
            >
              Switch to Amoy
            </button>
            <button
              onClick={signMessage}
              disabled={st.signing}
              className="px-3 py-1.5 rounded-xl border hover:bg-gray-50 disabled:opacity-60"
            >
              {st.signing ? "Signing…" : "Sign message"}
            </button>
            <button
              onClick={registerWithWallet}
              className="px-3 py-1.5 rounded-xl border hover:bg-gray-50"
            >
              Register with wallet
            </button>
            <button
              onClick={linkWallet}
              className="px-3 py-1.5 rounded-xl border hover:bg-gray-50"
            >
              Link wallet
            </button>
          </div>

          <div className="flex items-center gap-2">
            <input
              placeholder="Recipient (optional, defaults to self)"
              value={st.recipient}
              onChange={(e) =>
                setSt((s) => ({ ...s, recipient: e.target.value }))
              }
              className="px-3 py-1.5 rounded-xl border w-[360px]"
            />
            <button
              onClick={sendTx}
              disabled={st.sending}
              className="px-3 py-1.5 rounded-xl border hover:bg-gray-50 disabled:opacity-60"
            >
              {st.sending ? "Sending…" : "Send 0.001 MATIC"}
            </button>
          </div>
        </div>
      )}

      {(st.status || st.error) && (
        <div className="mt-3 text-sm">
          {st.status && <div className="text-gray-700">• {st.status}</div>}
          {st.error && <div className="text-red-600">• {st.error}</div>}
        </div>
      )}
    </div>
  );
}
