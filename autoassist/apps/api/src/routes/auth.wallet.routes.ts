// src/routes/auth.wallet.routes.ts
import { Router } from 'express';
import type { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { issueNonce, verifyWalletSignature, verifySiweSignature } from '../services/walletLogin.service.js';

const router = Router();

router.post('/wallet/nonce', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const body = z.object({ address: z.string().min(3) }).parse(req.body);
    const data = await issueNonce(body.address);
    return res.json(data);
  } catch (e) {
    return next(e);
  }
});

router.post('/wallet/verify', async (req: Request, res: Response, next: NextFunction) => {
  try {
    // Accept either simple {address, signature} or SIWE {siweMessage, signature}
    const schema = z.union([
      z.object({ address: z.string().min(3), signature: z.string().min(10), chainId: z.coerce.number().int().positive().optional() }),
      z.object({ siweMessage: z.string().min(30), signature: z.string().min(10) }),
    ]);
    const body = schema.parse(req.body) as any;

    const tokens = 'siweMessage' in body
      ? await verifySiweSignature({ siweMessage: body.siweMessage, signature: body.signature })
      : await verifyWalletSignature({ address: body.address, signature: body.signature, chainId: body.chainId });
    // Set HttpOnly cookies (optional; also return in body for SPA if needed)
    const isProd = (process.env.NODE_ENV || 'development') === 'production';
    res.cookie('access', tokens.access, { httpOnly: true, sameSite: isProd ? 'lax' : 'lax', secure: isProd, path: '/' });
    res.cookie('refresh', tokens.refresh, { httpOnly: true, sameSite: isProd ? 'lax' : 'lax', secure: isProd, path: '/' });
    return res.json(tokens);
  } catch (e) {
    return next(e);
  }
});

export default router;
