// services/notification.service.ts
import prisma from '@/utils/prisma.js';
import { logger } from '../libs/logger.js';
import SocketService from './socket.service.js';

// ---- Domain types ----
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

  // ========== Public API ==========

  /**
   * Persist notification and dispatch via requested channels.
   * Records per-channel delivery results.
   */
  async sendNotification(data: NotificationData): Promise<void> {
    // persist base notification first
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
        status: 'SENT', // logical creation status (per-channel statuses live in notificationDelivery)
      },
      select: { id: true },
    });

    // dispatch all channels (independent best-effort)
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

  /**
   * Get user notification preferences (with defaults).
   */
  async getUserPreferences(userId: number): Promise<{
    channels: NotificationChannel[];
    types: string[];
  }> {
    const pref = await prisma.notificationPreference.findUnique({
      where: { userId }, // numeric FK
    });

    return {
      channels: (pref?.enabledChannels as NotificationChannel[]) ?? ['IN_APP'],
      types: pref?.enabledTypes ?? [],
    };
  }

  /**
   * Update user notification preferences (upsert).
   */
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

  /**
   * Mark one notification as read for user (idempotent).
   */
  async markAsRead(notificationId: number, userId: number): Promise<void> {
    await prisma.notification.updateMany({
      where: { id: notificationId, userId },
      data: { readAt: new Date() },
    });
  }

  /**
   * Paginated notifications & counters.
   */
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
        include: {
          order: { select: { id: true, status: true } },
        },
      }),
      prisma.notification.count({ where }),
      prisma.notification.count({ where: { userId, readAt: null } }),
    ]);

    return { notifications, total, unreadCount };
  }

  /**
   * Unread counter for a user
   */
  async getUnreadCount(userId: number): Promise<number> {
  return prisma.notification.count({ where: { userId, readAt: null } });
  }

  /**
   * High-level helper for order-related events; honors client preferences.
   */
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
    // Resolve recipient user for the client (first linked user)
    const recipientUser = await prisma.user.findFirst({ where: { clientId: order.clientId }, select: { id: true } });
    if (!recipientUser) {
      // no linked user to receive notifications
      return;
    }

    const templates: Record<
      Exclude<NotificationType, 'SYSTEM_ALERT' | 'PAYMENT_RECEIVED'>,
      { title: string; message: (o: any) => string }
    > = {
      ORDER_CREATED: {
        title: 'Новая заявка создана',
        message: (o) =>
          customMessage ??
          `Заявка #${o.orderNumber ?? o.id} успешно создана и передана на рассмотрение`,
      },
      ORDER_UPDATED: {
        title: 'Статус заявки изменён',
        message: (o) =>
          customMessage ?? `Заявка #${o.orderNumber ?? o.id} обновлена. Новый статус: ${o.status}`,
      },
      TOW_ASSIGNED: {
        title: 'Эвакуатор назначен',
        message: (o) => customMessage ?? `К заявке #${o.orderNumber ?? o.id} назначен эвакуатор`,
      },
      INSPECTION_COMPLETED: {
        title: 'Осмотр завершён',
        message: (o) => customMessage ?? `Осмотр по заявке #${o.orderNumber ?? o.id} завершён`,
      },
    };

    const tpl = templates[type] ?? {
      title: 'Обновление заявки',
      message: (_o: any) => customMessage ?? 'Статус вашей заявки изменился',
    };

    // client preferences
    const prefs = await this.getUserPreferences(recipientUser.id);
    await this.sendNotification({
      type,
      title: tpl.title,
      message: tpl.message(order),
      priority: type === 'ORDER_CREATED' ? 'HIGH' : 'MEDIUM',
      userId: recipientUser.id,
      orderId,
      channels: prefs.channels,
      action: { label: 'Открыть заявку', url: `/orders/${orderId}` },
    });
  }

  // ========== Private helpers ==========

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

      // mark delivered for this channel
      await prisma.notificationDelivery.create({
        data: {
          notificationId, // numeric FK
          channel,
          status: 'DELIVERED',
          deliveredAt: new Date(),
        },
      });
    } catch (err) {
      // per-channel failure is non-fatal; record and continue
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

    // TODO: integrate real email provider (SES/SendGrid/Mailgun)
    const emailPayload = {
      to: user.email,
      subject: data.title,
      html: this.generateEmailTemplate(data, user.name ?? undefined),
      headers: { 'X-Notification-Type': data.type, 'X-Order-Id': String(data.orderId ?? '') },
    };

    logger.info('Email notification (mock send)', emailPayload);
  }

  // SMS, Telegram and mobile push channels are removed in web/web3-only scope

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
    ${firstName ? `<p>Здравствуйте, ${escapeHtml(firstName)}!</p>` : ''}
    <p>${safeMsg}</p>
    ${cta}
  </div>
  <div class="footer"><p>AutoAssist+ — ваш надёжный помощник на дороге</p></div>
</body></html>`;
  }
}

// ---- tiny escaping helpers for email ----
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
// (no Markdown escaping needed)
