import { Router } from 'express';
import type { Request, Response } from 'express';
import { authenticate } from '../middleware/auth.middleware.js';
import estimateService from '../services/estimate.service.new';
import { validate } from '../utils/validate.js';
import {
  CreateEstimateBody,
  EstimateIdParam,              // expects { id: number }
  OrderIdParam,                 // <-- додай у validators: expects { orderId: number }
  UpdateEstimateBody,           // <-- опційно: схема для PUT
  DecisionBody                  // <-- { reason?: string } для reject
} from '../validators/estimates.schema.js';

const router = Router();

// Допоміжний тип/хелпер щоб не тягнути any
type AuthUser = { id: number; role?: 'admin' | 'manager' | 'client' | string };
const getAuth = (req: Request) => (req as any).user as AuthUser | undefined;
const isStaff = (u?: AuthUser) => !!u && ['admin','manager'].includes(String(u.role));

// Усі ендпоїнти захищені
router.use(authenticate);

// GET /estimates/by-order/:orderId — отримати оцінку за orderId
router.get('/by-order/:orderId', validate(OrderIdParam, 'params'), async (req: Request, res: Response) => {
  try {
    const user = getAuth(req);
    if (!user) return res.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'Потрібен вхід' } });

    const { orderId } = req.params as unknown as { orderId: string };
    const oid = Number(orderId);
    if (!Number.isFinite(oid)) {
      return res.status(400).json({ error: { code: 'BAD_REQUEST', message: 'Некоректний orderId' } });
    }

    const estimate = await estimateService.getEstimateByOrderId(oid);
    if (!estimate) {
      return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Оцінку не знайдено' } });
    }

    // Видимість: клієнт свого замовлення або персонал
    if (!isStaff(user) && estimate.order?.clientId !== Number(user.id)) {
      return res.status(403).json({ error: { code: 'FORBIDDEN', message: 'Немає доступу' } });
    }

    return res.json(estimate);
  } catch (error) {
    console.error('Error fetching estimate:', error);
    return res.status(500).json({ error: { code: 'INTERNAL', message: 'Внутрішня помилка сервера' } });
  }
});

// POST /estimates — створити оцінку (доступно лише персоналу)
router.post('/', validate(CreateEstimateBody, 'body'), async (req: Request, res: Response) => {
  try {
    const user = getAuth(req);
    if (!user) return res.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'Потрібен вхід' } });
    if (!isStaff(user)) {
      return res.status(403).json({ error: { code: 'FORBIDDEN', message: 'Тільки персонал може створювати кошториси' } });
    }

    const { orderId, lines, total } = req.body as any;

    const estimate = await estimateService.createEstimate({
      orderId: Number(orderId),
      lines,
      total,
      createdById: user.id, // якщо підтримується аудиту
    });

    return res.status(201).json(estimate);
  } catch (error: any) {
    console.error('Error creating estimate:', error);
    if (error?.code === 'P2002') {
      return res.status(409).json({ error: { code: 'CONFLICT', message: 'Оцінка для цього замовлення вже існує' } });
    }
    return res.status(500).json({ error: { code: 'INTERNAL', message: 'Внутрішня помилка сервера' } });
  }
});

// PUT /estimates/:id — оновити оцінку (лише персонал)
router.put('/:id', validate(EstimateIdParam, 'params'), validate(UpdateEstimateBody, 'body'), async (req: Request, res: Response) => {
  try {
    const user = getAuth(req);
    if (!user) return res.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'Потрібен вхід' } });
    if (!isStaff(user)) {
      return res.status(403).json({ error: { code: 'FORBIDDEN', message: 'Тільки персонал може змінювати кошториси' } });
    }

    const { id } = req.params as unknown as { id: string };
    const eid = Number(id);
    if (!Number.isFinite(eid)) {
      return res.status(400).json({ error: { code: 'BAD_REQUEST', message: 'Некоректний id' } });
    }

    const estimateExists = await estimateService.getEstimateById(eid);
    if (!estimateExists) {
      return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Оцінку не знайдено' } });
    }

    const updateData = req.body;
    const estimate = await estimateService.updateEstimate(eid, updateData);

    return res.json(estimate);
  } catch (error) {
    console.error('Error updating estimate:', error);
    return res.status(500).json({ error: { code: 'INTERNAL', message: 'Внутрішня помилка сервера' } });
  }
});

// DELETE /estimates/:id — видалити оцінку (лише персонал)
router.delete('/:id', validate(EstimateIdParam, 'params'), async (req: Request, res: Response) => {
  try {
    const user = getAuth(req);
    if (!user) return res.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'Потрібен вхід' } });
    if (!isStaff(user)) {
      return res.status(403).json({ error: { code: 'FORBIDDEN', message: 'Тільки персонал може видаляти кошториси' } });
    }

    const { id } = req.params as unknown as { id: string };
    const eid = Number(id);
    if (!Number.isFinite(eid)) {
      return res.status(400).json({ error: { code: 'BAD_REQUEST', message: 'Некоректний id' } });
    }

    const deleted = await estimateService.deleteEstimate(eid);
    if (!deleted) {
      return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Оцінку не знайдено' } });
    }

    return res.status(204).send();
  } catch (error) {
    console.error('Error deleting estimate:', error);
    return res.status(500).json({ error: { code: 'INTERNAL', message: 'Внутрішня помилка сервера' } });
  }
});

// POST /estimates/:id/approve — затвердити оцінку (клієнт свого замовлення або персонал)
router.post('/:id/approve', validate(EstimateIdParam, 'params'), async (req: Request, res: Response) => {
  try {
    const user = getAuth(req);
    if (!user) return res.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'Потрібен вхід' } });

    const eid = Number((req.params as any).id);
    if (!Number.isFinite(eid)) {
      return res.status(400).json({ error: { code: 'BAD_REQUEST', message: 'Некоректний id' } });
    }

    const record = await estimateService.getEstimateById(eid);
    if (!record) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Оцінку не знайдено' } });

    const isOwner = record.order?.clientId === Number(user.id);
    if (!isOwner && !isStaff(user)) {
      return res.status(403).json({ error: { code: 'FORBIDDEN', message: 'Немає доступу' } });
    }

    if (record.status === 'APPROVED') {
      return res.status(409).json({ error: { code: 'ALREADY_APPROVED', message: 'Оцінку вже затверджено' } });
    }
    if (record.status === 'REJECTED') {
      return res.status(409).json({ error: { code: 'ALREADY_REJECTED', message: 'Оцінку вже відхилено' } });
    }

    const estimate = await estimateService.approveEstimate(eid, user.id);
    return res.json(estimate);
  } catch (error) {
    console.error('Error approving estimate:', error);
    return res.status(500).json({ error: { code: 'INTERNAL', message: 'Внутрішня помилка сервера' } });
  }
});

// POST /estimates/:id/reject — відхилити оцінку (клієнт свого замовлення або персонал)
router.post('/:id/reject', validate(EstimateIdParam, 'params'), validate(DecisionBody, 'body'), async (req: Request, res: Response) => {
  try {
    const user = getAuth(req);
    if (!user) return res.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'Потрібен вхід' } });

    const eid = Number((req.params as any).id);
    if (!Number.isFinite(eid)) {
      return res.status(400).json({ error: { code: 'BAD_REQUEST', message: 'Некоректний id' } });
    }

    const record = await estimateService.getEstimateById(eid);
    if (!record) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Оцінку не знайдено' } });

    const isOwner = record.order?.clientId === Number(user.id);
    if (!isOwner && !isStaff(user)) {
      return res.status(403).json({ error: { code: 'FORBIDDEN', message: 'Немає доступу' } });
    }

    if (record.status === 'REJECTED') {
      return res.status(409).json({ error: { code: 'ALREADY_REJECTED', message: 'Оцінку вже відхилено' } });
    }
    if (record.status === 'APPROVED') {
      return res.status(409).json({ error: { code: 'ALREADY_APPROVED', message: 'Оцінку вже затверджено' } });
    }

    const { reason } = req.body as { reason?: string };
    const estimate = await estimateService.rejectEstimate(eid, user.id, reason);
    return res.json(estimate);
  } catch (error) {
    console.error('Error rejecting estimate:', error);
    return res.status(500).json({ error: { code: 'INTERNAL', message: 'Внутрішня помилка сервера' } });
  }
});

export default router;
