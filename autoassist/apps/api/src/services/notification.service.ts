import { PrismaClient } from '@prisma/client';
import { logger } from '../libs/logger.js';
import SocketService from './socket.service.js';

const prisma = new PrismaClient();
const p: any = prisma;

export interface NotificationData {
  type: 'ORDER_CREATED' | 'ORDER_UPDATED' | 'PAYMENT_RECEIVED' | 'TOW_ASSIGNED' | 'INSPECTION_COMPLETED' | 'SYSTEM_ALERT';
  title: string;
  message: string;
  priority: 'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT';
  userId: number;
  orderId?: number;
  metadata?: Record<string, any>;
  channels: NotificationChannel[];
  action?: {
    label: string;
    url: string;
  };
}

export type NotificationChannel = 'IN_APP' | 'EMAIL' | 'SMS' | 'TELEGRAM' | 'PUSH';

class NotificationService {
  private socketService?: SocketService;

  constructor() {}

  /**
   * Set socket service for real-time notifications
   */
  setSocketService(socketService: SocketService) {
    this.socketService = socketService;
  }

  /**
   * Send notification through specified channels
   */
  async sendNotification(data: NotificationData): Promise<void> {
    try {
      // Save notification to database
  const notification = await p.notification.create({
        data: {
          type: data.type,
          title: data.title,
          message: data.message,
          priority: data.priority,
          userId: data.userId,
          orderId: data.orderId,
          metadata: data.metadata || {},
          channels: data.channels,
          action: data.action,
          status: 'SENT'
        }
      });

      // Send through each channel
      const promises = data.channels.map(channel => 
        this.sendThroughChannel(channel, data, notification.id)
      );

      await Promise.allSettled(promises);

      logger.info('Notification sent', {
        notificationId: notification.id,
        userId: data.userId,
        type: data.type,
        channels: data.channels
      });

    } catch (error) {
      logger.error('Failed to send notification', {
        userId: data.userId,
        type: data.type,
        error: error instanceof Error ? error.message : String(error)
      });
      throw error;
    }
  }

  /**
   * Send notification through specific channel
   */
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
        case 'SMS':
          await this.sendSMSNotification(data);
          break;
        case 'TELEGRAM':
          await this.sendTelegramNotification(data);
          break;
        case 'PUSH':
          await this.sendPushNotification(data);
          break;
      }

      // Update delivery status
  await p.notificationDelivery.create({
        data: {
          notificationId: String(notificationId),
          channel,
          status: 'DELIVERED',
          deliveredAt: new Date()
        }
      });

    } catch (error) {
      // Log delivery failure
  await p.notificationDelivery.create({
        data: {
          notificationId: String(notificationId),
          channel,
          status: 'FAILED',
          error: error instanceof Error ? error.message : String(error)
        }
      });

      logger.error(`Failed to send ${channel} notification`, {
        notificationId,
        userId: data.userId,
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }

  /**
   * Send in-app notification via WebSocket
   */
  private async sendInAppNotification(data: NotificationData): Promise<void> {
    if (!this.socketService) {
      throw new Error('Socket service not initialized');
    }

    this.socketService.emitNotification(data.userId, {
      type: this.mapPriorityToType(data.priority),
      title: data.title,
      message: data.message,
      action: data.action
    });
  }

  /**
   * Send email notification
   */
  private async sendEmailNotification(data: NotificationData): Promise<void> {
    // Get user email
  const user = await p.user.findUnique({
      where: { id: data.userId },
      select: { email: true, name: true }
    });

    if (!user?.email) {
      throw new Error('User email not found');
    }

    // TODO: Implement email service (SendGrid, AWS SES, etc.)
    const emailData = {
      to: user.email,
      subject: data.title,
  html: this.generateEmailTemplate(data, user.name || user.email),
      metadata: {
        notificationType: data.type,
        userId: data.userId,
        orderId: data.orderId
      }
    };

    // Mock email sending
    logger.info('Email notification would be sent', emailData);
  }

  /**
   * Send SMS notification
   */
  private async sendSMSNotification(data: NotificationData): Promise<void> {
    // Get user phone
    const user = await prisma.user.findUnique({
      where: { id: data.userId },
      select: { phone: true }
    });

    if (!user?.phone) {
      throw new Error('User phone not found');
    }

    // TODO: Implement SMS service (Twilio, etc.)
    const smsData = {
      to: user.phone,
      body: `${data.title}\n${data.message}`,
      metadata: {
        notificationType: data.type,
        userId: data.userId
      }
    };

    // Mock SMS sending
    logger.info('SMS notification would be sent', smsData);
  }

  /**
   * Send Telegram notification
   */
  private async sendTelegramNotification(data: NotificationData): Promise<void> {
    // Get user Telegram chat ID
  const userTelegram = await p.userTelegram.findUnique({
      where: { userId: data.userId }
    });

    if (!userTelegram?.chatId) {
      throw new Error('User Telegram chat ID not found');
    }

    // TODO: Implement Telegram bot API
    const telegramData = {
      chatId: userTelegram.chatId,
      text: `*${data.title}*\n\n${data.message}`,
      parseMode: 'Markdown',
      metadata: {
        notificationType: data.type,
        userId: data.userId
      }
    };

    // Mock Telegram sending
    logger.info('Telegram notification would be sent', telegramData);
  }

  /**
   * Send push notification
   */
  private async sendPushNotification(data: NotificationData): Promise<void> {
    // Get user device tokens
  const devices = await p.userDevice.findMany({
      where: {
        userId: data.userId,
        isActive: true
      }
    });

    if (devices.length === 0) {
      throw new Error('No active devices found for user');
    }

    // TODO: Implement push notification service (FCM, APNs)
    const pushData = {
      tokens: devices.map(d => d.pushToken).filter(Boolean),
      title: data.title,
      body: data.message,
      data: {
        type: data.type,
        orderId: data.orderId,
        action: data.action
      }
    };

    // Mock push notification sending
    logger.info('Push notification would be sent', pushData);
  }

  /**
   * Get user notification preferences
   */
  async getUserPreferences(userId: number): Promise<{
    channels: NotificationChannel[];
    types: string[];
  }> {
  const preferences = await p.notificationPreference.findUnique({
      where: { userId: String(userId) }
    });

    return {
      channels: preferences?.enabledChannels as NotificationChannel[] || ['IN_APP'],
      types: preferences?.enabledTypes || []
    };
  }

  /**
   * Update user notification preferences
   */
  async updateUserPreferences(
    userId: number,
    preferences: {
      channels?: NotificationChannel[];
      types?: string[];
    }
  ): Promise<void> {
  await p.notificationPreference.upsert({
      where: { userId: String(userId) },
      update: {
        enabledChannels: preferences.channels,
        enabledTypes: preferences.types
      },
      create: {
        userId: String(userId),
        enabledChannels: preferences.channels || ['IN_APP'],
        enabledTypes: preferences.types || []
      }
    });

    logger.info('User notification preferences updated', {
      userId,
      preferences
    });
  }

  /**
   * Mark notification as read
   */
  async markAsRead(notificationId: number, userId: number): Promise<void> {
  await p.notification.updateMany({
      where: {
        id: notificationId,
        userId: userId
      },
      data: {
        readAt: new Date()
      }
    });
  }

  /**
   * Get user notifications with pagination
   */
  async getUserNotifications(
    userId: number,
    options: {
      page?: number;
      limit?: number;
      unreadOnly?: boolean;
      type?: string;
    } = {}
  ): Promise<{
    notifications: any[];
    total: number;
    unreadCount: number;
  }> {
    const { page = 1, limit = 20, unreadOnly = false, type } = options;
    const skip = (page - 1) * limit;

    const where = {
      userId,
      ...(unreadOnly && { readAt: null }),
      ...(type && { type })
    } as any;

    const [notifications, total, unreadCount] = await Promise.all([
  p.notification.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
        include: {
          order: {
            select: {
              id: true,
              status: true
            }
          }
        }
      }),
  p.notification.count({ where }),
  p.notification.count({
        where: { userId, readAt: null }
      })
    ]);

    return {
      notifications,
      total,
      unreadCount
    };
  }

  /**
   * Send order-related notifications
   */
  async sendOrderNotification(
    type: NotificationData['type'],
    orderId: string,
    customMessage?: string
  ): Promise<void> {
  const order = await p.order.findUnique({
      where: { id: orderId },
      include: {
        client: true,
        assignedTo: true
      }
    });

    if (!order) {
      throw new Error('Order not found');
    }

    const messages = {
      ORDER_CREATED: {
        title: 'Новое заявление создано',
        message: customMessage || `Заявление #${order.orderNumber} успешно создано и передано на рассмотрение`
      },
      ORDER_UPDATED: {
        title: 'Статус заявления изменен',
        message: customMessage || `Заявление #${order.orderNumber} обновлено. Новый статус: ${order.status}`
      },
      TOW_ASSIGNED: {
        title: 'Эвакуатор назначен',
        message: customMessage || `К заявлению #${order.orderNumber} назначен эвакуатор`
      },
      INSPECTION_COMPLETED: {
        title: 'Осмотр завершен',
        message: customMessage || `Осмотр по заявлению #${order.orderNumber} завершен`
      }
    };

    const { title, message } = messages[type] || {
      title: 'Обновление заявления',
      message: customMessage || 'Статус вашего заявления изменился'
    };

    // Get user preferences
    const preferences = await this.getUserPreferences(order.clientId);

    await this.sendNotification({
      type,
      title,
      message,
      priority: type === 'ORDER_CREATED' ? 'HIGH' : 'MEDIUM',
      userId: order.clientId,
      orderId: Number(orderId),
      channels: preferences.channels,
      action: {
        label: 'Просмотреть заявление',
        url: `/orders/${orderId}`
      }
    });

    // Also notify assigned employee if exists
    if (order.assignedToId && order.assignedToId !== order.clientId) {
      await this.sendNotification({
        type,
        title: `${title} (Назначено вам)`,
        message,
        priority: 'MEDIUM',
        userId: order.assignedToId,
        orderId: Number(orderId),
        channels: ['IN_APP'],
        action: {
          label: 'Просмотреть заявление',
          url: `/orders/${orderId}`
        }
      });
    }
  }

  /**
   * Helper methods
   */
  private mapPriorityToType(priority: string): 'INFO' | 'SUCCESS' | 'WARNING' | 'ERROR' {
    switch (priority) {
      case 'LOW': return 'INFO';
      case 'MEDIUM': return 'SUCCESS';
      case 'HIGH': return 'WARNING';
      case 'URGENT': return 'ERROR';
      default: return 'INFO';
    }
  }

  private generateEmailTemplate(data: NotificationData, firstName?: string): string {
    return `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <title>${data.title}</title>
        <style>
          body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
          .header { background: #007bff; color: white; padding: 20px; text-align: center; }
          .content { padding: 20px; }
          .footer { background: #f8f9fa; padding: 15px; text-align: center; font-size: 0.9em; }
          .button { display: inline-block; padding: 10px 20px; background: #007bff; color: white; text-decoration: none; border-radius: 5px; }
        </style>
      </head>
      <body>
        <div class="header">
          <h1>AutoAssist+</h1>
        </div>
        <div class="content">
          <h2>${data.title}</h2>
          ${firstName ? `<p>Здравствуйте, ${firstName}!</p>` : ''}
          <p>${data.message}</p>
          ${data.action ? `<p><a href="${data.action.url}" class="button">${data.action.label}</a></p>` : ''}
        </div>
        <div class="footer">
          <p>AutoAssist+ - ваш надежный помощник на дороге</p>
        </div>
      </body>
      </html>
    `;
  }
}

export default NotificationService;