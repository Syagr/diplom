import { Router, Request, Response } from 'express';
// @ts-ignore
import estimateService from '../services/estimate.service.new';
import { validate } from '../utils/validate.js';
import { CreateEstimateBody, EstimateIdParam } from '../validators/estimates.schema.js';

const router = Router();

// GET /estimates/:orderId - получить оценку по заказу
router.get('/:orderId', validate(EstimateIdParam, 'params'), async (req: Request, res: Response) => {
  try {
    const userId = req.user?.id;
    const { id: orderId } = req.params as any;

    if (!userId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const estimate = await estimateService.getEstimateByOrderId(parseInt(orderId));
    
    if (!estimate) {
      return res.status(404).json({ error: 'Estimate not found' });
    }

    // Проверяем права доступа - только клиент заказа может видеть оценку
    if (estimate.order.clientId !== Number(userId)) {
      return res.status(403).json({ error: 'Access denied' });
    }

    res.json(estimate);
  } catch (error) {
    console.error('Error fetching estimate:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /estimates - создать новую оценку
router.post('/', validate(CreateEstimateBody, 'body'), async (req: Request, res: Response) => {
  try {
    const userId = req.user?.id;
    
    if (!userId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const {
      orderId,
      lines,
      total
    } = req.body as any;

    // Валидация обязательных полей
    const estimate = await estimateService.createEstimate({
      orderId: Number(orderId),
      lines,
      total
    });

    res.status(201).json(estimate);
  } catch (error) {
    console.error('Error creating estimate:', error);
    if (error.code === 'P2002') {
      return res.status(409).json({ error: 'Estimate already exists for this order' });
    }
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PUT /estimates/:id - обновить оценку
router.put('/:id', validate(EstimateIdParam, 'params'), async (req: Request, res: Response) => {
  try {
    const userId = req.user?.id;
  const { id } = req.params as any;

    if (!userId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const {
      laborCost,
      partsCost,
      totalCost,
      estimatedDays,
      description,
      breakdown
    } = req.body;

  const updateData: any = req.body;

    const estimate = await estimateService.updateEstimate(parseInt(id), updateData);
    
    if (!estimate) {
      return res.status(404).json({ error: 'Estimate not found' });
    }

    res.json(estimate);
  } catch (error) {
    console.error('Error updating estimate:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// DELETE /estimates/:id - удалить оценку
router.delete('/:id', validate(EstimateIdParam, 'params'), async (req: Request, res: Response) => {
  try {
    const userId = req.user?.id;
    const { id } = req.params as any;

    if (!userId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const deleted = await estimateService.deleteEstimate(Number(id));
    
    if (!deleted) {
      return res.status(404).json({ error: 'Estimate not found' });
    }

    res.status(204).send();
  } catch (error) {
    console.error('Error deleting estimate:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /estimates/:id/approve - одобрить оценку
router.post('/:id/approve', async (req: Request, res: Response) => {
  try {
    const userId = req.user?.id;
    const { id } = req.params;

    if (!userId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const estimate = await estimateService.approveEstimate(parseInt(id), userId);
    
    if (!estimate) {
      return res.status(404).json({ error: 'Estimate not found' });
    }

    res.json(estimate);
  } catch (error) {
    console.error('Error approving estimate:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /estimates/:id/reject - отклонить оценку
router.post('/:id/reject', async (req: Request, res: Response) => {
  try {
    const userId = req.user?.id;
    const { id } = req.params;
    const { reason } = req.body;

    if (!userId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const estimate = await estimateService.rejectEstimate(parseInt(id), userId, reason);
    
    if (!estimate) {
      return res.status(404).json({ error: 'Estimate not found' });
    }

    res.json(estimate);
  } catch (error) {
    console.error('Error rejecting estimate:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;