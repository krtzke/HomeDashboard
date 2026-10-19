import Fastify from 'fastify';
import fastifyStatic from '@fastify/static';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDb } from './db.ts';
import { applySync } from './sync.ts';
import { MIN_PIN_LENGTH, loadSecret, registerAuth } from './auth.ts';
import { getSystemStatus } from './system.ts';
import { IcsError, fetchIcs } from './ics.ts';
import { checkOnline, isValidHost, parseMac, sendWol } from './wol.ts';
import { SYNC_TABLES } from '../../shared/src/types.ts';
import type { SyncRequest } from '../../shared/src/types.ts';

const PORT = Number(process.env.PORT ?? 3000);
// Behind Caddy only localhost needs access; set HOST=0.0.0.0 to expose directly.
const HOST = process.env.HOST ?? '127.0.0.1';
const DB_PATH = process.env.DB_PATH ?? fileURLToPath(new URL('../../data/dashboard.db', import.meta.url));
const CLIENT_DIST = fileURLToPath(new URL('../../client/dist', import.meta.url));
const PIN = process.env.DASHBOARD_PIN?.trim() ?? '';

const db = openDb(DB_PATH);
const app = Fastify({ logger: { level: process.env.LOG_LEVEL ?? 'info' }, bodyLimit: 5 * 1024 * 1024 });

if (PIN && PIN.length < MIN_PIN_LENGTH) {
  app.log.error(`DASHBOARD_PIN must have at least ${MIN_PIN_LENGTH} characters.`);
  process.exit(1);
}
// Registered before all routes so its hook guards every /api route.
const auth = registerAuth(app, {
  secret: loadSecret(join(dirname(DB_PATH), 'session-secret')),
  envPin: PIN || undefined,
  pinPath: join(dirname(DB_PATH), 'pin.json'),
});
const pinSource = auth.source();
app.log.info(
  pinSource === 'env' ? 'PIN protection is on (DASHBOARD_PIN).' : pinSource === 'app' ? 'PIN protection is on (set in the app).' : 'PIN protection is off.',
);

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

app.post<{ Body: { mac: string } }>(
  '/api/wol',
  { schema: { body: { type: 'object', required: ['mac'], properties: { mac: { type: 'string', maxLength: 32 } } } } },
  async (req, reply) => {
    const mac = parseMac(req.body.mac);
    if (!mac) return reply.code(400).send({ error: 'Invalid MAC address' });
    const sentTo = await sendWol(mac);
    req.log.info({ mac: req.body.mac, sentTo }, 'Wake-on-LAN packet sent');
    return { ok: true, sentTo };
  },
);

app.get<{ Querystring: { host: string } }>(
  '/api/online',
  { schema: { querystring: { type: 'object', required: ['host'], properties: { host: { type: 'string', maxLength: 253 } } } } },
  async (req, reply) => {
    if (!isValidHost(req.query.host)) return reply.code(400).send({ error: 'Invalid host' });
    return { online: await checkOnline(req.query.host) };
  },
);

app.post<{ Body: SyncRequest }>('/api/sync', { schema: { body: syncBodySchema } }, async (req) =>
  applySync(db, req.body),
);

if (existsSync(CLIENT_DIST)) {
  // wildcard (default) looks files up per request, so a rebuild is served without restarting the server.
  await app.register(fastifyStatic, { root: CLIENT_DIST });
  // SPA fallback: unknown page routes get index.html; missing files (e.g. /assets/x.js) and API paths get a real 404.
  app.setNotFoundHandler((req, reply) => {
    const path = req.url.split('?')[0];
    const isPage = req.method === 'GET' && !path.startsWith('/api/') && !/\.[a-z0-9]+$/i.test(path);
    if (isPage) return reply.sendFile('index.html');
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
