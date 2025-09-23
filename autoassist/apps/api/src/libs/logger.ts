export const logger = {
  info: (msg: string, meta?: any) => console.info('[INFO]', msg, meta ?? ''),
  warn: (msg: string, meta?: any) => console.warn('[WARN]', msg, meta ?? ''),
  error: (msg: string, meta?: any) => console.error('[ERROR]', msg, meta ?? ''),
  debug: (msg: string, meta?: any) => console.debug('[DEBUG]', msg, meta ?? ''),
};

export default logger;
