import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Fastify from 'fastify';
import { COOKIE_NAME, FREE_ATTEMPTS, SESSION_MAX_AGE_MS, loadSecret, registerAuth } from '../src/auth.ts';

const SECRET = Buffer.alloc(32, 7);
const DAY = 24 * 60 * 60 * 1000;
const tmp = mkdtempSync(join(tmpdir(), 'hd-auth-'));
after(() => rmSync(tmp, { recursive: true, force: true }));
let dirs = 0;

function setup({ envPin, secret = SECRET, pinPath = join(tmp, String(dirs++), 'pin.json') }: { envPin?: string; secret?: Buffer; pinPath?: string } = {}) {
  const clock = { t: 1_000_000_000_000 };
  const app = Fastify();
  registerAuth(app, { secret, envPin, pinPath, now: () => clock.t });
  app.get('/api/health', async () => ({ ok: true }));
  app.get('/api/data', async () => ({ secret: 'milk' }));
  app.get('/index.html', async () => 'app shell');
  return { app, clock, pinPath };
}

type App = ReturnType<typeof setup>['app'];

const login = (app: App, pin: string, headers: Record<string, string> = {}) =>
  app.inject({ method: 'POST', url: '/api/login', payload: { pin }, headers });

const setPin = (app: App, pin: string | null, current?: string, cookie?: string) =>
  app.inject({ method: 'PUT', url: '/api/pin', payload: { pin, current }, headers: cookie ? { cookie } : {} });

const getData = (app: App, cookie?: string) => app.inject({ url: '/api/data', headers: cookie ? { cookie } : {} });

/** Turns a set-cookie header into the cookie a browser would send back. */
function cookieFrom(res: { headers: Record<string, unknown> }): string {
  return String(res.headers['set-cookie']).split(';')[0];
}

test('without a PIN everything is open', async () => {
  const { app } = setup();
  assert.equal((await getData(app)).statusCode, 200);
  assert.deepEqual((await app.inject('/api/auth')).json(), { enabled: false, source: null });
});

test('with DASHBOARD_PIN, API routes need a session but health and the app shell stay public', async () => {
  const { app } = setup({ envPin: '4711' });
  assert.equal((await getData(app)).statusCode, 401);
  assert.equal((await app.inject('/api/data?x=1')).statusCode, 401);
  assert.equal((await app.inject('/api/health')).statusCode, 200);
  assert.equal((await app.inject('/index.html')).statusCode, 200);
  assert.deepEqual((await app.inject('/api/auth')).json(), { enabled: true, source: 'env' });
});

test('the right PIN sets a cookie that unlocks the API', async () => {
  const { app } = setup({ envPin: '4711' });
  assert.equal((await login(app, '0000')).statusCode, 401);

  const res = await login(app, '4711');
  assert.equal(res.statusCode, 200);
  const header = String(res.headers['set-cookie']);
  assert.match(header, new RegExp(`^${COOKIE_NAME}=`));
  assert.match(header, /HttpOnly/);
  assert.match(header, /SameSite=Strict/);
  assert.doesNotMatch(header, /Secure/);

  const data = await getData(app, `other=1; ${cookieFrom(res)}`);
  assert.equal(data.statusCode, 200);
  assert.deepEqual(data.json(), { secret: 'milk' });
});

test('marks the cookie Secure behind an HTTPS proxy', async () => {
  const { app } = setup({ envPin: '4711' });
  const res = await login(app, '4711', { 'x-forwarded-proto': 'https' });
  assert.match(String(res.headers['set-cookie']), /; Secure/);
});

test('rejects forged cookies and cookies from another PIN or secret', async () => {
  const { app } = setup({ envPin: '4711' });
  const cookie = cookieFrom(await login(app, '4711'));
  const [, value] = cookie.split('=');
  const [issued, sig] = value.split('.');

  const forged = [`${COOKIE_NAME}=${Number(issued) + 1}.${sig}`, `${COOKIE_NAME}=${issued}.${sig.slice(0, -2)}xx`, `${COOKIE_NAME}=garbage`];
  for (const c of forged) assert.equal((await getData(app, c)).statusCode, 401, c);

  assert.equal((await getData(setup({ envPin: '9999' }).app, cookie)).statusCode, 401);
  assert.equal((await getData(setup({ envPin: '4711', secret: Buffer.alloc(32, 8) }).app, cookie)).statusCode, 401);
});

test('sessions are refreshed after a month and expire after a year unused', async () => {
  const { app, clock } = setup({ envPin: '4711' });
  const cookie = cookieFrom(await login(app, '4711'));

  clock.t += 10 * DAY;
  const fresh = await getData(app, cookie);
  assert.equal(fresh.statusCode, 200);
  assert.equal(fresh.headers['set-cookie'], undefined);

  clock.t += 30 * DAY;
  const old = await getData(app, cookie);
  assert.equal(old.statusCode, 200);
  const renewed = cookieFrom(old);
  assert.notEqual(renewed, cookie);

  clock.t += SESSION_MAX_AGE_MS;
  assert.equal((await getData(app, cookie)).statusCode, 401);
  clock.t -= SESSION_MAX_AGE_MS - DAY;
  assert.equal((await getData(app, renewed)).statusCode, 200);
});

test('locks login after repeated wrong PINs, even for the right one', async () => {
  const { app, clock } = setup({ envPin: '4711' });
  for (let i = 0; i < FREE_ATTEMPTS; i++) assert.equal((await login(app, '0000')).statusCode, 401);

  const locked = await login(app, '4711');
  assert.equal(locked.statusCode, 429);
  assert.equal(locked.json().retryAfter, 60);
  assert.equal(locked.headers['retry-after'], '60');

  clock.t += 61_000;
  assert.equal((await login(app, '0000')).statusCode, 401);
  assert.equal((await login(app, '4711')).json().retryAfter, 120, 'lockout doubles');

  clock.t += 121_000;
  assert.equal((await login(app, '4711')).statusCode, 200);
  assert.equal((await login(app, '0000')).statusCode, 401, 'success resets the counter');
  assert.equal((await login(app, '0000')).statusCode, 401);
});

test('a PIN set in the app protects the API, is stored hashed and survives a restart', async () => {
  const { app, pinPath } = setup();
  assert.equal((await setPin(app, '12')).statusCode, 400, 'too short');

  const res = await setPin(app, ' 2468 ');
  assert.equal(res.statusCode, 200);
  const cookie = cookieFrom(res);
  assert.equal((await getData(app, cookie)).statusCode, 200, 'the setting device stays logged in');
  assert.equal((await getData(app)).statusCode, 401);
  assert.deepEqual((await app.inject('/api/auth')).json(), { enabled: true, source: 'app' });

  const stored = readFileSync(pinPath, 'utf8');
  assert.doesNotMatch(stored, /2468/);

  const { app: restarted } = setup({ pinPath });
  assert.equal((await getData(restarted, cookie)).statusCode, 200, 'sessions survive a restart');
  assert.equal((await login(restarted, '2468')).statusCode, 200, 'surrounding spaces are ignored');
});

test('changing the PIN needs a session and the current PIN, and logs out other devices', async () => {
  const { app } = setup();
  const mine = cookieFrom(await setPin(app, '1111'));
  const other = cookieFrom(await login(app, '1111'));

  assert.equal((await setPin(app, '2222', '1111')).statusCode, 401, 'no session');
  assert.equal((await setPin(app, '2222', '0000', mine)).statusCode, 401, 'wrong current PIN');
  assert.equal((await setPin(app, '2222', undefined, mine)).statusCode, 401, 'missing current PIN');

  const changed = await setPin(app, '2222', '1111', mine);
  assert.equal(changed.statusCode, 200);
  assert.equal((await getData(app, other)).statusCode, 401, 'other device logged out');
  assert.equal((await getData(app, mine)).statusCode, 401, 'old cookie is invalid');
  assert.equal((await getData(app, cookieFrom(changed))).statusCode, 200, 'with its new cookie');
  assert.equal((await login(app, '1111')).statusCode, 401);
  assert.equal((await login(app, '2222')).statusCode, 200);
});

test('wrong current PINs count towards the lockout', async () => {
  const { app } = setup();
  const cookie = cookieFrom(await setPin(app, '1111'));
  for (let i = 0; i < FREE_ATTEMPTS; i++) assert.equal((await setPin(app, '2222', '0000', cookie)).statusCode, 401);
  assert.equal((await setPin(app, '2222', '1111', cookie)).statusCode, 429);
  assert.equal((await login(app, '1111')).statusCode, 429);
});

test('removing the PIN opens the API again', async () => {
  const { app, pinPath } = setup();
  const cookie = cookieFrom(await setPin(app, '1111'));
  assert.equal((await setPin(app, null, '0000', cookie)).statusCode, 401);

  const res = await setPin(app, null, '1111', cookie);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.json(), { enabled: false });
  assert.equal(existsSync(pinPath), false);
  assert.equal((await getData(app)).statusCode, 200);
});

test('a PIN from DASHBOARD_PIN wins and cannot be changed in the app', async () => {
  const { app: viaApp, pinPath } = setup();
  await setPin(viaApp, '1111');

  const { app } = setup({ envPin: '4711', pinPath });
  assert.equal((await login(app, '1111')).statusCode, 401);
  const cookie = cookieFrom(await login(app, '4711'));
  assert.equal((await setPin(app, '2222', '4711', cookie)).statusCode, 409);
  assert.equal((await setPin(app, null, '4711', cookie)).statusCode, 409);
});

test('creates the signing secret once and reuses it', () => {
  const path = join(tmp, 'sub', 'session-secret');
  const first = loadSecret(path);
  assert.equal(first.length, 32);
  assert.equal(readFileSync(path, 'utf8'), first.toString('hex'));
  assert.deepEqual(loadSecret(path), first);
});
