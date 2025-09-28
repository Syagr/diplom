import { Server, Socket } from 'socket.io';
import type { ExtendedError } from 'socket.io';
import { Server as HttpServer } from 'http';
import jwt from 'jsonwebtoken';
import { PrismaClient } from '@prisma/client';
import { logger } from '../libs/logger.js';

const prisma = new PrismaClient();
const p: any = prisma;

interface SocketUser {
  id: number;
  email: string;
  role: string;
  name?: string;
}

interface SocketWithUser extends Socket {
  user?: SocketUser;
}

class SocketService {
  private io: Server;
  private connectedUsers: Map<string, SocketWithUser> = new Map();

  constructor(httpServer: HttpServer) {
    this.io = new Server(httpServer, {
      cors: {
        origin: process.env.CORS_ORIGIN || "*",
        methods: ["GET", "POST"]
      }
    });

    this.setupMiddleware();
    this.setupEventHandlers();
  }

  /**
   * Setup authentication middleware
   */
  private setupMiddleware() {
    // socket.io expects a synchronous middleware function that calls next(err?)
    this.io.use((socket: SocketWithUser, next: (err?: ExtendedError) => void) => {
      (async () => {
        const token = socket.handshake.auth.token || socket.handshake.headers.authorization?.replace('Bearer ', '');

          // Require a token for production and development: do not allow unauthenticated dev fallbacks.
          if (!token) {
            throw new Error('No token provided');
          }

          const decoded = jwt.verify(token, process.env.JWT_SECRET || 'secret') as any;

        // Determine a unique identifier from common JWT claim names.
        // Tokens in this project historically used `sub` for subject or `userId`.
        const possibleId = decoded?.userId ?? decoded?.sub ?? decoded?.id;
        const possibleEmail = decoded?.email;
        const possibleWallet = decoded?.walletAddress ?? decoded?.wallet;

        // Build a where clause only with a valid unique field to avoid Prisma errors.
        let user: any = null;
        if (possibleId !== undefined && possibleId !== null) {
          const idNum = Number(possibleId);
          if (!Number.isNaN(idNum)) {
            user = await prisma.user.findUnique({
                where: { id: idNum },
                select: { id: true, email: true, role: true }
              });
          }
        }

        if (!user && possibleEmail) {
          user = await prisma.user.findUnique({
            where: { email: String(possibleEmail) },
            select: { id: true, email: true, role: true }
          });
        }

        if (!user && possibleWallet) {
          user = await prisma.user.findUnique({
            where: { walletAddress: String(possibleWallet) },
            select: { id: true, email: true, role: true }
          });
        }

        if (!user) {
          throw new Error('User not found');
        }

        socket.user = {
          id: user.id,
          email: user.email,
          role: user.role
        };
      })()
        .then(() => next())
        .catch((err) => {
          logger.error('Socket authentication failed', {
            error: err instanceof Error ? err.message : String(err),
            socketId: (socket as any).id,
            // include a short snippet of decoded token claims when available
            tokenSnippet: (() => {
              try { const d = jwt.decode(socket.handshake.auth.token || socket.handshake.headers.authorization?.replace('Bearer ', '')); return typeof d === 'object' ? { sub: (d as any).sub, userId: (d as any).userId, email: (d as any).email } : null } catch(e) { return null }
            })()
          });
          next({ message: 'Authentication failed' } as ExtendedError);
        });
    });
  }

  /**
   * Setup event handlers
   */
  private setupEventHandlers() {
    this.io.on('connection', (socket: SocketWithUser) => {
      logger.info('User connected via WebSocket', {
        userId: socket.user?.id,
        email: socket.user?.email,
        socketId: socket.id
      });

      // Store connected user
      if (socket.user) {
        this.connectedUsers.set(String(socket.user.id), socket);
        
        // Join user-specific room
  socket.join(`user:${socket.user.id}`);
        
        // Join role-based room
        socket.join(`role:${socket.user.role}`);
      }

      // Handle order subscriptions
      socket.on('subscribe:order', (orderId: string) => {
        socket.join(`order:${orderId}`);
        logger.debug('User subscribed to order updates', {
          userId: socket.user?.id,
          orderId,
          socketId: socket.id
        });
      });

      socket.on('unsubscribe:order', (orderId: string) => {
        socket.leave(`order:${orderId}`);
        logger.debug('User unsubscribed from order updates', {
          userId: socket.user?.id,
          orderId,
          socketId: socket.id
        });
      });

      // Handle dashboard subscriptions
      socket.on('subscribe:dashboard', () => {
        socket.join('dashboard');
        logger.debug('User subscribed to dashboard updates', {
          userId: socket.user?.id,
          socketId: socket.id
        });
      });

      // Handle live inspection
      socket.on('subscribe:inspection', (inspectionId: string) => {
        socket.join(`inspection:${inspectionId}`);
        logger.debug('User subscribed to inspection updates', {
          userId: socket.user?.id,
          inspectionId,
          socketId: socket.id
        });
      });

      // Handle tow tracking
      socket.on('subscribe:tow', (towRequestId: string) => {
        socket.join(`tow:${towRequestId}`);
        logger.debug('User subscribed to tow updates', {
          userId: socket.user?.id,
          towRequestId,
          socketId: socket.id
        });
      });

      // Handle chat functionality
      socket.on('join:chat', (chatId: string) => {
        socket.join(`chat:${chatId}`);
        logger.debug('User joined chat room', {
          userId: socket.user?.id,
          chatId,
          socketId: socket.id
        });
      });

      socket.on('send:message', async (data: { chatId: string; message: string; type?: string }) => {
        try {
          // Save message to database
          const message = await p.message.create({
            data: {
              chatId: data.chatId,
              senderId: socket.user!.id,
              content: data.message,
              type: data.type || 'text'
            },
            include: {
              sender: {
                select: {
                  id: true,
                  name: true,
                  email: true
                }
              }
            }
          });

          // Emit to chat room
          this.io.to(`chat:${data.chatId}`).emit('new:message', {
            id: message.id,
            chatId: message.chatId,
            content: message.content,
            type: message.type,
            createdAt: message.createdAt,
            sender: {
              id: message.sender.id,
              name: message.sender.name,
              email: message.sender.email
            }
          });

          logger.debug('Message sent', {
            userId: socket.user?.id,
            chatId: data.chatId,
            messageId: message.id
          });
        } catch (error) {
          logger.error('Failed to send message', {
            userId: socket.user?.id,
            chatId: data.chatId,
            error: error instanceof Error ? error.message : String(error)
          });
          socket.emit('error', { message: 'Failed to send message' });
        }
      });

      // Handle location updates (for tow drivers)
      socket.on('update:location', async (data: { latitude: number; longitude: number; towRequestId?: string }) => {
        try {
          if (socket.user?.role === 'DRIVER' && data.towRequestId) {
            // Update tow request with current location (coerce id to number)
            await p.towRequest.update({
              where: { id: Number(data.towRequestId) },
              data: {
                // store location in a json field or as text depending on schema
                // use 'metadata' if exists, otherwise use 'trackingUrl' as placeholder
                metadata: JSON.stringify({
                  currentLocation: {
                    latitude: data.latitude,
                    longitude: data.longitude,
                    timestamp: new Date()
                  }
                })
              }
            });

            // Emit location update to order subscribers
            this.io.to(`tow:${data.towRequestId}`).emit('tow:location', {
              towRequestId: data.towRequestId,
              location: {
                latitude: data.latitude,
                longitude: data.longitude
              },
              timestamp: new Date()
            });

            logger.debug('Driver location updated', {
              driverId: socket.user.id,
              towRequestId: data.towRequestId,
              location: `${data.latitude}, ${data.longitude}`
            });
          }
        } catch (error) {
          logger.error('Failed to update location', {
            userId: socket.user?.id,
            error: error instanceof Error ? error.message : String(error)
          });
        }
      });

      // Handle typing indicators
      socket.on('typing:start', (chatId: string) => {
        socket.to(`chat:${chatId}`).emit('user:typing', {
          userId: socket.user?.id,
          name: socket.user?.name,
          chatId
        });
      });

      socket.on('typing:stop', (chatId: string) => {
        socket.to(`chat:${chatId}`).emit('user:stopped_typing', {
          userId: socket.user?.id,
          chatId
        });
      });

      // Handle disconnection
      socket.on('disconnect', () => {
        if (socket.user) {
          this.connectedUsers.delete(String(socket.user.id));
        }
        
        logger.info('User disconnected from WebSocket', {
          userId: socket.user?.id,
          socketId: socket.id
        });
      });
    });
  }

  /**
   * Emit event to specific room
   */
  public emitToRoom(room: string, event: string, data: any) {
    this.io.to(room).emit(event, data);
    logger.debug('Event emitted to room', { room, event });
  }

  /**
   * Emit event to specific user
   */
  public emitToUser(userId: string | number, event: string, data: any) {
    const uid = String(userId);
    this.io.to(`user:${uid}`).emit(event, data);
    logger.debug('Event emitted to user', { userId: uid, event });
  }

  /**
   * Emit event to all users with specific role
   */
  public emitToRole(role: string, event: string, data: any) {
    this.io.to(`role:${role}`).emit(event, data);
    logger.debug('Event emitted to role', { role, event });
  }

  /**
   * Emit order status update
   */
  public emitOrderUpdate(orderId: string, data: any) {
    this.emitToRoom(`order:${orderId}`, 'order:updated', {
      orderId,
      ...data,
      timestamp: new Date()
    });
  }

  /**
   * Emit dashboard metrics update
   */
  public emitDashboardUpdate(data: any) {
    this.emitToRoom('dashboard', 'dashboard:updated', {
      ...data,
      timestamp: new Date()
    });
  }

  /**
   * Emit inspection update
   */
  public emitInspectionUpdate(inspectionId: string, data: any) {
    this.emitToRoom(`inspection:${inspectionId}`, 'inspection:updated', {
      inspectionId,
      ...data,
      timestamp: new Date()
    });
  }

  /**
   * Emit tow status update
   */
  public emitTowUpdate(towRequestId: string, data: any) {
    this.emitToRoom(`tow:${towRequestId}`, 'tow:updated', {
      towRequestId,
      ...data,
      timestamp: new Date()
    });
  }

  /**
   * Emit notification to user
   */
  public emitNotification(userId: string | number, notification: {
    type: 'INFO' | 'SUCCESS' | 'WARNING' | 'ERROR';
    title: string;
    message: string;
    action?: {
      label: string;
      url: string;
    };
  }) {
    this.emitToUser(userId, 'notification', {
      ...notification,
      id: `notif_${Date.now()}`,
      timestamp: new Date()
    });
  }

  /**
   * Get online users count
   */
  public getOnlineUsersCount(): number {
    return this.connectedUsers.size;
  }

  /**
   * Get online users by role
   */
  public getOnlineUsersByRole(role: string): SocketUser[] {
    return Array.from(this.connectedUsers.values())
      .filter(socket => socket.user?.role === role)
      .map(socket => socket.user!)
      .filter(Boolean);
  }

  /**
   * Check if user is online
   */
  public isUserOnline(userId: string | number): boolean {
    return this.connectedUsers.has(String(userId));
  }

  /**
   * Broadcast system announcement
   */
  public broadcastAnnouncement(announcement: {
    type: 'MAINTENANCE' | 'UPDATE' | 'NEWS';
    title: string;
    message: string;
    priority: 'LOW' | 'MEDIUM' | 'HIGH';
  }) {
    this.io.emit('system:announcement', {
      ...announcement,
      id: `ann_${Date.now()}`,
      timestamp: new Date()
    });

    logger.info('System announcement broadcasted', {
      type: announcement.type,
      priority: announcement.priority
    });
  }
}

export default SocketService;