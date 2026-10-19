// Optional household PIN, set in the app (stored hashed in data/pin.json) or fixed via DASHBOARD_PIN.
// While a PIN is set, every /api route except the public ones needs a session cookie.
// The app shell stays public (it holds no data), so offline mode and app install keep working.
import { createHash, createHmac, randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { promisify } from 'node:util';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { writePrivate } from './files.ts';

export const COOKIE_NAME = 'hd_session';
const DAY_MS = 24 * 60 * 60 * 1000;
export const SESSION_MAX_AGE_MS = 365 * DAY_MS;
/** Sessions older than this get a fresh cookie on their next request, so devices in daily use never expire. */
const REFRESH_AFTER_MS = 30 * DAY_MS;

export const MIN_PIN_LENGTH = 4;
const MAX_PIN_LENGTH = 200;

/** Wrong guesses allowed before a lockout; each further one doubles it, up to MAX_LOCK_MS. */
export const FREE_ATTEMPTS = 5;
const BASE_LOCK_MS = 60_000;
const MAX_LOCK_MS = 60 * 60 * 1000;

const PUBLIC_ROUTES = new Set(['/api/health', '/api/login', '/api/auth']);

const scryptAsync = promisify(scrypt) as (pin: string, salt: Buffer, keylen: number) => Promise<Buffer>;

export type PinSource = 'env' | 'app';

export interface AuthOptions {
  /** Signs session cookies. Changing it logs out every device. */
  secret: Buffer;
  /** A PIN from DASHBOARD_PIN: always wins and can't be changed in the app. */
  envPin?: string;
  /** Where a PIN set in the app is stored (hashed). */
  pinPath: string;
  now?: () => number;
}

interface ActivePin {
  source: PinSource;
  verify(pin: string): Promise<boolean>;
  /** Part of every session signature, so a new PIN invalidates all existing cookies. */
  tag: string;
}

interface StoredPin {
  salt: string;
  hash: string;
}

/** Reads the signing secret next to the database, creating it on first start. */
export function loadSecret(path: string): Buffer {
  if (existsSync(path)) return Buffer.from(readFileSync(path, 'utf8').trim(), 'hex');
  const secret = randomBytes(32);
  writePrivate(path, secret.toString('hex'));
  return secret;
}

export function registerAuth(app: FastifyInstance, { secret, envPin, pinPath, now = Date.now }: AuthOptions) {
  let active: ActivePin | null = envPin ? envActivePin(envPin) : storedActivePin(readStoredPin(pinPath));

  const sign = (issued: number, tag: string) => createHmac('sha256', secret).update(`${issued}:${tag}`).digest('base64url');

  function issueCookie(req: FastifyRequest, reply: FastifyReply, tag: string) {
    const issued = now();
    const secure = req.headers['x-forwarded-proto'] === 'https' ? '; Secure' : '';
    reply.header(
      'set-cookie',
      `${COOKIE_NAME}=${issued}.${sign(issued, tag)}; Path=/; Max-Age=${SESSION_MAX_AGE_MS / 1000}; HttpOnly; SameSite=Strict${secure}`,
    );
  }

  /** Returns when the session was issued, or null if the cookie is missing, forged, expired or from an older PIN. */
  function sessionIssuedAt(req: FastifyRequest, tag: string): number | null {
    const token = readCookie(req.headers.cookie, COOKIE_NAME);
    const match = token?.match(/^(\d+)\.([\w-]+)$/);
    if (!match) return null;
    const issued = Number(match[1]);
    const age = now() - issued;
    if (age < -60_000 || age > SESSION_MAX_AGE_MS) return null;
    return safeEqual(Buffer.from(match[2]), Buffer.from(sign(issued, tag))) ? issued : null;
  }

  app.addHook('onRequest', async (req, reply) => {
    if (!active) return;
    const path = req.url.split('?')[0];
    if (!path.startsWith('/api/') || PUBLIC_ROUTES.has(path)) return;
    const issued = sessionIssuedAt(req, active.tag);
    if (issued === null) return reply.code(401).send({ error: 'PIN required' });
    if (now() - issued > REFRESH_AFTER_MS) issueCookie(req, reply, active.tag);
  });

  // Lockout is global rather than per IP: behind Caddy or Tailscale every request comes from 127.0.0.1.
  // It covers every place a PIN is checked: login and confirming the current PIN when changing it.
  let failures = 0;
  let lockedUntil = 0;

  /** Checks a PIN against the lockout; sends the 401/429 reply itself and returns false if it fails. */
  async function checkPin(pin: ActivePin, attempt: string, req: FastifyRequest, reply: FastifyReply): Promise<boolean> {
    const wait = lockedUntil - now();
    if (wait > 0) {
      const retryAfter = Math.ceil(wait / 1000);
      reply.code(429).header('retry-after', retryAfter).send({ error: 'Too many attempts', retryAfter });
      return false;
    }
    if (!(await pin.verify(attempt))) {
      failures++;
      if (failures >= FREE_ATTEMPTS) lockedUntil = now() + Math.min(BASE_LOCK_MS * 2 ** (failures - FREE_ATTEMPTS), MAX_LOCK_MS);
      req.log.warn({ failures }, 'Wrong dashboard PIN');
      reply.code(401).send({ error: 'Wrong PIN' });
      return false;
    }
    failures = 0;
    lockedUntil = 0;
    return true;
  }

  const pinString = { type: 'string', maxLength: MAX_PIN_LENGTH } as const;

  app.get('/api/auth', async () => ({ enabled: active !== null, source: active?.source ?? null }));

  app.post<{ Body: { pin: string } }>(
    '/api/login',
    { schema: { body: { type: 'object', required: ['pin'], properties: { pin: pinString } } } },
    async (req, reply) => {
      if (!active) return { ok: true };
      if (!(await checkPin(active, req.body.pin, req, reply))) return reply;
      issueCookie(req, reply, active.tag);
      return { ok: true };
    },
  );

  // Sets, changes or removes the PIN. With a PIN set, the onRequest hook already requires a session,
  // and the current PIN must be confirmed too, so an unattended logged-in device can't change it.
  app.put<{ Body: { current?: string; pin: string | null } }>(
    '/api/pin',
    {
      schema: {
        body: {
          type: 'object',
          required: ['pin'],
          // A type list, not anyOf: Fastify's type coercion would turn null into ''.
          properties: { current: pinString, pin: { type: ['string', 'null'], maxLength: MAX_PIN_LENGTH } },
        },
      },
    },
    async (req, reply) => {
      if (active?.source === 'env') {
        return reply.code(409).send({ error: 'The PIN is set with DASHBOARD_PIN on the Pi and can only be changed there.' });
      }
      const next = req.body.pin?.trim() ?? null;
      if (next !== null && next.length < MIN_PIN_LENGTH) {
        return reply.code(400).send({ error: `The PIN needs at least ${MIN_PIN_LENGTH} characters.` });
      }
      if (active && !(await checkPin(active, req.body.current ?? '', req, reply))) return reply;

      if (next === null) {
        rmSync(pinPath, { force: true });
        active = null;
        req.log.info('Dashboard PIN removed');
        return { enabled: false };
      }
      const stored = await hashPin(next);
      writePrivate(pinPath, JSON.stringify(stored));
      active = storedActivePin(stored);
      // Every other device is logged out by the new tag; this one stays logged in.
      issueCookie(req, reply, active!.tag);
      req.log.info('Dashboard PIN set');
      return { enabled: true };
    },
  );

  return { source: () => active?.source ?? null };
}

function envActivePin(pin: string): ActivePin {
  const expected = createHash('sha256').update(pin).digest();
  return {
    source: 'env',
    verify: async (attempt) => safeEqual(createHash('sha256').update(attempt.trim()).digest(), expected),
    tag: `env:${expected.toString('hex')}`,
  };
}

function storedActivePin(stored: StoredPin | null): ActivePin | null {
  if (!stored) return null;
  const salt = Buffer.from(stored.salt, 'hex');
  const expected = Buffer.from(stored.hash, 'hex');
  return {
    source: 'app',
    verify: async (attempt) => safeEqual(await scryptAsync(attempt.trim(), salt, expected.length), expected),
    tag: `app:${stored.hash}`,
  };
}

async function hashPin(pin: string): Promise<StoredPin> {
  const salt = randomBytes(16);
  const hash = await scryptAsync(pin, salt, 32);
  return { salt: salt.toString('hex'), hash: hash.toString('hex') };
}

function readStoredPin(path: string): StoredPin | null {
  if (!existsSync(path)) return null;
  const parsed = JSON.parse(readFileSync(path, 'utf8')) as Partial<StoredPin>;
  if (typeof parsed.salt !== 'string' || typeof parsed.hash !== 'string') throw new Error(`Invalid PIN file: ${path}`);
  return { salt: parsed.salt, hash: parsed.hash };
}

function readCookie(header: string | undefined, name: string): string | undefined {
  for (const part of header?.split(';') ?? []) {
    const eq = part.indexOf('=');
    if (eq > 0 && part.slice(0, eq).trim() === name) return part.slice(eq + 1).trim();
  }
  return undefined;
}

function safeEqual(a: Buffer, b: Buffer): boolean {
  return a.length === b.length && timingSafeEqual(a, b);
}
