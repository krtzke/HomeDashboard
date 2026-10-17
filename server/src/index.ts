import Fastify from 'fastify';
import fastifyStatic from '@fastify/static';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { openDb } from './db.ts';
import { applySync } from './sync.ts';
import { getSystemStatus } from './system.ts';
import { IcsError, fetchIcs } from './ics.ts';
import { SYNC_TABLES } from '../../shared/src/types.ts';
import type { SyncRequest } from '../../shared/src/types.ts';

const PORT = Number(process.env.PORT ?? 3000);
// Behind Caddy only localhost needs access; set HOST=0.0.0.0 to expose directly.
const HOST = process.env.HOST ?? '127.0.0.1';
const DB_PATH = process.env.DB_PATH ?? fileURLToPath(new URL('../../data/dashboard.db', import.meta.url));
const CLIENT_DIST = fileURLToPath(new URL('../../client/dist', import.meta.url));

const db = openDb(DB_PATH);
const app = Fastify({ logger: { level: process.env.LOG_LEVEL ?? 'info' }, bodyLimit: 5 * 1024 * 1024 });

const syncBodySchema = {
  type: 'object',
  required: ['since', 'changes'],
  properties: {
    since: { type: 'integer', minimum: 0 },
    changes: {
      type: 'array',
      items: {
        type: 'object',
        required: ['table', 'record'],
        properties: {
          table: { type: 'string', enum: [...SYNC_TABLES] },
          record: {
            type: 'object',
            required: ['id', 'updatedAt', 'deleted'],
            properties: {
              id: { type: 'string', minLength: 1, maxLength: 100 },
              updatedAt: { type: 'number' },
              deleted: { type: 'boolean' },
            },
          },
        },
      },
    },
  },
} as const;

app.get('/api/health', async () => ({ ok: true }));

app.get('/api/system', async () => getSystemStatus(DB_PATH));

app.get<{ Querystring: { url: string } }>(
  '/api/ics',
  { schema: { querystring: { type: 'object', required: ['url'], properties: { url: { type: 'string', maxLength: 2000 } } } } },
  async (req, reply) => {
    try {
      const text = await fetchIcs(req.query.url);
      return reply.type('text/calendar; charset=utf-8').send(text);
    } catch (err) {
      if (err instanceof IcsError) return reply.code(err.status).send({ error: err.message });
      throw err;
    }
  },
);

app.post<{ Body: SyncRequest }>('/api/sync', { schema: { body: syncBodySchema } }, async (req) =>
  applySync(db, req.body),
);

if (existsSync(CLIENT_DIST)) {
  await app.register(fastifyStatic, { root: CLIENT_DIST, wildcard: false });
  // SPA fallback: unknown non-API GETs get index.html
  app.setNotFoundHandler((req, reply) => {
    if (req.method === 'GET' && !req.url.startsWith('/api/')) return reply.sendFile('index.html');
    reply.code(404).send({ error: 'Not found' });
  });
} else {
  app.log.warn(`No client build at ${CLIENT_DIST} — run "npm run build" (API only).`);
}

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, async () => {
    await app.close();
    db.close();
    process.exit(0);
  });
}

await app.listen({ port: PORT, host: HOST });
