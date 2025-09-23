import { Router } from 'express';
import { z } from 'zod';
import { acceptOffer, generateOffers } from '../services/insurance.service.new';

export const insurance = Router();

insurance.post('/offers', async (req, res, next) => {
  try {
    const body = z.object({ orderId: z.number() }).parse(req.body);
    const offers = await generateOffers(body.orderId);
    req.app.get('io').to(`order:${body.orderId}`).emit('order:updated', { id: body.orderId, kind: 'offers' });
    res.status(201).json({ offers });
  } catch (e) { next(e); }
});

insurance.post('/:offerId/accept', async (req, res, next) => {
  try {
    const { offerId } = z.object({ offerId: z.coerce.number() }).parse(req.params);
    const updated = await acceptOffer(offerId);
    req.app.get('io').to(`order:${updated.orderId}`).emit('order:updated', { id: updated.orderId, kind: 'offer.accepted', offerId: updated.id });
    res.json({ offer: updated });
  } catch (e) { next(e); }
});