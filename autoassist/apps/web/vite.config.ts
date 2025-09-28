import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    host: true,
    port: 5173,
    proxy: {
      '/s3': {
        target: 'http://127.0.0.1:12002',
        changeOrigin: true,
        secure: false,
        rewrite: (path) => path.replace(/^\/s3/, ''),
        timeout: 60000,
        proxyTimeout: 60000,
        configure: (proxy: any) => {
          proxy.on('error', (err: any, req: any, res: any) => {
            console.error('[vite] proxy /s3 error:', err?.message || err);
            try {
              if (res && !res.headersSent) {
                res.writeHead && res.writeHead(502, { 'Content-Type': 'text/plain' });
                res.end && res.end('Proxy error');
              }
            } catch (e) { /* ignore */ }
          });
        },
      },
      '/api': {
        target: 'http://127.0.0.1:3000',
        changeOrigin: true,
        secure: false,
        // Do not rewrite the /api prefix — backend mounts routes under /api/*
        timeout: 60000,
        proxyTimeout: 60000,
        configure: (proxy: any) => {
          proxy.on('error', (err: any) => {
            console.error('[vite] proxy /api error:', err?.message || err);
          });
        },
      },
      '/socket.io': {
        target: 'http://127.0.0.1:3000',
        changeOrigin: true,
        ws: true,
        secure: false,
        timeout: 60000,
        proxyTimeout: 60000,
        configure: (proxy: any) => {
          proxy.on('error', (err: any, req: any, socket: any) => {
            console.error('[vite] socket proxy error:', err?.message || err);
            try { if (socket && socket.destroy) socket.destroy(); } catch (e) {}
          });
          proxy.on('proxyReq', (proxyReq: any, req: any, res: any) => {
            try { proxyReq.setHeader && proxyReq.setHeader('X-Forwarded-Host', 'localhost:5173'); } catch (e) {}
          });
        },
      },
    }
  },
  build: {
    outDir: 'dist',
    sourcemap: true
  }
})