// Household PIN: logging in, and setting/changing/removing it from the app.
// The session itself is an HttpOnly cookie the server sets; the app never sees it.

const REQUEST_TIMEOUT_MS = 10_000;

export type Result<T = void> = { ok: true; value: T } | { ok: false; error: string };

export interface AuthInfo {
  enabled: boolean;
  /** 'env': fixed on the Pi with DASHBOARD_PIN; 'app': set here. */
  source: 'env' | 'app' | null;
}

export function getAuthInfo(): Promise<Result<AuthInfo>> {
  return request('GET', '/api/auth');
}

/** Sends the PIN; on success the server sets the session cookie. */
export async function login(pin: string): Promise<Result> {
  const res = await request('POST', '/api/login', { pin });
  return res.ok ? { ok: true, value: undefined } : res;
}

/** Sets, changes (`pin`) or removes (`null`) the PIN. `current` is required while one is set. */
export async function changePin(pin: string | null, current?: string): Promise<Result> {
  const res = await request('PUT', '/api/pin', { pin, current });
  return res.ok ? { ok: true, value: undefined } : res;
}

async function request<T>(method: string, url: string, body?: unknown): Promise<Result<T>> {
  let res: Response;
  try {
    res = await fetch(url, {
      method,
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch {
    return { ok: false, error: 'The dashboard server is not reachable.' };
  }
  const data = (await res.json().catch(() => ({}))) as { error?: string; retryAfter?: number };
  if (res.ok) return { ok: true, value: data as T };
  if (res.status === 429) return { ok: false, error: `Too many wrong attempts. Try again in ${formatWait(data.retryAfter ?? 60)}.` };
  if (data.error === 'Wrong PIN') return { ok: false, error: 'Wrong PIN.' };
  if (data.error === 'PIN required') return { ok: false, error: 'This device is not logged in.' };
  return { ok: false, error: data.error ?? `HTTP ${res.status}` };
}

function formatWait(seconds: number): string {
  const [n, unit] = seconds < 60 ? [seconds, 'second'] : [Math.ceil(seconds / 60), 'minute'];
  return `${n} ${unit}${n === 1 ? '' : 's'}`;
}
