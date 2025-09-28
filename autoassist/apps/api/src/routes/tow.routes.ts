import { Router } from 'express';
import type { Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { calculateDistance, formatCurrency } from '../../../../packages/shared/dist/utils/helpers.js';
import { TriageService } from '@/services/triage.service.js';
import { logger } from '../libs/logger.js';

const router = Router();
const prisma = new PrismaClient();
const triageService = new TriageService();

// Tow service configuration
const TOW_CONFIG = {
  BASE_RATE: 200, // UAH
  PER_KM_RATE: 15, // UAH per km
  NIGHT_MULTIPLIER: 1.5, // 18:00-06:00
  EMERGENCY_MULTIPLIER: 2.0,
  WEEKEND_MULTIPLIER: 1.2,
  
  // Service levels
  STANDARD: {
    name: 'Standard Tow',
    etaMultiplier: 1.0,
    priceMultiplier: 1.0
  },
  EXPRESS: {
    name: 'Express Tow',
    etaMultiplier: 0.7,
    priceMultiplier: 1.5
  },
  PREMIUM: {
    name: 'Premium Tow',
    etaMultiplier: 0.5,
    priceMultiplier: 2.0
  }
};

/**
 * @route POST /api/tow/quote
 * @desc Get tow quote for order
 * @access Private
 */
router.post('/quote', async (req: Request, res: Response) => {
  const { orderId: rawOrderId, pickup, destination, serviceLevel = 'STANDARD' } = req.body;
  const orderId = rawOrderId ? Number(rawOrderId) : undefined;

  try {
    if (!orderId && !pickup) {
      res.status(400).json({
        error: 'MISSING_PARAMS',
        message: 'orderId or pickup location is required'
      });
      return;
    }

    let order;
    let pickupLocation = pickup;

    // If orderId provided, get order details
    if (orderId) {
      order = await prisma.order.findUnique({
        where: { id: Number(orderId) },
        include: {
          locations: true,
          vehicle: true
        }
      });

      if (!order) {
        res.status(404).json({
          error: 'ORDER_NOT_FOUND',
          message: 'Order not found'
        });
        return;
      }

      pickupLocation = order.locations.find((l: any) => l.type === 'PICKUP') || pickup;
    }

    if (!pickupLocation || !pickupLocation.latitude || !pickupLocation.longitude) {
      res.status(400).json({
        error: 'INVALID_PICKUP',
        message: 'Valid pickup location with coordinates is required'
      });
      return;
    }

    // Use provided destination or find nearest service center
    let dropoffLocation = destination;
    if (!dropoffLocation) {
      dropoffLocation = await findNearestServiceCenter(pickupLocation);
    }

    const quote = await calculateTowQuote(pickupLocation, dropoffLocation, serviceLevel, order);

    // Save quote to database if orderId provided
    if (orderId) {
      await prisma.towRequest.upsert({
        where: { orderId: Number(orderId) },
        update: {
          distanceKm: quote.data.distanceKm,
          etaMinutes: quote.data.etaMinutes,
          price: quote.data.price,
          status: 'REQUESTED'
        },
        create: {
          orderId: Number(orderId),
          distanceKm: quote.data.distanceKm,
          etaMinutes: quote.data.etaMinutes,
          price: quote.data.price,
          status: 'REQUESTED'
        }
      });
    }

    logger.info('Tow quote generated', {
      orderId,
      distance: quote.data.distanceKm,
      price: quote.data.price,
      serviceLevel
    });

    res.json({
      success: true,
      data: quote,
      message: 'Tow quote generated successfully'
    });

  } catch (error) {
    logger.error('Failed to generate tow quote', {
      orderId,
      error: error instanceof Error ? error.message : String(error)
    });
    res.status(500).json({
      error: 'INTERNAL_ERROR',
      message: 'Failed to generate tow quote'
    });
  }
});

/**
 * @route POST /api/tow/:orderId/assign
 * @desc Assign tow truck to order
 * @access Private
 */
router.post('/:orderId/assign', async (req: Request, res: Response) => {
  const { orderId: rawOrderId } = req.params;
  const orderId = Number(rawOrderId);
  const { towTruckId, driverId, serviceLevel = 'STANDARD' } = req.body;

  try {
    const towRequest = await prisma.towRequest.findUnique({
      where: { orderId },
      include: {
        order: {
          include: {
            locations: true,
            client: true
          }
        }
      }
    });

    if (!towRequest) {
      res.status(404).json({
        error: 'TOW_REQUEST_NOT_FOUND',
        message: 'Tow request not found for this order'
      });
      return;
    }

    if (towRequest.status !== 'REQUESTED') {
      res.status(400).json({
        error: 'INVALID_STATUS',
        message: 'Tow request must be in QUOTED status to assign'
      });
      return;
    }

    // Update tow request with assignment
    const updatedRequest = await prisma.towRequest.update({
      where: { orderId: Number(orderId) },
      data: {
        status: 'ASSIGNED',
        partnerId: towTruckId ? Number(towTruckId) : towRequest.partnerId,
        driverName: driverId ? String(driverId) : towRequest.driverName,
        driverPhone: towRequest.driverPhone,
        vehicleInfo: serviceLevel
      }
    });

    // Update order status
    await prisma.order.update({
      where: { id: Number(orderId) },
      data: {
        status: 'SCHEDULED'
      }
    });

    // TODO: Send notifications to client and driver
    // await notificationService.notifyTowAssigned(orderId, driverId);

    logger.info('Tow truck assigned', {
      orderId,
      towTruckId,
      driverId,
      serviceLevel
    });

    res.json({
      success: true,
      data: {
        towRequestId: updatedRequest.id,
        status: updatedRequest.status,
        etaMinutes: updatedRequest.etaMinutes,
        price: updatedRequest.price,
        assignedAt: new Date()
      },
      message: 'Tow truck assigned successfully'
    });

  } catch (error) {
    logger.error('Failed to assign tow truck', {
      orderId,
      error: error instanceof Error ? error.message : String(error)
    });
    res.status(500).json({
      error: 'INTERNAL_ERROR',
      message: 'Failed to assign tow truck'
    });
  }
});

/**
 * @route GET /api/tow/:orderId/status
 * @desc Get tow request status
 * @access Private
 */
router.get('/:orderId/status', async (req: Request, res: Response) => {
  const { orderId: rawOrderId } = req.params;
  const orderId = Number(rawOrderId);

  try {
    const towRequest = await prisma.towRequest.findUnique({
      where: { orderId },
      include: {
        order: {
          select: {
            id: true,
            status: true
          }
        }
      }
    });

    if (!towRequest) {
      res.status(404).json({
        error: 'TOW_REQUEST_NOT_FOUND',
        message: 'Tow request not found'
      });
      return;
    }

    const response = {
      id: towRequest.id,
      orderId: towRequest.orderId,
      status: towRequest.status,
      distanceKm: towRequest.distanceKm,
      etaMinutes: towRequest.etaMinutes,
      price: towRequest.price,
      priceFormatted: formatCurrency(Number(towRequest.price), 'UAH'),
      metadata: null,
      createdAt: towRequest.createdAt,
      updatedAt: towRequest.updatedAt
    };

    res.json({
      success: true,
      data: response
    });

  } catch (error) {
    logger.error('Failed to get tow status', {
      orderId,
      error: error instanceof Error ? error.message : String(error)
    });
    res.status(500).json({
      error: 'INTERNAL_ERROR',
      message: 'Failed to get tow status'
    });
  }
});

/**
 * @route PUT /api/tow/:orderId/status
 * @desc Update tow request status (for drivers/dispatchers)
 * @access Private
 */
router.put('/:orderId/status', async (req: Request, res: Response) => {
  const { orderId: rawOrderId } = req.params;
  const orderId = Number(rawOrderId);
  const { status, location, estimatedArrival } = req.body;

  try {
    const validStatuses = ['ASSIGNED', 'EN_ROUTE', 'ARRIVED', 'LOADING', 'IN_TRANSIT', 'DELIVERED', 'COMPLETED'];
    
    if (!validStatuses.includes(status)) {
      res.status(400).json({
        error: 'INVALID_STATUS',
        message: `Status must be one of: ${validStatuses.join(', ')}`
      });
      return;
    }

    const towRequest = await prisma.towRequest.findUnique({
      where: { orderId }
    });

    if (!towRequest) {
      res.status(404).json({
        error: 'TOW_REQUEST_NOT_FOUND',
        message: 'Tow request not found'
      });
      return;
    }

    // Update tow request
    const updatedRequest = await prisma.towRequest.update({
      where: { orderId: Number(orderId) },
      data: {
        status,
        trackingUrl: JSON.stringify({ lastUpdate: new Date(), currentLocation: location, estimatedArrival })
      }
    });

    // Update order status based on tow status
    const orderStatusMap: Record<string, string> = {
      'EN_ROUTE': 'SCHEDULED',
      'ARRIVED': 'INSERVICE',
      'LOADING': 'INSERVICE',
      'IN_TRANSIT': 'INSERVICE',
      'DELIVERED': 'READY',
      'COMPLETED': 'READY'
    };

    if (orderStatusMap[status]) {
      await prisma.order.update({
        where: { id: Number(orderId) },
        data: {
          status: orderStatusMap[status] as any
        }
      });
    }

    // TODO: Send real-time updates via WebSocket
    // await socketService.emitToRoom(`order:${orderId}`, 'tow:status', { status, location });

    logger.info('Tow status updated', {
      orderId,
      status,
      location: location ? 'provided' : 'not provided'
    });

    res.json({
      success: true,
      data: {
        id: updatedRequest.id,
        status: updatedRequest.status,
        metadata: null
      },
      message: 'Tow status updated successfully'
    });

  } catch (error) {
    logger.error('Failed to update tow status', {
      orderId,
      error: error instanceof Error ? error.message : String(error)
    });
    res.status(500).json({
      error: 'INTERNAL_ERROR',
      message: 'Failed to update tow status'
    });
  }
});

// Helper functions

/**
 * Calculate tow quote with pricing and ETA
 */
async function calculateTowQuote(pickup: any, destination: any, serviceLevel: string, order?: any): Promise<any> {
  const distance = calculateDistance(
    pickup.latitude,
    pickup.longitude,
    destination.latitude,
    destination.longitude
  );

  const serviceLevelConfig: any = (TOW_CONFIG as any)[serviceLevel] || TOW_CONFIG.STANDARD;
  
  // Base price calculation
  let price = TOW_CONFIG.BASE_RATE + (distance * TOW_CONFIG.PER_KM_RATE);
  
  // Apply service level multiplier
  price *= serviceLevelConfig.priceMultiplier;

  // Apply time-based multipliers
  const currentHour = new Date().getHours();
  const isNight = currentHour >= 18 || currentHour <= 6;
  const isWeekend = [0, 6].includes(new Date().getDay());
  const isEmergency = order?.type === 'EMERGENCY';

  if (isNight) {
    price *= TOW_CONFIG.NIGHT_MULTIPLIER;
  }

  if (isWeekend) {
    price *= TOW_CONFIG.WEEKEND_MULTIPLIER;
  }

  if (isEmergency) {
    price *= TOW_CONFIG.EMERGENCY_MULTIPLIER;
  }

  // Calculate ETA
  const avgSpeed = distance > 50 ? 60 : 30; // km/h
  let etaMinutes = Math.round((distance / avgSpeed) * 60);
  
  // Apply service level ETA multiplier
  etaMinutes = Math.round(etaMinutes * serviceLevelConfig.etaMultiplier);
  
  // Add buffer time
  etaMinutes += isEmergency ? 5 : 15;

  return {
    data: {
      distanceKm: Math.round(distance * 10) / 10,
      etaMinutes,
      price: Math.round(price)
    },
    display: {
      distance: `${Math.round(distance * 10) / 10} km`,
      eta: formatETA(etaMinutes),
      price: formatCurrency(Math.round(price), 'UAH'),
      serviceLevel: serviceLevelConfig.name,
      isNight,
      isWeekend,
      isEmergency
    },
    pickup: {
      latitude: pickup.latitude,
      longitude: pickup.longitude,
      address: pickup.address || `${pickup.latitude}, ${pickup.longitude}`
    },
    destination: {
      latitude: destination.latitude,
      longitude: destination.longitude,
      address: destination.address || `${destination.latitude}, ${destination.longitude}`
    }
  };
}

/**
 * Find nearest service center (mock implementation)
 */
async function findNearestServiceCenter(pickup: any): Promise<any> {
  // Mock service centers in different cities
  const serviceCenters = [
    { name: 'Kyiv Service Center', latitude: 50.4501, longitude: 30.5234, address: 'Kyiv, Ukraine' },
    { name: 'Lviv Service Center', latitude: 49.8397, longitude: 24.0297, address: 'Lviv, Ukraine' },
    { name: 'Kharkiv Service Center', latitude: 49.9935, longitude: 36.2304, address: 'Kharkiv, Ukraine' },
    { name: 'Odesa Service Center', latitude: 46.4825, longitude: 30.7233, address: 'Odesa, Ukraine' }
  ];

  // Find nearest service center
  let nearestCenter = serviceCenters[0];
  let minDistance = calculateDistance(
    pickup.latitude,
    pickup.longitude,
    nearestCenter.latitude,
    nearestCenter.longitude
  );

  for (const center of serviceCenters.slice(1)) {
    const distance = calculateDistance(
      pickup.latitude,
      pickup.longitude,
      center.latitude,
      center.longitude
    );

    if (distance < minDistance) {
      minDistance = distance;
      nearestCenter = center;
    }
  }

  return nearestCenter;
}

/**
 * Format ETA for display
 */
function formatETA(minutes: number): string {
  if (minutes < 60) {
    return `${minutes} min`;
  }
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  return mins > 0 ? `${hours}h ${mins}m` : `${hours}h`;
}

export default router;