import client from 'prom-client';

// Create a Registry to register the metrics
export const metricsRegistry = new client.Registry();

// Default metrics (process, event loop, memory, etc.)
client.collectDefaultMetrics({ register: metricsRegistry, prefix: 'autoassist_' });

// Optional: simple HTTP request duration histogram
export const httpRequestDuration = new client.Histogram({
  name: 'autoassist_http_request_duration_ms',
  help: 'Duration of HTTP requests in ms',
  labelNames: ['method', 'route', 'status'] as const,
  buckets: [50, 100, 200, 500, 1000, 2000, 5000],
  registers: [metricsRegistry],
});

export function metricsMiddleware() {
  return function (req: any, res: any, next: any) {
    const start = process.hrtime.bigint();
    res.on('finish', () => {
      try {
        const end = process.hrtime.bigint();
        const diffMs = Number(end - start) / 1_000_000;
        const route = (req.route && req.route.path) || req.originalUrl || req.url || 'unknown';
        httpRequestDuration.labels(String(req.method), String(route), String(res.statusCode)).observe(diffMs);
      } catch (_e) {
        // ignore metric errors
      }
    });
    next();
  };
}
