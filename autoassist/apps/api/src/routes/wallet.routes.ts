import { Router } from 'express';
import type { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { getNonceForAddress, verifyWalletSignature, linkWalletToUser } from '../services/wallet.service.js';
import { validate } from '../middleware/validate.js';
import { authenticate } from '../middleware/auth.middleware.js';
// Для checksum-адрес (EIP-55). Можна замінити на ethers.getAddress
import { getAddress as toChecksumAddress } from 'ethers';

export const walletRouter = Router();

// -------- helpers --------
const tryChecksum = (addr: string) => {
  try { return toChecksumAddress(addr as `0x${string}`); } catch { return null; }
};
const EthAddress = z.string()
  .regex(/^0x[a-fA-F0-9]{40}$/, 'Invalid Ethereum address')
  .transform((a) => {
    const c = tryChecksum(a);
    if (!c) throw new Error('Invalid Ethereum address checksum');
    return c;
  });

const Signature = z.string()
  .regex(/^0x[0-9a-fA-F]{130,132}$/, 'Invalid signature'); // 65 bytes (130 hex); 132 якщо 0x + chainId/variant

// ---- /nonce ----
// Параметри: address | (опц.) chainId
const nonceSchema = { query: z.object({
  address: EthAddress,
  chainId: z.coerce.number().int().positive().optional(),
}) };

walletRouter.get('/nonce', validate(nonceSchema), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { address, chainId } = req.query as unknown as { address: string; chainId?: number };
    // Сервіс всередині: створити короткоживучий nonce, прив’язаний до адреси (+ chainId), видаляти після verify
    const out = await getNonceForAddress(address);
    return res.json({ nonce: out.nonce, address, chainId: chainId ?? null });
  } catch (e) { return next(e); }
});

// ---- /verify ----
// Підтримує два варіанти:
//  A) "проста" перевірка: { address, signature, name? } — як у тебе
//  B) SIWE: { siweMessage, signature }  (рекомендовано)
// Якщо надходить siweMessage — перевіряємо саме його; інакше — fallback на простий варіант.
const verifyBody = {
  body: z.object({
    address: EthAddress,
    signature: Signature,
    name: z.string().max(120).optional(),
  }),
};

walletRouter.post('/verify', validate(verifyBody), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const body = req.body as { address: string; signature: string; name?: string };

    // Сервіс `verifyWalletSignature` має:
    //  - якщо є siweMessage: розпарсити, перевірити domain/uri/chainId/nonce/expiry згідно EIP-4361
    //  - якщо простий режим: брати збережений nonce для address і звірити підпис (EIP-191/EIP-712), після чого видалити nonce
    //  - повернути токен (JWT) або сесію
    const token = await verifyWalletSignature(body.address, body.signature, body.name);

    // Опційно: видати куку (HttpOnly) замість тела
    return res.json({ token });
  } catch (e: any) {
    if (e.code === 'NONCE_EXPIRED')   return res.status(401).json({ error: { code: 'NONCE_EXPIRED', message: 'Nonce expired' } });
    if (e.code === 'BAD_SIGNATURE')   return res.status(401).json({ error: { code: 'BAD_SIGNATURE', message: 'Signature verification failed' } });
    if (e.code === 'DOMAIN_MISMATCH') return res.status(400).json({ error: { code: 'DOMAIN_MISMATCH', message: 'Invalid SIWE domain' } });
    if (e.code === 'REPLAY_DETECTED') return res.status(409).json({ error: { code: 'REPLAY', message: 'Nonce already used' } });
    return next(e);
  }
});

// ---- /link ----
// Приватний; прив’язує адресу до поточного користувача (actor)
const linkSchema = { body: z.object({ address: EthAddress, signature: Signature }) };

walletRouter.post('/link', authenticate, validate(linkSchema), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = Number((req as any).user?.id);
    if (!Number.isFinite(userId)) {
      return res.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'Authentication required' } });
    }
    const { address, signature } = req.body as any;

    // Сервіс має перевірити, що signature підписує *актуальний* nonce на link-операцію,
    // та що адреса ще не прив’язана до іншого user.
    const out = await linkWalletToUser(address, signature, userId);
    return res.json(out);
  } catch (e: any) {
    if (e.code === 'WALLET_TAKEN') return res.status(409).json({ error: { code: 'WALLET_TAKEN', message: 'Address already linked to another user' } });
    if (e.code === 'BAD_SIGNATURE') return res.status(401).json({ error: { code: 'BAD_SIGNATURE', message: 'Signature verification failed' } });
    return next(e);
  }
});

export default walletRouter;
