import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Fastify from 'fastify';
import { fetchChecks, registerHealthchecks } from '../src/healthchecks.ts';

const KEY = 'readonly-key-1234567890abcdef';
const tmp = mkdtempSync(join(tmpdir(), 'hd-hc-'));
after(() => rmSync(tmp, { recursive: true, force: true }));
let dirs = 0;

const API_CHECKS = [
  { name: 'Vaultwarden backup', status: 'up', started: false, last_ping: '2026-10-19T01:31:00+00:00', next_ping: '2026-10-20T01:30:00+00:00', last_duration: 42, unique_key: 'a' },
  { name: 'Pi heartbeat', status: 'down', started: false, last_ping: '2026-10-19T08:00:00+00:00', next_ping: null, unique_key: 'b' },
  { name: '', status: 'weird', unique_key: 'c' },
];

/** Fake Healthchecks API: answers per key, counts calls. */
function fakeApi(keys: Record<string, { status?: number; checks?: unknown[] }> = { [KEY]: { checks: API_CHECKS } }) {
  const calls: string[] = [];
  const fn = (async (url: URL, init: RequestInit) => {
    const key = (init.headers as Record<string, string>)['X-Api-Key'];
    calls.push(`${url.pathname} ${key}`);
    const answer = keys[key] ?? { status: 401 };
    return new Response(JSON.stringify({ checks: answer.checks ?? [] }), { status: answer.status ?? 200 });
  }) as unknown as typeof fetch;
  return { fn, calls };
}

function setup({ api = fakeApi(), keyPath = join(tmp, String(dirs++), 'healthchecks.json') } = {}) {
  const clock = { t: 1_000_000 };
  const app = Fastify();
  registerHealthchecks(app, { keyPath, apiUrl: 'https://hc.example', fetchImpl: api.fn, now: () => clock.t });
  return { app, api, clock, keyPath };
}

const setKey = (app: ReturnType<typeof setup>['app'], key: string | null) =>
  app.inject({ method: 'PUT', url: '/api/healthchecks/key', payload: { key } });

test('maps checks from the API', async () => {
  const { checks, readOnly } = await fetchChecks('https://hc.example', KEY, fakeApi().fn);
  assert.equal(readOnly, true);
  assert.deepEqual(checks, [
    { name: 'Vaultwarden backup', status: 'up', started: false, lastPing: '2026-10-19T01:31:00+00:00', nextPing: '2026-10-20T01:30:00+00:00', lastDuration: 42 },
    { name: 'Pi heartbeat', status: 'down', started: false, lastPing: '2026-10-19T08:00:00+00:00', nextPing: null, lastDuration: null },
    { name: 'Unnamed check', status: 'new', started: false, lastPing: null, nextPing: null, lastDuration: null },
  ]);
});

test('reports a rejected key, HTTP errors and unreachable servers', async () => {
  await assert.rejects(fetchChecks('https://hc.example', 'wrong', fakeApi().fn), /rejected the API key/);
  await assert.rejects(fetchChecks('https://hc.example', KEY, fakeApi({ [KEY]: { status: 500 } }).fn), /HTTP 500/);
  const offline = (async () => {
    throw new TypeError('fetch failed');
  }) as unknown as typeof fetch;
  await assert.rejects(fetchChecks('https://hc.example', KEY, offline), /Could not reach Healthchecks: fetch failed/);
});

test('is unconfigured until a key is set', async () => {
  const { app, api } = setup();
  assert.deepEqual((await app.inject('/api/healthchecks')).json(), { configured: false });
  assert.equal(api.calls.length, 0);
});

test('saves a working read-only key privately and never returns it', async () => {
  const { app, keyPath } = setup();
  const res = await setKey(app, `  ${KEY} `);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.json(), { configured: true });
  assert.deepEqual(JSON.parse(readFileSync(keyPath, 'utf8')), { apiKey: KEY });
  if (process.platform !== 'win32') assert.equal(statSync(keyPath).mode & 0o777, 0o600);

  const status = await app.inject('/api/healthchecks');
  assert.equal(status.statusCode, 200);
  assert.equal(status.json().configured, true);
  assert.equal(status.json().checks.length, 3);
  assert.doesNotMatch(status.body + res.body, new RegExp(KEY));

  const { app: restarted } = setup({ keyPath });
  assert.equal((await restarted.inject('/api/healthchecks')).json().configured, true, 'key survives a restart');
});

test('refuses keys that are wrong or have write access', async () => {
  const api = fakeApi({ [KEY]: { checks: API_CHECKS }, 'full-key': { checks: [{ name: 'x', status: 'up', ping_url: 'https://hc-ping.com/x' }] } });
  const { app, keyPath } = setup({ api });
  const wrong = await setKey(app, 'nope');
  assert.equal(wrong.statusCode, 400);
  assert.match(wrong.json().error, /rejected the API key/);
  const full = await setKey(app, 'full-key');
  assert.equal(full.statusCode, 400);
  assert.match(full.json().error, /read-only/);
  assert.equal(existsSync(keyPath), false);
});

test('caches the status for a minute', async () => {
  const { app, api, clock } = setup();
  await setKey(app, KEY);
  const before = api.calls.length;
  await app.inject('/api/healthchecks');
  await app.inject('/api/healthchecks');
  assert.equal(api.calls.length, before, 'served from the cache filled by setting the key');
  clock.t += 60_000;
  const res = await app.inject('/api/healthchecks');
  assert.equal(api.calls.length, before + 1);
  assert.equal(res.json().fetchedAt, clock.t);
});

test('passes API errors on as 502', async () => {
  const keys: Record<string, { status?: number; checks?: unknown[] }> = { [KEY]: { checks: API_CHECKS } };
  const { app, clock } = setup({ api: fakeApi(keys) });
  await setKey(app, KEY);
  keys[KEY] = { status: 503 };
  clock.t += 60_000;
  const res = await app.inject('/api/healthchecks');
  assert.equal(res.statusCode, 502);
  assert.match(res.json().error, /HTTP 503/);
});

test('removing the key turns the widget off again', async () => {
  const { app, keyPath } = setup();
  await setKey(app, KEY);
  const res = await setKey(app, null);
  assert.deepEqual(res.json(), { configured: false });
  assert.equal(existsSync(keyPath), false);
  assert.deepEqual((await app.inject('/api/healthchecks')).json(), { configured: false });
});
