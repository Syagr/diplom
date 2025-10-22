import type { Request as ExpressRequest } from 'express';
import type { Server as IOServer } from 'socket.io';
import 'express-serve-static-core';

// 1) Доп. поля на Request
declare module 'express-serve-static-core' {
  interface Request {
    rawBody?: string; // для Stripe webhook в raw-парсере
    user?: {
      id: number;
      email?: string;
      role?: string;
      ver?: number;
    };
  }
}

// 2) Дублируем user через глобальное пространство имён Express (как у тебя было)
declare global {
  namespace Express {
    interface Request {
      user?: {
        id: number;
        email?: string;
        role?: string;
        ver?: number;
      };
    }
  }
}

// 3) get/set для socket.io на приложении
declare module 'express-serve-static-core' {
  interface Application {
    get(name: 'io'): IOServer;
    set(name: 'io', val: IOServer): this;

    // не ломаем сигнатуры для прочих ключей
    get(name: string): any;
    set(name: string, val: any): this;
  }
}

// 4) Удобный тип для роутов, где user обязателен
export interface AuthenticatedRequest extends ExpressRequest {
  user: {
    id: number;
    email?: string;
    role?: string;
  };
}

export {};
