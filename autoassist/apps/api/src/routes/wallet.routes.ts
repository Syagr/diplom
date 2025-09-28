import { Router } from 'express'
import { z } from 'zod'
import { getNonceForAddress, verifyWalletSignature, linkWalletToUser } from '../services/wallet.service.js'
import { validate } from '../middleware/validate.js'
import { authenticate } from '../middleware/auth.middleware.js'

export const walletRouter = Router()

const nonceSchema = { query: z.object({ address: z.string() }) }
walletRouter.get('/nonce', validate(nonceSchema), async (req, res, next) => {
  try {
    const { address } = req.query as any
    const nonce = await getNonceForAddress(address)
    res.json({ nonce })
  } catch (e) { next(e) }
})

const verifySchema = { body: z.object({ address: z.string(), signature: z.string(), name: z.string().optional() }) }
walletRouter.post('/verify', validate(verifySchema), async (req, res, next) => {
  try {
    const { address, signature, name } = req.body as any
    const token = await verifyWalletSignature(address, signature, name)
    res.json({ token })
  } catch (e) { next(e) }
})

const linkSchema = { body: z.object({ address: z.string(), signature: z.string() }) }
walletRouter.post('/link', authenticate, validate(linkSchema), async (req, res, next) => {
  try {
    const userId = Number((req as any).user?.id)
    const { address, signature } = req.body as any
    const out = await linkWalletToUser(address, signature, userId)
    res.json(out)
  } catch (e) { next(e) }
})

export default walletRouter
