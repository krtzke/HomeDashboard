// Fetches ICS calendars (e.g. waste collection) for the browser, which usually can't due to CORS.
// Responses are cached briefly so many devices don't hammer the municipality's server.

const CACHE_MS = 60 * 60 * 1000;
const TIMEOUT_MS = 15_000;
const MAX_BYTES = 3 * 1024 * 1024;

const cache = new Map<string, { at: number; text: string }>();

export class IcsError extends Error {
  status: number;
  constructor(message: string, status = 502) {
    super(message);
    this.status = status;
  }
}

/** Accepts http(s) and webcal(s) URLs; webcal is just an https URL for calendar apps. */
export function normalizeIcsUrl(raw: string): string {
  let url: URL;
  try {
    url = new URL(raw.trim().replace(/^webcals?:\/\//i, 'https://'));
  } catch {
    throw new IcsError('Invalid URL', 400);
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new IcsError('Only http(s) URLs are allowed', 400);
  return url.toString();
}

export async function fetchIcs(raw: string, fetchImpl: typeof fetch = fetch): Promise<string> {
  const url = normalizeIcsUrl(raw);
  const hit = cache.get(url);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.text;

  let res: Response;
  try {
    res = await fetchImpl(url, {
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: { Accept: 'text/calendar, */*' },
      redirect: 'follow',
    });
  } catch (err) {
    throw new IcsError(`Could not reach calendar: ${(err as Error).message}`);
  }
  if (!res.ok) throw new IcsError(`Calendar server answered HTTP ${res.status}`);
  if (Number(res.headers.get('content-length') ?? 0) > MAX_BYTES) throw new IcsError('Calendar file is too large');

  const text = await res.text();
  if (text.length > MAX_BYTES) throw new IcsError('Calendar file is too large');
  if (!text.includes('BEGIN:VCALENDAR')) throw new IcsError('URL did not return an iCal/ICS calendar');

  cache.set(url, { at: Date.now(), text });
  return text;
}
