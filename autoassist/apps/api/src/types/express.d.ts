import 'express-serve-static-core';

declare module 'express-serve-static-core' {
  interface Request {
    rawBody?: string; // для Stripe webhook в raw-парсере
  }
}
import { Request as ExpressRequest } from 'express';
import 'express-serve-static-core';
import type { Server as IOServer } from 'socket.io';

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

declare module 'express-serve-static-core' {
  interface Application {
    get(name: 'io'): IOServer;
    set(name: 'io', val: IOServer): this;
  }
}

export interface AuthenticatedRequest extends ExpressRequest {
  user: {
    id: number;
    email?: string;
    role?: string;
  };
}