import prisma from '../utils/prisma.js'
import { signAccessToken, signRefreshToken } from '../utils/jwt.js'
import { ethers } from 'ethers'

export async function getNonceForAddress(address: string) {
  const a = address.toLowerCase()
  const nonce = Math.floor(Math.random() * 1e9).toString(36) + Date.now().toString(36)
  await prisma.walletNonce.upsert({ where: { address: a }, update: { nonce }, create: { address: a, nonce } })
  return nonce
}

export async function verifyWalletSignature(address: string, signature: string, name?: string) {
  const a = address.toLowerCase()
  const rec = await prisma.walletNonce.findUnique({ where: { address: a } })
  if (!rec) throw Object.assign(new Error('NONCE_NOT_FOUND'), { status: 400 })
  const msg = `AutoAssist Wallet auth nonce: ${rec.nonce}`
  let signer
  try {
    signer = ethers.verifyMessage(msg, signature)
  } catch (e) {
    throw Object.assign(new Error('INVALID_SIGNATURE'), { status: 400 })
  }
  if (signer.toLowerCase() !== a) throw Object.assign(new Error('INVALID_SIGNATURE'), { status: 400 })

  // find or create user by walletAddress
  let user = await prisma.user.findUnique({ where: { walletAddress: a }, select: { id: true, role: true, tokenVersion: true } })
  if (!user) {
    // create a customer record linked to wallet
    user = await prisma.user.create({ data: { walletAddress: a, name: name || null, passwordHash: Date.now().toString() }, select: { id: true, role: true, tokenVersion: true } })
  }

  // record audit event
  try {
    await prisma.auditEvent.create({ data: { type: 'wallet:login', payload: { address: a }, userId: user.id } })
  } catch (e) { /* ignore audit write errors */ }

  const payload = { sub: user.id, role: user.role, ver: user.tokenVersion }
  const access = signAccessToken(payload)
  const refresh = signRefreshToken(payload)
  return access
}

export async function linkWalletToUser(address: string, signature: string, userId: number) {
  const a = address.toLowerCase()
  const rec = await prisma.walletNonce.findUnique({ where: { address: a } })
  if (!rec) throw Object.assign(new Error('NONCE_NOT_FOUND'), { status: 400 })
  const msg = `AutoAssist Wallet link nonce: ${rec.nonce}`
  let signer
  try {
    signer = ethers.verifyMessage(msg, signature)
  } catch (e) {
    throw Object.assign(new Error('INVALID_SIGNATURE'), { status: 400 })
  }
  if (signer.toLowerCase() !== a) throw Object.assign(new Error('INVALID_SIGNATURE'), { status: 400 })

  // attach wallet to user
  await prisma.user.update({ where: { id: userId }, data: { walletAddress: a } })

  try {
    await prisma.auditEvent.create({ data: { type: 'wallet:link', payload: { address: a }, userId } })
  } catch (e) { /* ignore */ }
  return { ok: true }
}
