import { Router } from 'express';
import { Request, Response } from 'express';
import NotificationService from '../services/notification.service';
import { logger } from '../libs/logger';

const router = Router();
const notificationService = new NotificationService();

// Extend Request interface to include user
interface AuthenticatedRequest extends Request {
  user?: {
    id: string;
    email: string;
    role: string;
  };
}

/**
 * @route GET /api/notifications
 * @desc Get user notifications with pagination
 * @access Private
 */
router.get('/', async (req: AuthenticatedRequest, res: Response) => {
  try {
    if (!req.user) {
      res.status(401).json({
        error: 'UNAUTHORIZED',
        message: 'Authentication required'
      });
      return;
    }

    const {
      page = '1',
      limit = '20',
      unreadOnly = 'false',
      type
    } = req.query;

    const options = {
      page: parseInt(page as string, 10),
      limit: parseInt(limit as string, 10),
      unreadOnly: unreadOnly === 'true',
      type: type as string
    };

    const result = await notificationService.getUserNotifications(req.user.id, options);

    res.json({
      success: true,
      data: {
        notifications: result.notifications.map(notification => ({
          id: notification.id,
          type: notification.type,
          title: notification.title,
          message: notification.message,
          priority: notification.priority,
          isRead: !!notification.readAt,
          createdAt: notification.createdAt,
          readAt: notification.readAt,
          action: notification.action,
          order: notification.order ? {
            id: notification.order.id,
            orderNumber: notification.order.orderNumber,
            status: notification.order.status
          } : null
        })),
        pagination: {
          page: options.page,
          limit: options.limit,
          total: result.total,
          pages: Math.ceil(result.total / options.limit)
        },
        unreadCount: result.unreadCount
      }
    });

  } catch (error) {
    logger.error('Failed to get notifications', {
      userId: req.user?.id,
      error: error instanceof Error ? error.message : String(error)
    });
    res.status(500).json({
      error: 'INTERNAL_ERROR',
      message: 'Failed to get notifications'
    });
  }
});

/**
 * @route GET /api/notifications/unread-count
 * @desc Get unread notifications count
 * @access Private
 */
router.get('/unread-count', async (req: AuthenticatedRequest, res: Response) => {
  try {
    if (!req.user) {
      res.status(401).json({
        error: 'UNAUTHORIZED',
        message: 'Authentication required'
      });
      return;
    }

    const result = await notificationService.getUserNotifications(req.user.id, {
      limit: 1,
      unreadOnly: true
    });

    res.json({
      success: true,
      data: {
        unreadCount: result.unreadCount
      }
    });

  } catch (error) {
    logger.error('Failed to get unread count', {
      userId: req.user?.id,
      error: error instanceof Error ? error.message : String(error)
    });
    res.status(500).json({
      error: 'INTERNAL_ERROR',
      message: 'Failed to get unread count'
    });
  }
});

/**
 * @route PUT /api/notifications/:id/read
 * @desc Mark notification as read
 * @access Private
 */
router.put('/:id/read', async (req: AuthenticatedRequest, res: Response) => {
  try {
    if (!req.user) {
      res.status(401).json({
        error: 'UNAUTHORIZED',
        message: 'Authentication required'
      });
      return;
    }

    const { id } = req.params;

    await notificationService.markAsRead(id, req.user.id);

    logger.info('Notification marked as read', {
      notificationId: id,
      userId: req.user.id
    });

    res.json({
      success: true,
      message: 'Notification marked as read'
    });

  } catch (error) {
    logger.error('Failed to mark notification as read', {
      notificationId: req.params.id,
      userId: req.user?.id,
      error: error instanceof Error ? error.message : String(error)
    });
    res.status(500).json({
      error: 'INTERNAL_ERROR',
      message: 'Failed to mark notification as read'
    });
  }
});

/**
 * @route GET /api/notifications/preferences
 * @desc Get user notification preferences
 * @access Private
 */
router.get('/preferences', async (req: AuthenticatedRequest, res: Response) => {
  try {
    if (!req.user) {
      res.status(401).json({
        error: 'UNAUTHORIZED',
        message: 'Authentication required'
      });
      return;
    }

    const preferences = await notificationService.getUserPreferences(req.user.id);

    res.json({
      success: true,
      data: preferences
    });

  } catch (error) {
    logger.error('Failed to get notification preferences', {
      userId: req.user?.id,
      error: error instanceof Error ? error.message : String(error)
    });
    res.status(500).json({
      error: 'INTERNAL_ERROR',
      message: 'Failed to get notification preferences'
    });
  }
});

/**
 * @route PUT /api/notifications/preferences
 * @desc Update user notification preferences
 * @access Private
 */
router.put('/preferences', async (req: AuthenticatedRequest, res: Response) => {
  try {
    if (!req.user) {
      res.status(401).json({
        error: 'UNAUTHORIZED',
        message: 'Authentication required'
      });
      return;
    }

    const { channels, types } = req.body;

    // Validate channels
    const validChannels = ['IN_APP', 'EMAIL', 'SMS', 'TELEGRAM', 'PUSH'];
    if (channels && !Array.isArray(channels)) {
      res.status(400).json({
        error: 'INVALID_CHANNELS',
        message: 'Channels must be an array'
      });
      return;
    }

    if (channels && channels.some((channel: string) => !validChannels.includes(channel))) {
      res.status(400).json({
        error: 'INVALID_CHANNELS',
        message: `Valid channels are: ${validChannels.join(', ')}`
      });
      return;
    }

    await notificationService.updateUserPreferences(req.user.id, {
      channels,
      types
    });

    logger.info('Notification preferences updated', {
      userId: req.user.id,
      channels,
      types
    });

    res.json({
      success: true,
      message: 'Notification preferences updated successfully'
    });

  } catch (error) {
    logger.error('Failed to update notification preferences', {
      userId: req.user?.id,
      error: error instanceof Error ? error.message : String(error)
    });
    res.status(500).json({
      error: 'INTERNAL_ERROR',
      message: 'Failed to update notification preferences'
    });
  }
});

/**
 * @route POST /api/notifications/test
 * @desc Send test notification (for development)
 * @access Private (Admin only)
 */
router.post('/test', async (req: AuthenticatedRequest, res: Response) => {
  try {
    if (!req.user) {
      res.status(401).json({
        error: 'UNAUTHORIZED',
        message: 'Authentication required'
      });
      return;
    }

    // Only allow admins to send test notifications
    if (req.user.role !== 'ADMIN') {
      res.status(403).json({
        error: 'FORBIDDEN',
        message: 'Admin access required'
      });
      return;
    }

    const {
      userId = req.user.id,
      type = 'SYSTEM_ALERT',
      title = 'Test Notification',
      message = 'This is a test notification from AutoAssist+',
      priority = 'LOW',
      channels = ['IN_APP']
    } = req.body;

    await notificationService.sendNotification({
      type,
      title,
      message,
      priority,
      userId,
      channels,
      action: {
        label: 'View Dashboard',
        url: '/dashboard'
      }
    });

    logger.info('Test notification sent', {
      adminId: req.user.id,
      targetUserId: userId,
      type,
      title
    });

    res.json({
      success: true,
      message: 'Test notification sent successfully'
    });

  } catch (error) {
    logger.error('Failed to send test notification', {
      adminId: req.user?.id,
      error: error instanceof Error ? error.message : String(error)
    });
    res.status(500).json({
      error: 'INTERNAL_ERROR',
      message: 'Failed to send test notification'
    });
  }
});

/**
 * @route POST /api/notifications/broadcast
 * @desc Broadcast notification to all users or role
 * @access Private (Admin only)
 */
router.post('/broadcast', async (req: AuthenticatedRequest, res: Response) => {
  try {
    if (!req.user) {
      res.status(401).json({
        error: 'UNAUTHORIZED',
        message: 'Authentication required'
      });
      return;
    }

    if (req.user.role !== 'ADMIN') {
      res.status(403).json({
        error: 'FORBIDDEN',
        message: 'Admin access required'
      });
      return;
    }

    const {
      title,
      message,
      priority = 'MEDIUM',
      targetRole,
      channels = ['IN_APP']
    } = req.body;

    if (!title || !message) {
      res.status(400).json({
        error: 'MISSING_FIELDS',
        message: 'Title and message are required'
      });
      return;
    }

    // Get target users
    const whereClause = targetRole ? { role: targetRole } : {};
    const users = await prisma.user.findMany({
      where: whereClause,
      select: { id: true }
    });

    // Send notifications to all users
    const promises = users.map(user =>
      notificationService.sendNotification({
        type: 'SYSTEM_ALERT',
        title,
        message,
        priority,
        userId: user.id,
        channels
      })
    );

    await Promise.allSettled(promises);

    logger.info('Broadcast notification sent', {
      adminId: req.user.id,
      targetRole,
      userCount: users.length,
      title
    });

    res.json({
      success: true,
      data: {
        sentTo: users.length
      },
      message: `Notification broadcast to ${users.length} users`
    });

  } catch (error) {
    logger.error('Failed to broadcast notification', {
      adminId: req.user?.id,
      error: error instanceof Error ? error.message : String(error)
    });
    res.status(500).json({
      error: 'INTERNAL_ERROR',
      message: 'Failed to broadcast notification'
    });
  }
});

export default router;