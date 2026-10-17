import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fetchIcs, normalizeIcsUrl } from '../src/ics.ts';

const ICS = 'BEGIN:VCALENDAR\r\nBEGIN:VEVENT\r\nDTSTART;VALUE=DATE:20261020\r\nSUMMARY:Papier\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n';

const fakeFetch = (body: string, status = 200) => {
  let calls = 0;
  const fn = (async () => {
    calls++;
    return new Response(body, { status });
  }) as unknown as typeof fetch;
  return { fn, calls: () => calls };
};

test('normalizes webcal and rejects other schemes', () => {
  assert.equal(normalizeIcsUrl('webcal://example.com/a.ics'), 'https://example.com/a.ics');
  assert.throws(() => normalizeIcsUrl('file:///etc/passwd'), /Only http/);
  assert.throws(() => normalizeIcsUrl('not a url'), /Invalid URL/);
});

test('fetches and caches calendars', async () => {
  const f = fakeFetch(ICS);
  assert.equal(await fetchIcs('https://example.com/cache.ics', f.fn), ICS);
  assert.equal(await fetchIcs('https://example.com/cache.ics', f.fn), ICS);
  assert.equal(f.calls(), 1);
});

test('rejects non-calendar responses and HTTP errors', async () => {
  await assert.rejects(fetchIcs('https://example.com/html', fakeFetch('<html>').fn), /did not return/);
  await assert.rejects(fetchIcs('https://example.com/404', fakeFetch('nope', 404).fn), /HTTP 404/);
});
