// Status of Healthchecks.io checks for the "Health checks" widget. The Pi fetches it with a read-only
// API key that is set from the widget, stored in data/healthchecks.json and never sent to browsers.
import { existsSync, readFileSync, rmSync } from 'node:fs';
import type { FastifyInstance } from 'fastify';
import { writePrivate } from './files.ts';
import type { HealthCheck, HealthChecksResponse } from '../../shared/src/types.ts';

const CACHE_MS = 60_000;
const TIMEOUT_MS = 10_000;
const STATUSES = new Set<HealthCheck['status']>(['up', 'grace', 'down', 'paused', 'new']);

export class HealthchecksError extends Error {
  status: number;
  constructor(message: string, status = 502) {
    super(message);
    this.status = status;
  }
}

/** The fields we use from GET /api/v3/checks/. */
interface ApiCheck {
  name?: string;
  status?: string;
  started?: boolean;
  last_ping?: string | null;
  next_ping?: string | null;
  last_duration?: number;
  /** Only present for keys with write access. */
  ping_url?: string;
}

export async function fetchChecks(apiUrl: string, apiKey: string, fetchImpl: typeof fetch = fetch): Promise<{ checks: HealthCheck[]; readOnly: boolean }> {
  let res: Response;
  try {
    res = await fetchImpl(new URL('/api/v3/checks/', apiUrl), {
      headers: { 'X-Api-Key': apiKey },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (err) {
    throw new HealthchecksError(`Could not reach Healthchecks: ${(err as Error).message}`);
  }
  if (res.status === 401) throw new HealthchecksError('Healthchecks rejected the API key');
  if (!res.ok) throw new HealthchecksError(`Healthchecks answered HTTP ${res.status}`);

  const body = (await res.json().catch(() => null)) as { checks?: ApiCheck[] } | null;
  if (!Array.isArray(body?.checks)) throw new HealthchecksError('Unexpected answer from Healthchecks');
  return {
    checks: body.checks.map((c) => ({
      name: c.name || 'Unnamed check',
      status: STATUSES.has(c.status as HealthCheck['status']) ? (c.status as HealthCheck['status']) : 'new',
      started: c.started === true,
      lastPing: c.last_ping ?? null,
      nextPing: c.next_ping ?? null,
      lastDuration: typeof c.last_duration === 'number' ? c.last_duration : null,
    })),
    readOnly: !body.checks.some((c) => c.ping_url),
  };
}

export interface HealthchecksOptions {
  /** Where the API key is stored. */
  keyPath: string;
  /** Base URL, e.g. for a self-hosted Healthchecks. */
  apiUrl?: string;
  fetchImpl?: typeof fetch;
  now?: () => number;
}

export function registerHealthchecks(app: FastifyInstance, { keyPath, apiUrl = 'https://healthchecks.io', fetchImpl = fetch, now = Date.now }: HealthchecksOptions) {
  let apiKey = readKey(keyPath);
  let cache: { at: number; checks: HealthCheck[] } | null = null;

  app.get('/api/healthchecks', async (_req, reply): Promise<HealthChecksResponse | undefined> => {
    if (!apiKey) return { configured: false };
    if (!cache || now() - cache.at >= CACHE_MS) {
      try {
        cache = { at: now(), checks: (await fetchChecks(apiUrl, apiKey, fetchImpl)).checks };
      } catch (err) {
        if (!(err instanceof HealthchecksError)) throw err;
        reply.code(err.status).send({ error: err.message });
        return;
      }
    }
    return { configured: true, checks: cache.checks, fetchedAt: cache.at };
  });

  // Write-only: the key can be set or removed, but no route ever returns it.
  app.put<{ Body: { key: string | null } }>(
    '/api/healthchecks/key',
    {
      schema: {
        // A type list, not anyOf: Fastify's type coercion would turn null into ''.
        body: { type: 'object', required: ['key'], properties: { key: { type: ['string', 'null'], maxLength: 200 } } },
      },
    },
    async (req, reply) => {
      const key = req.body.key?.trim() || null;
      if (key) {
        // Check the key works, and refuse keys that could change checks: the Pi only needs to read.
        try {
          const { checks, readOnly } = await fetchChecks(apiUrl, key, fetchImpl);
          if (!readOnly) {
            return reply.code(400).send({ error: 'This key has write access. Create a read-only API key instead.' });
          }
          cache = { at: now(), checks };
        } catch (err) {
          if (!(err instanceof HealthchecksError)) throw err;
          return reply.code(400).send({ error: err.message });
        }
        writePrivate(keyPath, JSON.stringify({ apiKey: key }));
      } else {
        rmSync(keyPath, { force: true });
        cache = null;
      }
      apiKey = key;
      req.log.info(key ? 'Healthchecks API key set' : 'Healthchecks API key removed');
      return { configured: key !== null };
    },
  );
}

function readKey(path: string): string | null {
  if (!existsSync(path)) return null;
  const { apiKey } = JSON.parse(readFileSync(path, 'utf8')) as { apiKey?: unknown };
  return typeof apiKey === 'string' && apiKey ? apiKey : null;
}
