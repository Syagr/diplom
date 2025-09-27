import { Router } from 'express';
import { InsuranceService } from '@/services/insurance.service.js';

const router = Router();
const insuranceService = new InsuranceService();

/**
 * @route POST /api/insurance/offers
 * @desc Generate insurance offers for order
 * @access Private
 */
router.post('/offers', async (req, res) => {
  await insuranceService.generateOffers(req, res);
});

/**
 * @route POST /api/insurance/offers/:offerId/accept
 * @desc Accept insurance offer
 * @access Private
 */
router.post('/offers/:offerId/accept', async (req, res) => {
  await insuranceService.acceptOffer(req, res);
});

/**
 * @route GET /api/insurance/clients/:clientId/policies
 * @desc Get client's insurance policies
 * @access Private
 */
router.get('/clients/:clientId/policies', async (req, res) => {
  await insuranceService.getClientPolicies(req, res);
});

export default router;