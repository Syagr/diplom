declare module 'bullmq' {
  export class Worker {
    constructor(name: string, processor: any, opts?: any);
    close(): Promise<void>;
  }

  export class QueueEvents {
    constructor(name: string, opts?: any);
    on(event: string, cb: (...args: any[]) => void): void;
  }
}
