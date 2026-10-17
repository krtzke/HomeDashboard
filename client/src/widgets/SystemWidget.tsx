import { useState } from 'react';
import { useVisibleInterval } from '../hooks.ts';
import { WidgetFrame, type WidgetProps } from './WidgetFrame.tsx';
import type { SystemStatus } from '../../../shared/src/types.ts';

const POLL_MS = 10_000;

const GB = 1024 ** 3;
const fmtBytes = (n: number) => (n >= GB ? `${(n / GB).toFixed(1)} GB` : `${Math.round(n / 1024 ** 2)} MB`);

function fmtDuration(sec: number) {
  const d = Math.floor(sec / 86400);
  const h = Math.floor((sec % 86400) / 3600);
  const m = Math.floor((sec % 3600) / 60);
  return d ? `${d}d ${h}h` : h ? `${h}h ${m}m` : `${m}m`;
}

/** Decodes `vcgencmd get_throttled`: low bits = happening now, bits 16+ = happened since boot. */
function throttleInfo(v: number | null): { level: 'ok' | 'warn' | 'bad'; text: string } | null {
  if (v === null) return null;
  const names = ['under-voltage', 'frequency capped', 'throttled', 'soft temp limit'];
  const now = names.filter((_, i) => v & (1 << i));
  const past = names.filter((_, i) => v & (1 << (i + 16)));
  if (now.length) return { level: 'bad', text: `⚡ ${now.join(', ')} — check the power supply/cooling` };
  if (past.length) return { level: 'warn', text: `Since boot: ${past.join(', ')}` };
  return { level: 'ok', text: 'Power & cooling OK' };
}

function Meter({ label, value, max, detail }: { label: string; value: number; max: number; detail: string }) {
  const pct = Math.min(100, Math.max(0, (value / max) * 100));
  const level = pct >= 90 ? 'bad' : pct >= 75 ? 'warn' : 'ok';
  return (
    <div className="meter">
      <div className="meter-head">
        <span>{label}</span>
        <span className="muted">{detail}</span>
      </div>
      <div className="meter-bar">
        <div className={`meter-fill ${level}`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

export function SystemWidget({ editing, onRemove }: WidgetProps) {
  const [status, setStatus] = useState<SystemStatus | null>(null);
  const [error, setError] = useState<string | null>(null);

  useVisibleInterval(async () => {
    try {
      const res = await fetch('/api/system', { signal: AbortSignal.timeout(8000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setStatus(await res.json());
      setError(null);
    } catch {
      setError('Pi not reachable');
    }
  }, POLL_MS);

  const s = status;
  const temp = s?.cpuTempC ?? null;
  const tempLevel = temp === null ? '' : temp >= 75 ? 'bad' : temp >= 60 ? 'warn' : 'ok';
  const thr = throttleInfo(s?.throttled ?? null);

  return (
    <WidgetFrame title={s?.hostname ?? 'Pi status'} icon="🍓" editing={editing} onRemove={onRemove}>
      {!s ? (
        <p className="empty">{error ?? 'Loading…'}</p>
      ) : (
        <div className={`system${error ? ' stale' : ''}`}>
          {error && <div className="error-text">⚠ {error} — showing last values</div>}
          <div className="sys-top">
            <span className={`sys-temp ${tempLevel}`}>{temp === null ? '–' : `${temp.toFixed(1)}°C`}</span>
            <span className="sys-uptime">
              <span>Up {fmtDuration(s.uptimeSec)}</span>
              <small className="muted">App {fmtDuration(s.appUptimeSec)}</small>
            </span>
          </div>
          <Meter
            label="CPU load"
            value={s.load[0]}
            max={s.cpuCount}
            detail={`${s.load.map((l) => l.toFixed(2)).join(' / ')} · ${s.cpuCount} cores`}
          />
          <Meter
            label="Memory"
            value={s.memTotal - s.memAvailable}
            max={s.memTotal}
            detail={`${fmtBytes(s.memTotal - s.memAvailable)} of ${fmtBytes(s.memTotal)}`}
          />
          {s.diskTotal !== null && s.diskFree !== null && (
            <Meter
              label="Disk"
              value={s.diskTotal - s.diskFree}
              max={s.diskTotal}
              detail={`${fmtBytes(s.diskFree)} free of ${fmtBytes(s.diskTotal)}`}
            />
          )}
          {thr && <div className={`sys-throttle ${thr.level}`}>{thr.text}</div>}
          <div className="sys-meta muted">
            {s.platform} · Node {s.nodeVersion}
            {s.dbSizeBytes !== null && ` · DB ${fmtBytes(s.dbSizeBytes)}`}
          </div>
        </div>
      )}
    </WidgetFrame>
  );
}
