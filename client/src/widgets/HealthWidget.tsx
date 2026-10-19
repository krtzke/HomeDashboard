import { useEffect, useState, type FormEvent } from 'react';
import { format, isToday, isYesterday } from 'date-fns';
import { getMeta, setMeta } from '../db.ts';
import { useVisibleInterval } from '../hooks.ts';
import { WidgetFrame, type WidgetProps } from './WidgetFrame.tsx';
import type { HealthCheck, HealthChecksResponse } from '../../../shared/src/types.ts';

const POLL_MS = 60_000;
const CACHE_KEY = 'healthchecks';

type Status = Extract<HealthChecksResponse, { configured: true }>;

/** Failing first, then late, then the rest; alphabetical within each group. */
const ORDER: Record<HealthCheck['status'], number> = { down: 0, grace: 1, up: 2, new: 3, paused: 4 };
const sortChecks = (checks: HealthCheck[]) =>
  [...checks].sort((a, b) => ORDER[a.status] - ORDER[b.status] || a.name.localeCompare(b.name));

function fmtWhen(iso: string) {
  const d = new Date(iso);
  const time = format(d, 'HH:mm');
  return isToday(d) ? `today ${time}` : isYesterday(d) ? `yesterday ${time}` : format(d, 'd MMM HH:mm');
}

const fmtDuration = (sec: number) => (sec < 90 ? `${Math.round(sec)} s` : `${Math.round(sec / 60)} min`);

function describe(c: HealthCheck): string {
  if (c.started) return 'Running…';
  if (c.status === 'paused') return 'Paused';
  if (!c.lastPing) return 'Waiting for the first ping';
  const last = fmtWhen(c.lastPing);
  if (c.status === 'down') return `Failing · last ping ${last}`;
  if (c.status === 'grace') return `Late · last ping ${last}`;
  return c.lastDuration !== null ? `${last} · ${fmtDuration(c.lastDuration)}` : last;
}

/** fetch() rejects with a TypeError when the Pi can't be reached at all, and times out as TimeoutError. */
const errorText = (err: unknown) =>
  err instanceof TypeError || (err as Error).name === 'TimeoutError' ? 'Pi not reachable' : (err as Error).message;

const dotClass = (c: HealthCheck) => (c.started ? 'grace' : c.status === 'new' ? 'paused' : c.status);

export function HealthWidget({ editing, onRemove }: WidgetProps) {
  const [status, setStatus] = useState<Status | null>(null);
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [settings, setSettings] = useState(false);

  // Show the last known status immediately (works offline), then refresh.
  useEffect(() => {
    void getMeta<Status | null>(CACHE_KEY, null).then((s) => s && setStatus((cur) => cur ?? s));
  }, []);

  async function refresh() {
    try {
      const res = await fetch('/api/healthchecks', { signal: AbortSignal.timeout(15_000) });
      const data = (await res.json().catch(() => ({}))) as HealthChecksResponse & { error?: string };
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      setConfigured(data.configured);
      setError(null);
      if (data.configured) {
        setStatus(data);
        await setMeta(CACHE_KEY, data);
      } else {
        setStatus(null);
        await setMeta(CACHE_KEY, null);
      }
    } catch (err) {
      setError(errorText(err));
    }
  }

  useVisibleInterval(() => void refresh(), POLL_MS);

  const checks = status ? sortChecks(status.checks) : [];
  const failing = checks.filter((c) => c.status === 'down').length;
  const showSettings = settings || configured === false;

  return (
    <WidgetFrame
      title="Health"
      icon="🩺"
      editing={editing}
      onRemove={onRemove}
      // A badge instead of "· N failing" in the title, which gets cut off in narrow widgets.
      actions={
        failing > 0 && (
          <span className="health-badge" title={`${failing} failing`}>
            {failing}
          </span>
        )
      }
      onSettings={() => setSettings((s) => !s)}
      settingsOpen={showSettings}
    >
      {showSettings ? (
        <KeySettings
          configured={configured === true}
          onSaved={(nowConfigured) => {
            setSettings(false);
            setConfigured(nowConfigured);
            void refresh();
          }}
        />
      ) : !status ? (
        <p className="empty">{error ?? 'Loading…'}</p>
      ) : (
        <div className={`health${error ? ' stale' : ''}`}>
          {error && <div className="error-text">⚠ {error} — showing last status</div>}
          {!checks.length && <p className="empty">No checks in this Healthchecks project yet.</p>}
          <ul className="health-list">
            {checks.map((c, i) => (
              <li key={`${c.name}-${i}`}>
                <span className={`health-dot ${dotClass(c)}`} title={c.status} />
                <span className="health-info">
                  <span className="health-name">{c.name}</span>
                  <small className={c.status === 'down' ? 'error-text' : 'muted'}>{describe(c)}</small>
                </span>
              </li>
            ))}
          </ul>
          <div className="health-updated muted">Updated {format(status.fetchedAt, 'HH:mm')} · Healthchecks.io</div>
        </div>
      )}
    </WidgetFrame>
  );
}

/** The key is write-only: the Pi stores it and never sends it back, so the field always starts empty. */
function KeySettings({ configured, onSaved }: { configured: boolean; onSaved: (configured: boolean) => void }) {
  const [key, setKey] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function save(value: string | null) {
    setBusy(true);
    setError('');
    try {
      const res = await fetch('/api/healthchecks/key', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: value }),
        signal: AbortSignal.timeout(20_000),
      });
      const data = (await res.json().catch(() => ({}))) as { configured?: boolean; error?: string };
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      setKey('');
      onSaved(data.configured === true);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  function submit(e: FormEvent) {
    e.preventDefault();
    if (key.trim()) void save(key.trim());
  }

  return (
    <form className="settings" onSubmit={submit}>
      <p>
        Shows the checks of a <a href="https://healthchecks.io" target="_blank" rel="noreferrer">Healthchecks.io</a> project. In the
        project, open <b>Settings → API Access</b> and create a <b>read-only</b> API key.
      </p>
      <label className="field">
        {configured ? 'Replace the read-only API key' : 'Read-only API key'}
        <input type="password" autoComplete="off" value={key} onChange={(e) => setKey(e.target.value)} disabled={busy} />
      </label>
      <p className="muted">The key is stored on the Pi only and never sent to other devices.</p>
      {error && <p className="error-text">{error}</p>}
      <div className="row-buttons">
        {configured && (
          <button type="button" className="danger" disabled={busy} onClick={() => void save(null)}>
            Remove key
          </button>
        )}
        <button type="submit" className="primary" disabled={busy || !key.trim()}>
          {busy ? 'Checking…' : 'Save'}
        </button>
      </div>
    </form>
  );
}
