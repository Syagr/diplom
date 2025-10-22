import { Router } from 'express';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { authenticate } from '../middleware/auth.middleware.js';
import {
  generateOffers,        // (orderId: number, actor: { id:number, role?:string }) => Promise<Offer[]>
  acceptOffer            // (offerId: number, actor: { id:number, role?:string }) => Promise<Offer>
} from '../services/insurance.service.new.js';

export const insurance = Router();

// ---- helpers ----
type AuthUser = { id: number; role?: 'admin' | 'manager' | 'client' | string };
const getAuth = (req: Request) => (req as any).user as AuthUser | undefined;
const safeEmit = (req: Request, room: string, event: string, payload: unknown) => {
  const io = req.app?.get?.('io');
  if (io?.to) io.to(room).emit(event, payload);
};

// Усі маршрути захищені
insurance.use(authenticate);

// POST /insurance/offers — згенерувати пропозиції по orderId
insurance.post('/offers', async (req: Request, res: Response, next) => {
  try {
    const user = getAuth(req);
    if (!user) return res.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'Потрібен вхід' } });

    // приймаємо як число або як строку-число
    const { orderId } = z.object({ orderId: z.coerce.number().int().positive() }).parse(req.body);

    // Генерацію зазвичай робить персонал; але можна дозволити клієнту, якщо сервіс перевіряє право на замовлення.
    // Виносимо авторизацію в сервіс (actor-aware).
    const offers = await generateOffers(orderId, { id: user.id, role: user.role });

    safeEmit(req, `order:${orderId}`, 'order:updated', { id: orderId, kind: 'offers' });
    return res.status(201).json({ offers });
  } catch (e: any) {
    // нормалізовані помилки
    if (e.code === 'FORBIDDEN') {
      return res.status(403).json({ error: { code: 'FORBIDDEN', message: 'Немає доступу' } });
    }
    if (e.code === 'ORDER_NOT_FOUND') {
      return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Замовлення не знайдено' } });
    }
    return next(e);
  }
});

// POST /insurance/:offerId/accept — прийняти конкретну пропозицію
insurance.post('/:offerId/accept', async (req: Request, res: Response, next) => {
  try {
    const user = getAuth(req);
    if (!user) return res.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'Потрібен вхід' } });

    const { offerId } = z.object({ offerId: z.coerce.number().int().positive() }).parse(req.params);

    // Сервіс має:
    //  - перевірити, що offer існує і ще не прийнятий/не протермінований
    //  - перевірити право (власник order або staff)
    //  - оновити статус і повернути оновлений запис із orderId
    const updated = await acceptOffer(offerId, { id: user.id, role: user.role });

    safeEmit(req, `order:${updated.orderId}`, 'order:updated', {
      id: updated.orderId,
      kind: 'offer.accepted',
      offerId: updated.id,
    });

    return res.json({ offer: updated });
  } catch (e: any) {
    if (e.code === 'FORBIDDEN') {
      return res.status(403).json({ error: { code: 'FORBIDDEN', message: 'Немає доступу' } });
    }
    if (e.code === 'OFFER_NOT_FOUND') {
      return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Пропозицію не знайдено' } });
    }
    if (e.code === 'OFFER_ALREADY_ACCEPTED') {
      return res.status(409).json({ error: { code: 'ALREADY_ACCEPTED', message: 'Пропозицію вже прийнято' } });
    }
    if (e.code === 'OFFER_EXPIRED') {
      return res.status(409).json({ error: { code: 'EXPIRED', message: 'Термін дії пропозиції минув' } });
    }
    return next(e);
  }
});

export default insurance;
