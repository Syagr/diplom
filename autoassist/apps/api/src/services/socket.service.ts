// services/socket.service.ts
import { Server, Socket } from 'socket.io';
import type { ExtendedError } from 'socket.io';
import { Server as HttpServer } from 'http';
import jwt from 'jsonwebtoken';
import type { JwtPayload } from 'jsonwebtoken';
import { logger } from '../libs/logger.js';
import prisma from '@/utils/prisma.js';

type Role = string;

interface SocketUser {
  id: number;
  email: string | null;
  role: Role;
  name?: string | null;
}

interface AuthedSocket extends Socket {
  user?: SocketUser;
}

const ROOMS = {
  user: (id: string | number) => `user:${id}`,
  role: (role: string) => `role:${role}`,
  order: (id: string | number) => `order:${id}`,
  dashboard: 'dashboard',
  inspection: (id: string | number) => `inspection:${id}`,
  tow: (id: string | number) => `tow:${id}`,
  chat: (id: string | number) => `chat:${id}`,
} as const;

function extractBearer(authHeader?: string): string | undefined {
  if (!authHeader) return undefined;
  const m = authHeader.match(/^Bearer\s+(.+)$/i);
  return m?.[1];
}

function safeNumber(n: unknown): number | null {
  const v = Number(n);
  return Number.isFinite(v) ? v : null;
}

function isNonEmptyString(v: unknown): v is string {
  return typeof v === 'string' && v.length > 0;
}

export default class SocketService {
  private io: Server;
  private connectedUsers = new Map<string, AuthedSocket>();

  constructor(httpServer: HttpServer) {
    this.io = new Server(httpServer, {
      cors: {
        origin: process.env.CORS_ORIGIN || '*',
        methods: ['GET', 'POST'],
      },
    });

    this.setupMiddleware();
    this.setupEventHandlers();
  }

  // ---------- Auth middleware ----------
  private setupMiddleware() {
    this.io.use((socket: AuthedSocket, next: (err?: ExtendedError) => void) => {
      (async () => {
        const headerToken = extractBearer(socket.handshake.headers.authorization as string | undefined);
        const authToken = (socket.handshake.auth as any)?.token as string | undefined;
        const token = headerToken || authToken;

        if (!token) throw new Error('No token provided');

        const secret = process.env.JWT_SECRET || 'secret';
        let decoded: JwtPayload | string;
        try {
          decoded = jwt.verify(token, secret, {
            // можно зафиксировать алгоритмы, если нужно: algorithms: ['HS256']
            ignoreExpiration: false,
          });
        } catch (e: any) {
          throw new Error(`JWT verify failed: ${e?.message || 'invalid'}`);
        }

        const claims = typeof decoded === 'string' ? {} : decoded;
        const idFromClaims = claims['userId'] ?? claims['sub'] ?? claims['id'];
        const emailFromClaims = claims['email'];
        const walletFromClaims = (claims as any)?.walletAddress ?? (claims as any)?.wallet;

  let user = null as null | { id: number; email: string | null; role: Role; name: string | null };

        // try by id → email → wallet (строгое приведение типов)
        const idNum = safeNumber(idFromClaims);
        if (idNum) {
          user = (await prisma.user.findUnique({
            where: { id: idNum },
            select: { id: true, email: true, role: true, name: true },
          })) as any;
        }
        if (!user && isNonEmptyString(emailFromClaims)) {
          user = (await prisma.user.findUnique({
            where: { email: emailFromClaims },
            select: { id: true, email: true, role: true, name: true },
          })) as any;
        }
        if (!user && isNonEmptyString(walletFromClaims)) {
          user = (await prisma.user.findFirst({
            where: { walletAddress: walletFromClaims },
            select: { id: true, email: true, role: true, name: true },
          })) as any;
        }
        if (!user) throw new Error('User not found');

        socket.user = { id: user.id, email: user.email, role: user.role, name: user.name };
      })()
        .then(() => next())
        .catch((err) => {
          // Запишем короткий сниппет токена для дебага (без секрета)
          let snippet: any = null;
          try {
            const raw = (socket.handshake.auth as any)?.token || (socket.handshake.headers.authorization as string | undefined);
            const t = raw ? (extractBearer(raw) ?? raw) : undefined;
            const d = t ? jwt.decode(t) : null;
            snippet = typeof d === 'object' && d ? { sub: (d as any).sub, userId: (d as any).userId, email: (d as any).email, exp: (d as any).exp } : null;
          } catch (_e) {
            // ignore decode errors
            void 0;
          }

          logger.error('Socket authentication failed', {
            error: err instanceof Error ? err.message : String(err),
            socketId: (socket as any).id,
            tokenSnippet: snippet,
          });
          next({ message: 'Authentication failed' } as ExtendedError);
        });
    });
  }

  // ---------- Event handlers ----------
  private setupEventHandlers() {
    this.io.on('connection', (socket: AuthedSocket) => {
      logger.info('WS connected', { userId: socket.user?.id, email: socket.user?.email, sid: socket.id });

      // связываем юзера с сокетом и подписываем на дефолтные комнаты
      if (socket.user) {
        const id = String(socket.user.id);
        this.connectedUsers.set(id, socket);
        socket.join(ROOMS.user(id));
        socket.join(ROOMS.role(String(socket.user.role)));
      }

      // --- subscriptions ---
      socket.on('subscribe:order', (orderId: string | number) => {
        if (!isNonEmptyString(String(orderId))) return;
        socket.join(ROOMS.order(orderId));
        logger.debug('subscribe:order', { userId: socket.user?.id, orderId, sid: socket.id });
      });

      socket.on('unsubscribe:order', (orderId: string | number) => {
        socket.leave(ROOMS.order(orderId));
        logger.debug('unsubscribe:order', { userId: socket.user?.id, orderId, sid: socket.id });
      });

      socket.on('subscribe:dashboard', () => {
        socket.join(ROOMS.dashboard);
        logger.debug('subscribe:dashboard', { userId: socket.user?.id, sid: socket.id });
      });

      socket.on('subscribe:inspection', (inspectionId: string | number) => {
        if (!isNonEmptyString(String(inspectionId))) return;
        socket.join(ROOMS.inspection(inspectionId));
        logger.debug('subscribe:inspection', { userId: socket.user?.id, inspectionId, sid: socket.id });
      });

      socket.on('subscribe:tow', (towRequestId: string | number) => {
        if (!isNonEmptyString(String(towRequestId))) return;
        socket.join(ROOMS.tow(towRequestId));
        logger.debug('subscribe:tow', { userId: socket.user?.id, towRequestId, sid: socket.id });
      });

      socket.on('join:chat', (chatId: string | number) => {
        if (!isNonEmptyString(String(chatId))) return;
        socket.join(ROOMS.chat(chatId));
        logger.debug('join:chat', { userId: socket.user?.id, chatId, sid: socket.id });
      });

      // Chat/message and live location features are out-of-scope here; keep events minimal to avoid schema mismatches.

      // --- typing indicators ---
      socket.on('typing:start', (chatId: string | number) => {
        if (!isNonEmptyString(String(chatId))) return;
        socket.to(ROOMS.chat(chatId)).emit('user:typing', { userId: socket.user?.id, name: socket.user?.name, chatId });
      });

      socket.on('typing:stop', (chatId: string | number) => {
        if (!isNonEmptyString(String(chatId))) return;
        socket.to(ROOMS.chat(chatId)).emit('user:stopped_typing', { userId: socket.user?.id, chatId });
      });

      // --- disconnect ---
      socket.on('disconnect', () => {
        if (socket.user) this.connectedUsers.delete(String(socket.user.id));
        logger.info('WS disconnected', { userId: socket.user?.id, sid: socket.id });
      });
    });
  }

  // ---------- Emit helpers ----------
  public emitToRoom(room: string, event: string, data: any) {
    this.io.to(room).emit(event, data);
    logger.debug('ws:emit room', { room, event });
  }

  public emitToUser(userId: string | number, event: string, data: any) {
    const uid = String(userId);
    this.io.to(ROOMS.user(uid)).emit(event, data);
    logger.debug('ws:emit user', { userId: uid, event });
  }

  public emitToRole(role: string, event: string, data: any) {
    this.io.to(ROOMS.role(role)).emit(event, data);
    logger.debug('ws:emit role', { role, event });
  }

  public emitOrderUpdate(orderId: string | number, data: any) {
    this.emitToRoom(ROOMS.order(orderId), 'order:updated', { orderId, ...data, timestamp: new Date() });
  }

  public emitDashboardUpdate(data: any) {
    this.emitToRoom(ROOMS.dashboard, 'dashboard:updated', { ...data, timestamp: new Date() });
  }

  public emitInspectionUpdate(inspectionId: string | number, data: any) {
    this.emitToRoom(ROOMS.inspection(inspectionId), 'inspection:updated', { inspectionId, ...data, timestamp: new Date() });
  }

  public emitTowUpdate(towRequestId: string | number, data: any) {
    this.emitToRoom(ROOMS.tow(towRequestId), 'tow:updated', { towRequestId, ...data, timestamp: new Date() });
  }

  public emitNotification(
    userId: string | number,
    notification: {
      type: 'INFO' | 'SUCCESS' | 'WARNING' | 'ERROR';
      title: string;
      message: string;
      action?: { label: string; url: string };
    }
  ) {
    this.emitToUser(userId, 'notification', { ...notification, id: `notif_${Date.now()}`, timestamp: new Date() });
  }

  // ---------- Presence ----------
  public getOnlineUsersCount(): number {
    return this.connectedUsers.size;
  }

  public getOnlineUsersByRole(role: string): SocketUser[] {
    return Array.from(this.connectedUsers.values())
      .map((s) => s.user)
      .filter((u): u is SocketUser => !!u && u.role === role);
  }

  public isUserOnline(userId: string | number): boolean {
    return this.connectedUsers.has(String(userId));
  }

  // ---------- Broadcast ----------
  public broadcastAnnouncement(announcement: {
    type: 'MAINTENANCE' | 'UPDATE' | 'NEWS';
    title: string;
    message: string;
    priority: 'LOW' | 'MEDIUM' | 'HIGH';
  }) {
    this.io.emit('system:announcement', { ...announcement, id: `ann_${Date.now()}`, timestamp: new Date() });
    logger.info('system:announcement', { type: announcement.type, priority: announcement.priority });
  }
}
