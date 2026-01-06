// services/notification.service.ts
import prisma from '@/utils/prisma.js';
import { logger } from '../libs/logger.js';
import SocketService from './socket.service.js';

export type NotificationType =
  | 'ORDER_CREATED'
  | 'ORDER_UPDATED'
  | 'PAYMENT_RECEIVED'
  | 'TOW_ASSIGNED'
  | 'INSPECTION_COMPLETED'
  | 'SYSTEM_ALERT';

export type NotificationPriority = 'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT';
export type NotificationChannel = 'IN_APP' | 'EMAIL';

export interface NotificationData {
  type: NotificationType;
  title: string;
  message: string;
  priority: NotificationPriority;
  userId: number;
  orderId?: number;
  metadata?: Record<string, any>;
  channels: NotificationChannel[];
  action?: { label: string; url: string };
}

export default class NotificationService {
  private socketService?: SocketService;

  constructor(socketService?: SocketService) {
    this.socketService = socketService;
  }

  setSocketService(socketService: SocketService) {
    this.socketService = socketService;
  }

  async sendNotification(data: NotificationData): Promise<void> {
    const notification = await prisma.notification.create({
      data: {
        type: data.type,
        title: data.title,
        message: data.message,
        priority: data.priority,
        userId: data.userId,
        orderId: data.orderId ?? null,
        metadata: data.metadata ?? {},
        channels: data.channels,
        action: data.action ?? null,
        status: 'SENT',
      },
      select: { id: true },
    });

    const results = await Promise.allSettled(
      data.channels.map((channel) => this.sendThroughChannel(channel, data, notification.id))
    );

    const delivered = results.filter((r) => r.status === 'fulfilled').length;
    logger.info('Notification processed', {
      notificationId: notification.id,
      userId: data.userId,
      type: data.type,
      channels: data.channels,
      delivered,
      failed: results.length - delivered,
    });
  }

  async getUserPreferences(userId: number): Promise<{
    channels: NotificationChannel[];
    types: string[];
  }> {
    const pref = await prisma.notificationPreference.findUnique({
      where: { userId },
    });

    return {
      channels: (pref?.enabledChannels as NotificationChannel[]) ?? ['IN_APP'],
      types: pref?.enabledTypes ?? [],
    };
  }

  async updateUserPreferences(
    userId: number,
    preferences: { channels?: NotificationChannel[]; types?: string[] }
  ): Promise<void> {
    await prisma.notificationPreference.upsert({
      where: { userId },
      update: {
        enabledChannels: preferences.channels,
        enabledTypes: preferences.types,
      },
      create: {
        userId,
        enabledChannels: preferences.channels ?? ['IN_APP'],
        enabledTypes: preferences.types ?? [],
      },
    });

    logger.info('User notification preferences updated', { userId });
  }

  async markAsRead(notificationId: number, userId: number): Promise<void> {
    await prisma.notification.updateMany({
      where: { id: notificationId, userId },
      data: { readAt: new Date() },
    });
  }

  async getUserNotifications(
    userId: number,
    options: { page?: number; limit?: number; unreadOnly?: boolean; type?: NotificationType } = {}
  ): Promise<{ notifications: any[]; total: number; unreadCount: number }> {
    const page = Math.max(1, Number(options.page ?? 1));
    const limit = Math.min(100, Math.max(1, Number(options.limit ?? 20)));
    const skip = (page - 1) * limit;

    const where: any = {
      userId,
      ...(options.unreadOnly ? { readAt: null } : {}),
      ...(options.type ? { type: options.type } : {}),
    };

    const [notifications, total, unreadCount] = await Promise.all([
      prisma.notification.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
        include: { order: { select: { id: true, status: true } } },
      }),
      prisma.notification.count({ where }),
      prisma.notification.count({ where: { userId, readAt: null } }),
    ]);

    return { notifications, total, unreadCount };
  }

  async getUnreadCount(userId: number): Promise<number> {
    return prisma.notification.count({ where: { userId, readAt: null } });
  }

  async sendOrderNotification(
    type: Exclude<NotificationType, 'SYSTEM_ALERT' | 'PAYMENT_RECEIVED'>,
    orderId: number,
    customMessage?: string
  ): Promise<void> {
    const order = await prisma.order.findUnique({
      where: { id: orderId },
      include: { client: true },
    });
    if (!order) throw new Error('ORDER_NOT_FOUND');

    const recipientUser = await prisma.user.findFirst({
      where: { clientId: order.clientId },
      select: { id: true },
    });
    if (!recipientUser) return;

    const templates: Record<
      Exclude<NotificationType, 'SYSTEM_ALERT' | 'PAYMENT_RECEIVED'>,
      { title: string; message: (o: any) => string }
    > = {
      ORDER_CREATED: {
        title: 'Order created',
        message: (o) => customMessage ?? `Order #${o.orderNumber ?? o.id} was created. We will contact you soon.`,
      },
      ORDER_UPDATED: {
        title: 'Order updated',
        message: (o) => customMessage ?? `Order #${o.orderNumber ?? o.id} was updated. Current status: ${o.status}`,
      },
      TOW_ASSIGNED: {
        title: 'Tow assigned',
        message: (o) => customMessage ?? `A tow has been assigned to order #${o.orderNumber ?? o.id}.`,
      },
      INSPECTION_COMPLETED: {
        title: 'Inspection completed',
        message: (o) => customMessage ?? `Inspection for order #${o.orderNumber ?? o.id} is completed.`,
      },
    };

    const tpl = templates[type] ?? {
      title: 'Order update',
      message: (_o: any) => customMessage ?? 'Your order has been updated.',
    };

    const prefs = await this.getUserPreferences(recipientUser.id);
    await this.sendNotification({
      type,
      title: tpl.title,
      message: tpl.message(order),
      priority: type === 'ORDER_CREATED' ? 'HIGH' : 'MEDIUM',
      userId: recipientUser.id,
      orderId,
      channels: prefs.channels,
      action: { label: 'Open order', url: `/orders/${orderId}` },
    });
  }

  private async sendThroughChannel(
    channel: NotificationChannel,
    data: NotificationData,
    notificationId: number
  ): Promise<void> {
    try {
      switch (channel) {
        case 'IN_APP':
          await this.sendInAppNotification(data);
          break;
        case 'EMAIL':
          await this.sendEmailNotification(data);
          break;
      }

      await prisma.notificationDelivery.create({
        data: {
          notificationId,
          channel,
          status: 'DELIVERED',
          deliveredAt: new Date(),
        },
      });
    } catch (err) {
      await prisma.notificationDelivery.create({
        data: {
          notificationId,
          channel,
          status: 'FAILED',
          error: err instanceof Error ? err.message : String(err),
        },
      });

      logger.error(`Failed to send ${channel} notification`, {
        notificationId,
        userId: data.userId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  private mapPriorityToToastType(priority: NotificationPriority): 'INFO' | 'SUCCESS' | 'WARNING' | 'ERROR' {
    switch (priority) {
      case 'LOW':
        return 'INFO';
      case 'MEDIUM':
        return 'SUCCESS';
      case 'HIGH':
        return 'WARNING';
      case 'URGENT':
      default:
        return 'ERROR';
    }
  }

  private async sendInAppNotification(data: NotificationData): Promise<void> {
    if (!this.socketService) throw new Error('Socket service not initialized');

    this.socketService.emitNotification(data.userId, {
      type: this.mapPriorityToToastType(data.priority),
      title: data.title,
      message: data.message,
      action: data.action,
    });
  }

  private async sendEmailNotification(data: NotificationData): Promise<void> {
    const user = await prisma.user.findUnique({
      where: { id: data.userId },
      select: { email: true, name: true },
    });
    if (!user?.email) throw new Error('User email not found');

    const emailPayload = {
      to: user.email,
      subject: data.title,
      html: this.generateEmailTemplate(data, user.name ?? undefined),
      headers: { 'X-Notification-Type': data.type, 'X-Order-Id': String(data.orderId ?? '') },
    };

    logger.info('Email notification (mock send)', emailPayload);
  }

  private generateEmailTemplate(data: NotificationData, firstName?: string): string {
    const safeTitle = escapeHtml(data.title);
    const safeMsg = escapeHtml(data.message);
    const cta = data.action
      ? `<p><a href="${escapeAttr(data.action.url)}" class="button">${escapeHtml(data.action.label)}</a></p>`
      : '';

    return `<!doctype html>
<html><head><meta charset="utf-8"><title>${safeTitle}</title>
<style>
body{font-family:Arial,sans-serif;line-height:1.6;color:#333}
.header{background:#007bff;color:#fff;padding:20px;text-align:center}
.content{padding:20px}
.footer{background:#f8f9fa;padding:15px;text-align:center;font-size:.9em}
.button{display:inline-block;padding:10px 20px;background:#007bff;color:#fff;text-decoration:none;border-radius:5px}
</style></head>
<body>
  <div class="header"><h1>AutoAssist+</h1></div>
  <div class="content">
    <h2>${safeTitle}</h2>
    ${firstName ? `<p>Hello, ${escapeHtml(firstName)}!</p>` : ''}
    <p>${safeMsg}</p>
    ${cta}
  </div>
  <div class="footer"><p>AutoAssist+ — service and insurance platform</p></div>
</body></html>`;
  }
}

function escapeHtml(s: string) {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
function escapeAttr(s: string) {
  return escapeHtml(s).replace(/'/g, '&#39;');
}
