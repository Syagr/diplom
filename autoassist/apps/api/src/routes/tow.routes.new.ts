import { Router } from 'express';
import { z } from 'zod';
import { assignTow, saveTowQuote, towQuote } from '../services/tow.service.new';

export const tow = Router();

tow.post('/quote', async (req, res, next) => {
  try {
    const body = z.object({
      orderId: z.number(),
      from: z.object({ lat: z.number(), lng: z.number() }),
      to: z.object({ lat: z.number(), lng: z.number() })
    }).parse(req.body);

    const q = await towQuote(body.orderId, 
      { lat: body.from.lat, lng: body.from.lng }, 
      { lat: body.to.lat, lng: body.to.lng }
    );
    const saved = await saveTowQuote(body.orderId, q);
    req.app.get('io').to(`order:${body.orderId}`).emit('order:updated', { id: body.orderId, kind: 'tow.quote', ...q });
    res.json({ tow: saved });
  } catch (e) { next(e); }
});

tow.post('/:orderId/assign', async (req, res, next) => {
  try {
    const { orderId } = z.object({ orderId: z.coerce.number() }).parse(req.params);
    const { partnerId } = z.object({ partnerId: z.number() }).parse(req.body);
    const t = await assignTow(orderId, partnerId);
    req.app.get('io').to(`order:${orderId}`).emit('order:updated', { id: orderId, kind: 'tow.assigned', partnerId });
    res.json({ tow: t });
  } catch (e) { next(e); }
});