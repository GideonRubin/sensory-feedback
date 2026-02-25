/**
 * Vite dev-server middleware that handles /api/blob/* routes locally.
 * In production these are served by Vercel serverless functions (api/ folder).
 */
import type { Plugin } from 'vite';
import { put, list, del } from '@vercel/blob';
import { config } from 'dotenv';
import { resolve } from 'path';

function readBody(req: import('http').IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (chunk: Buffer) => { data += chunk.toString(); });
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}

export function apiBlobPlugin(): Plugin {
  return {
    name: 'api-blob-dev',
    configureServer(server) {
      // Load .env into process.env (Vite only auto-exposes VITE_ prefixed vars)
      config({ path: resolve(server.config.root, '.env') });

      server.middlewares.use(async (req, res, next) => {
        const url = req.url ?? '';

        // Only handle /api/blob/* routes
        if (!url.startsWith('/api/blob/')) return next();

        const token = process.env.BLOB_READ_WRITE_TOKEN;
        if (!token) {
          res.statusCode = 500;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ error: 'BLOB_READ_WRITE_TOKEN not set in .env' }));
          return;
        }

        const route = url.split('?')[0]; // strip query string
        const parsedUrl = new URL(url, `http://${req.headers.host}`);

        try {
          // ── UPLOAD ──────────────────────────────────────────
          if (route === '/api/blob/upload' && req.method === 'POST') {
            const body = JSON.parse(await readBody(req));
            const { filename, data } = body as { filename: string; data: string };

            if (!filename || !data) {
              res.statusCode = 400;
              res.setHeader('Content-Type', 'application/json');
              res.end(JSON.stringify({ error: 'Missing filename or data' }));
              return;
            }

            const blob = await put(filename, data, {
              access: 'public',
              contentType: 'text/csv',
              token,
            });

            res.statusCode = 200;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify(blob));
            return;
          }

          // ── LIST ────────────────────────────────────────────
          if (route === '/api/blob/list' && req.method === 'GET') {
            const cursor = parsedUrl.searchParams.get('cursor') || undefined;
            const result = await list({ cursor, limit: 100, token });

            res.statusCode = 200;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify(result));
            return;
          }

          // ── DOWNLOAD ────────────────────────────────────────
          if (route === '/api/blob/download' && req.method === 'GET') {
            const blobUrl = parsedUrl.searchParams.get('url');
            if (!blobUrl) {
              res.statusCode = 400;
              res.setHeader('Content-Type', 'application/json');
              res.end(JSON.stringify({ error: 'Missing blob URL' }));
              return;
            }

            const response = await fetch(blobUrl);
            if (!response.ok) {
              res.statusCode = response.status;
              res.setHeader('Content-Type', 'application/json');
              res.end(JSON.stringify({ error: 'Failed to fetch blob' }));
              return;
            }

            const data = await response.text();
            res.statusCode = 200;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ data }));
            return;
          }

          // ── DELETE ──────────────────────────────────────────
          if (route === '/api/blob/delete' && req.method === 'DELETE') {
            const body = JSON.parse(await readBody(req));
            const { url: blobUrl } = body as { url: string };

            if (!blobUrl) {
              res.statusCode = 400;
              res.setHeader('Content-Type', 'application/json');
              res.end(JSON.stringify({ error: 'Missing blob URL' }));
              return;
            }

            await del(blobUrl, { token });

            res.statusCode = 200;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ success: true }));
            return;
          }

          // Unknown sub-route
          res.statusCode = 404;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ error: 'Not found' }));
        } catch (error) {
          console.error('API blob dev error:', error);
          res.statusCode = 500;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ error: 'Internal server error' }));
        }
      });
    },
  };
}
