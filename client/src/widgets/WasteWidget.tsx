import { useMemo, useState, type ChangeEvent } from 'react';
import { addDays, differenceInCalendarDays, format } from 'date-fns';
import { getMeta, setMeta } from '../db.ts';
import { fromDateStr, toDateStr } from '../dates.ts';
import { useVisibleInterval } from '../hooks.ts';
import { parseIcs, type IcsEvent } from '../ics.ts';
import { wasteStyle } from '../waste.ts';
import { useWidgetConfig } from './config.ts';
import { WidgetFrame, type WidgetProps } from './WidgetFrame.tsx';

interface WasteConfig {
  /** ICS/webcal subscription URL (fetched by the Pi). */
  url: string;
  /** Alternatively, an uploaded .ics file (synced to all devices). */
  icsText: string;
  fileName: string;
}

interface CachedIcs {
  text: string;
  fetchedAt: number;
}

const DEFAULTS: WasteConfig = { url: '', icsText: '', fileName: '' };
const REFRESH_MS = 6 * 60 * 60 * 1000;
const LOOKAHEAD_DAYS = 120;
const MAX_UPLOAD_BYTES = 500 * 1024;
const SHOWN_DATES = 8;

export function WasteWidget({ widget, editing, onRemove }: WidgetProps) {
  const [config, setConfig] = useWidgetConfig(widget, DEFAULTS);
  const [settings, setSettings] = useState(false);
  const [fetched, setFetched] = useState<CachedIcs | null>(null);
  const [error, setError] = useState<string | null>(null);
  const configured = !!(config.url || config.icsText);

  // URL mode: use the cached copy (offline), refresh from the Pi when it's stale.
  useVisibleInterval(
    async () => {
      if (!config.url || config.icsText) return;
      const key = `ics:${config.url}`;
      const cached = await getMeta<CachedIcs | null>(key, null);
      if (cached) setFetched(cached);
      if (cached && Date.now() - cached.fetchedAt < REFRESH_MS) return;
      try {
        const res = await fetch(`/api/ics?url=${encodeURIComponent(config.url)}`, { signal: AbortSignal.timeout(20_000) });
        if (!res.ok) throw new Error((await res.json().catch(() => null))?.error ?? `HTTP ${res.status}`);
        const fresh = { text: await res.text(), fetchedAt: Date.now() };
        await setMeta(key, fresh);
        setFetched(fresh);
        setError(null);
      } catch (err) {
        setError(navigator.onLine ? (err as Error).message : 'Offline');
      }
    },
    15 * 60 * 1000,
    [config.url, config.icsText],
  );

  const today = toDateStr(new Date());
  const text = config.icsText || (config.url ? fetched?.text : '') || '';
  const byDate = useMemo(() => {
    const map = new Map<string, IcsEvent[]>();
    if (!text) return map;
    for (const e of parseIcs(text, today, toDateStr(addDays(new Date(), LOOKAHEAD_DAYS)))) {
      map.set(e.date, [...(map.get(e.date) ?? []), e]);
    }
    return map;
  }, [text, today]);

  const dates = [...byDate.keys()].slice(0, SHOWN_DATES);
  const tomorrow = toDateStr(addDays(new Date(), 1));
  const alert = byDate.has(today) ? today : byDate.has(tomorrow) ? tomorrow : null;

  return (
    <WidgetFrame
      title="Waste collection"
      icon="🗑️"
      editing={editing}
      onRemove={onRemove}
      onSettings={() => setSettings((s) => !s)}
      settingsOpen={settings || !configured}
    >
      {settings || !configured ? (
        <WasteSettings config={config} setConfig={setConfig} onDone={() => setSettings(false)} />
      ) : (
        <>
          {alert && (
            <div className="waste-alert">
              <strong>{alert === today ? 'Today' : 'Tomorrow — put it out tonight'}</strong>
              <span>{byDate.get(alert)!.map((e) => `${wasteStyle(e.summary).emoji} ${e.summary}`).join('  ')}</span>
            </div>
          )}
          <ul className="waste-list">
            {dates.map((d) => {
              const days = differenceInCalendarDays(fromDateStr(d), fromDateStr(today));
              return (
                <li key={d}>
                  <span className="waste-date">
                    {format(fromDateStr(d), 'EEE d MMM')}
                    <small>{days === 0 ? 'today' : days === 1 ? 'tomorrow' : `in ${days} days`}</small>
                  </span>
                  <span className="waste-types">
                    {byDate.get(d)!.map((e, i) => {
                      const s = wasteStyle(e.summary);
                      return (
                        <span key={i} className="waste-chip" style={{ borderColor: s.color }}>
                          {s.emoji} {e.summary}
                        </span>
                      );
                    })}
                  </span>
                </li>
              );
            })}
            {dates.length === 0 && (
              <li className="empty">{error ? `Couldn't load calendar: ${error}` : text ? 'No pickups in the next months' : 'Loading…'}</li>
            )}
          </ul>
          {error && dates.length > 0 && <div className="wx-updated">⚠ {error} — showing saved calendar</div>}
        </>
      )}
    </WidgetFrame>
  );
}

function WasteSettings({
  config,
  setConfig,
  onDone,
}: {
  config: WasteConfig;
  setConfig: (patch: Partial<WasteConfig>) => Promise<void>;
  onDone: () => void;
}) {
  const [url, setUrl] = useState(config.url);
  const [msg, setMsg] = useState<string | null>(null);

  async function upload(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > MAX_UPLOAD_BYTES) return setMsg('File is too large (max 500 KB).');
    const text = await file.text();
    if (!text.includes('BEGIN:VCALENDAR')) return setMsg('That is not an .ics calendar file.');
    await setConfig({ icsText: text, fileName: file.name, url: '' });
    onDone();
  }

  return (
    <div className="settings">
      <p className="muted">
        Most municipalities (Abfallkalender) offer an <strong>iCal / ICS</strong> export or subscription link for your street.
      </p>
      <label className="field">
        Calendar URL (https:// or webcal://)
        <input placeholder="https://…/abfuhrkalender.ics" value={url} onChange={(e) => setUrl(e.target.value)} />
      </label>
      <button
        className="primary"
        disabled={!url.trim()}
        onClick={async () => {
          await setConfig({ url: url.trim(), icsText: '', fileName: '' });
          onDone();
        }}
      >
        Use URL
      </button>
      <div className="or">or</div>
      <label className="field">
        Upload an .ics file
        <input type="file" accept=".ics,text/calendar" onChange={upload} />
      </label>
      {config.fileName && <p className="muted">Current file: {config.fileName}</p>}
      {msg && <p className="error-text">{msg}</p>}
    </div>
  );
}
