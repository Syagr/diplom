import { Router } from 'express';
import { PaymentsService } from '../services/payments.service';

const router = Router();
const paymentsService = new PaymentsService();

/**
 * @route POST /api/payments/invoice
 * @desc Create payment invoice
 * @access Private
 */
router.post('/invoice', async (req, res) => {
  await paymentsService.createInvoice(req, res);
});

/**
 * @route POST /api/payments/webhook/:provider
 * @desc Handle payment webhook
 * @access Public
 */
router.post('/webhook/:provider', async (req, res) => {
  await paymentsService.handleWebhook(req, res);
});

/**
 * @route GET /api/payments/:paymentId
 * @desc Get payment status
 * @access Private
 */
router.get('/:paymentId', async (req, res) => {
  await paymentsService.getPaymentStatus(req, res);
});

export default router;