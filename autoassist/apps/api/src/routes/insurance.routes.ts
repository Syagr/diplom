import { Router } from 'express';
import type { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { authenticate } from '@/middleware/auth.middleware.js';
import { InsuranceService } from '@/services/insurance.service.js';

const router = Router();
const insuranceService = new InsuranceService();

// ---- helpers ----
type AuthUser = { id: number; role?: 'admin' | 'manager' | 'client' | string };
const getAuth = (req: Request) => (req as any).user as AuthUser | undefined;
const safeEmit = (req: Request, room: string, event: string, payload: unknown) => {
  const io = req.app?.get?.('io');
  if (io?.to) io.to(room).emit(event, payload);
};

// ---- validation ----
const OffersBody = z.object({ orderId: z.coerce.number().int().positive() });
const OfferIdParam = z.object({ offerId: z.coerce.number().int().positive() });
const ClientIdParam = z.object({ clientId: z.coerce.number().int().positive() });

// ---- all routes are private ----
router.use(authenticate);

/**
 * @route POST /api/insurance/offers
 * @desc Generate insurance offers for order
 * @access Private (staff або власник замовлення — сервіс має перевірити)
 */
router.post('/offers', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const user = getAuth(req);
    if (!user) return res.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'Потрібен вхід' } });

    const { orderId } = OffersBody.parse(req.body);

    // сервіс повертає масив пропозицій, а також сам перевіряє права доступу (actor-based)
    const offers = await insuranceService.generateOffers(orderId, { id: user.id, role: user.role });

    safeEmit(req, `order:${orderId}`, 'order:updated', { id: orderId, kind: 'offers' });
    return res.status(201).json({ offers });
  } catch (e: any) {
    if (e.code === 'FORBIDDEN') return res.status(403).json({ error: { code: 'FORBIDDEN', message: 'Немає доступу' } });
    if (e.code === 'ORDER_NOT_FOUND') return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Замовлення не знайдено' } });
    return next(e);
  }
});

/**
 * @route POST /api/insurance/offers/:offerId/accept
 * @desc Accept insurance offer
 * @access Private (власник order або staff)
 */
router.post('/offers/:offerId/accept', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const user = getAuth(req);
    if (!user) return res.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'Потрібен вхід' } });

    const { offerId } = OfferIdParam.parse(req.params);

    const updated = await insuranceService.acceptOffer(offerId, { id: user.id, role: user.role });

    safeEmit(req, `order:${updated.orderId}`, 'order:updated', {
      id: updated.orderId,
      kind: 'offer.accepted',
      offerId: updated.id,
    });

    return res.json({ offer: updated });
  } catch (e: any) {
    if (e.code === 'FORBIDDEN') return res.status(403).json({ error: { code: 'FORBIDDEN', message: 'Немає доступу' } });
    if (e.code === 'OFFER_NOT_FOUND') return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Пропозицію не знайдено' } });
    if (e.code === 'OFFER_ALREADY_ACCEPTED') return res.status(409).json({ error: { code: 'ALREADY_ACCEPTED', message: 'Пропозицію вже прийнято' } });
    if (e.code === 'OFFER_EXPIRED') return res.status(409).json({ error: { code: 'EXPIRED', message: 'Термін дії пропозиції минув' } });
    return next(e);
  }
});

/**
 * @route GET /api/insurance/clients/:clientId/policies
 * @desc Get client's insurance policies
 * @access Private (власник або staff)
 */
router.get('/clients/:clientId/policies', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const user = getAuth(req);
    if (!user) return res.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'Потрібен вхід' } });

    const { clientId } = ClientIdParam.parse(req.params);

    // сервіс сам перевіряє: staff або user.id === clientId
    const policies = await insuranceService.getClientPolicies(clientId, { id: user.id, role: user.role });

    return res.json({ policies });
  } catch (e: any) {
    if (e.code === 'FORBIDDEN') return res.status(403).json({ error: { code: 'FORBIDDEN', message: 'Немає доступу' } });
    if (e.code === 'CLIENT_NOT_FOUND') return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Клієнта не знайдено' } });
    return next(e);
  }
});

export default router;
