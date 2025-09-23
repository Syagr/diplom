import { Router, Request, Response } from 'express';
// @ts-ignore
import estimateService from '../services/estimate.service.new';

const router = Router();

// GET /estimates/:orderId - получить оценку по заказу
router.get('/:orderId', async (req: Request, res: Response) => {
  try {
    const userId = req.user?.id;
    const { orderId } = req.params;

    if (!userId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const estimate = await estimateService.getEstimateByOrderId(parseInt(orderId));
    
    if (!estimate) {
      return res.status(404).json({ error: 'Estimate not found' });
    }

    // Проверяем права доступа - только клиент заказа может видеть оценку
    if (estimate.order.clientId !== parseInt(userId)) {
      return res.status(403).json({ error: 'Access denied' });
    }

    res.json(estimate);
  } catch (error) {
    console.error('Error fetching estimate:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /estimates - создать новую оценку
router.post('/', async (req: Request, res: Response) => {
  try {
    const userId = req.user?.id;
    
    if (!userId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const {
      orderId,
      laborCost,
      partsCost,
      totalCost,
      estimatedDays,
      description,
      breakdown
    } = req.body;

    // Валидация обязательных полей
    if (!orderId || !totalCost) {
      return res.status(400).json({ error: 'Missing required fields: orderId, totalCost' });
    }

    const estimate = await estimateService.createEstimate({
      orderId: parseInt(orderId),
      laborCost: laborCost || 0,
      partsCost: partsCost || 0,
      totalCost: parseFloat(totalCost),
      estimatedDays: estimatedDays || null,
      description: description || null,
      breakdown: breakdown || null
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
router.put('/:id', async (req: Request, res: Response) => {
  try {
    const userId = req.user?.id;
    const { id } = req.params;

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

    const updateData: any = {};
    if (laborCost !== undefined) updateData.laborCost = parseFloat(laborCost);
    if (partsCost !== undefined) updateData.partsCost = parseFloat(partsCost);
    if (totalCost !== undefined) updateData.totalCost = parseFloat(totalCost);
    if (estimatedDays !== undefined) updateData.estimatedDays = estimatedDays;
    if (description !== undefined) updateData.description = description;
    if (breakdown !== undefined) updateData.breakdown = breakdown;

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
router.delete('/:id', async (req: Request, res: Response) => {
  try {
    const userId = req.user?.id;
    const { id } = req.params;

    if (!userId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const deleted = await estimateService.deleteEstimate(parseInt(id));
    
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