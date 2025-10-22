import { Router } from 'express';
import type { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { authenticate } from '@/middleware/auth.middleware.js';
import NotificationService from '@/services/notification.service.js';
import prisma from '@/utils/prisma.js';
import { logger } from '../libs/logger.js';

const router = Router();
const notificationService = new NotificationService();

// ---- helpers ----
type AuthUser = { id: number; email?: string; role?: string };
const getAuth = (req: Request) => (req as any).user as AuthUser | undefined;
const isAdmin = (u?: AuthUser) => (u?.role ?? '').toString().toLowerCase() === 'admin';
const safeTrunc = (s: string, n = 200) => (s.length > n ? s.slice(0, n) + '…' : s);

// ---- validation schemas ----
const ListQuery = z.object({
  page: z.coerce.number().int().positive().default(1).transform(v => Math.min(v, 1000)),
  limit: z.coerce.number().int().positive().max(100).default(20),
  unreadOnly: z
    .union([z.literal('true'), z.literal('false')])
    .optional()
    .transform(v => v === 'true'),
  type: z.string().min(1).max(64).optional(),
});

const IdParam = z.object({ id: z.coerce.number().int().positive() });

const ChannelsEnum = z.enum(['IN_APP', 'EMAIL']);
const UpdatePrefsBody = z.object({
  channels: z.array(ChannelsEnum).min(1).max(2).optional(),
  types: z.array(z.string().min(1).max(64)).optional(),
});

const TestBody = z.object({
  userId: z.coerce.number().int().positive().optional(),
  type: z.string().min(1).max(64).default('SYSTEM_ALERT'),
  title: z.string().min(1).max(120).default('Test Notification'),
  message: z.string().min(1).max(2000).default('This is a test notification from AutoAssist+'),
  priority: z.enum(['LOW', 'MEDIUM', 'HIGH']).default('LOW'),
  channels: z.array(ChannelsEnum).min(1).max(2).default(['IN_APP']),
});

const BroadcastBody = z.object({
  title: z.string().min(1).max(120),
  message: z.string().min(1).max(2000),
  priority: z.enum(['LOW', 'MEDIUM', 'HIGH']).default('MEDIUM'),
  targetRole: z.string().min(1).max(64).optional(), // очікуєш 'client'/'manager'/'admin' тощо
  channels: z.array(ChannelsEnum).min(1).max(2).default(['IN_APP']),
});

// ---- secure all routes ----
router.use(authenticate);

/**
 * GET /api/notifications
 */
router.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const user = getAuth(req);
    if (!user) return res.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'Authentication required' } });

    const q = ListQuery.parse(req.query);
    const result = await notificationService.getUserNotifications(user.id, {
      page: q.page,
      limit: q.limit,
      unreadOnly: q.unreadOnly,
      type: q.type as any,
    });

    return res.json({
      success: true,
      data: {
        notifications: result.notifications.map(n => ({
          id: n.id,
          type: n.type,
          title: n.title,
          message: n.message,
          priority: n.priority,
          isRead: !!n.readAt,
          createdAt: n.createdAt,
          readAt: n.readAt,
          action: n.action,
          order: n.order ? { id: n.order.id, status: n.order.status } : null,
        })),
        pagination: {
          page: q.page,
          limit: q.limit,
          total: result.total,
          pages: Math.ceil(result.total / q.limit),
        },
        unreadCount: result.unreadCount,
      },
    });
  } catch (e) {
    logger.error('Failed to get notifications', { userId: getAuth(req)?.id, error: e instanceof Error ? e.message : String(e) });
    return next(e);
  }
});

/**
 * GET /api/notifications/unread-count
 */
router.get('/unread-count', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const user = getAuth(req);
    if (!user) return res.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'Authentication required' } });

    const unreadCount = await notificationService.getUnreadCount(user.id);
    return res.json({ success: true, data: { unreadCount } });
  } catch (e) {
    logger.error('Failed to get unread count', { userId: getAuth(req)?.id, error: e instanceof Error ? e.message : String(e) });
    return next(e);
  }
});

/**
 * PUT /api/notifications/:id/read
 */
router.put('/:id/read', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const user = getAuth(req);
    if (!user) return res.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'Authentication required' } });

    const { id } = IdParam.parse(req.params);
    await notificationService.markAsRead(id, user.id);

    logger.info('Notification marked as read', { notificationId: id, userId: user.id });
    return res.json({ success: true, message: 'Notification marked as read' });
  } catch (e) {
    logger.error('Failed to mark notification as read', {
      notificationId: req.params.id,
      userId: getAuth(req)?.id,
      error: e instanceof Error ? e.message : String(e),
    });
    return next(e);
  }
});

/**
 * GET /api/notifications/preferences
 */
router.get('/preferences', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const user = getAuth(req);
    if (!user) return res.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'Authentication required' } });

    const preferences = await notificationService.getUserPreferences(user.id);
    return res.json({ success: true, data: preferences });
  } catch (e) {
    logger.error('Failed to get notification preferences', { userId: getAuth(req)?.id, error: e instanceof Error ? e.message : String(e) });
    return next(e);
  }
});

/**
 * PUT /api/notifications/preferences
 */
router.put('/preferences', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const user = getAuth(req);
    if (!user) return res.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'Authentication required' } });

    const body = UpdatePrefsBody.parse(req.body);
    await notificationService.updateUserPreferences(user.id, body);

    logger.info('Notification preferences updated', { userId: user.id, ...body });
    return res.json({ success: true, message: 'Notification preferences updated successfully' });
  } catch (e) {
    logger.error('Failed to update notification preferences', { userId: getAuth(req)?.id, error: e instanceof Error ? e.message : String(e) });
    return next(e);
  }
});

/**
 * POST /api/notifications/test  (Admin only)
 */
router.post('/test', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const user = getAuth(req);
    if (!user) return res.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'Authentication required' } });
    if (!isAdmin(user)) return res.status(403).json({ error: { code: 'FORBIDDEN', message: 'Admin access required' } });

    const body = TestBody.parse(req.body);
    await notificationService.sendNotification({
      type: (body.type as any),
      title: body.title,
      message: safeTrunc(body.message, 1000),
      priority: body.priority,
      channels: body.channels,
      userId: body.userId ?? user.id,
      action: { label: 'View Dashboard', url: '/dashboard' },
    });

    logger.info('Test notification sent', { adminId: user.id, targetUserId: body.userId ?? user.id, type: body.type, title: body.title });
    return res.json({ success: true, message: 'Test notification sent successfully' });
  } catch (e) {
    logger.error('Failed to send test notification', { adminId: getAuth(req)?.id, error: e instanceof Error ? e.message : String(e) });
    return next(e);
  }
});

/**
 * POST /api/notifications/broadcast  (Admin only)
 */
router.post('/broadcast', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const user = getAuth(req);
    if (!user) return res.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'Authentication required' } });
    if (!isAdmin(user)) return res.status(403).json({ error: { code: 'FORBIDDEN', message: 'Admin access required' } });

    const body = BroadcastBody.parse(req.body);

  const where: any = body.targetRole ? { role: body.targetRole as any } : {};
    const users = await prisma.user.findMany({ where, select: { id: true } });
    if (users.length === 0) {
      return res.status(404).json({ error: { code: 'NO_TARGETS', message: 'No users found for broadcast' } });
    }

    const tasks = users.map(u =>
      notificationService.sendNotification({
        type: 'SYSTEM_ALERT',
        title: body.title,
        message: safeTrunc(body.message, 1000),
        priority: body.priority,
        userId: u.id,
        channels: body.channels,
      }),
    );

    const results = await Promise.allSettled(tasks);
    const fulfilled = results.filter(r => r.status === 'fulfilled').length;

    logger.info('Broadcast notification sent', { adminId: user.id, targetRole: body.targetRole, userCount: users.length, sent: fulfilled, title: body.title });

    return res.json({
      success: true,
      data: { sentTo: fulfilled, total: users.length },
      message: `Notification broadcast to ${fulfilled}/${users.length} users`,
    });
  } catch (e) {
    logger.error('Failed to broadcast notification', { adminId: getAuth(req)?.id, error: e instanceof Error ? e.message : String(e) });
    return next(e);
  }
});

export default router;
