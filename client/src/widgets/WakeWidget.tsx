import { useEffect, useRef, useState, type FormEvent } from 'react';
import { newId } from '../data.ts';
import { useVisibleInterval } from '../hooks.ts';
import { useWidgetConfig } from './config.ts';
import { WidgetFrame, type WidgetProps } from './WidgetFrame.tsx';

interface Device {
  id: string;
  name: string;
  mac: string;
  /** IP or hostname for the online check (optional). */
  host: string;
}

interface WakeConfig {
  devices: Device[];
}

type Status = 'unknown' | 'online' | 'offline' | 'waking' | 'error';

const DEFAULTS: WakeConfig = { devices: [] };
const STATUS_POLL_MS = 20_000;
const WAKING_POLL_MS = 4_000;
const WAKE_TIMEOUT_MS = 3 * 60_000;

const MAC_RE = /^([0-9a-f]{2}[:-]?){5}[0-9a-f]{2}$/i;
const HOST_RE = /^[a-z0-9]([a-z0-9.-]*[a-z0-9])?$/i;

async function isOnline(host: string): Promise<boolean> {
  const res = await fetch(`/api/online?host=${encodeURIComponent(host)}`, { signal: AbortSignal.timeout(10_000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return (await res.json()).online;
}

export function WakeWidget({ widget, editing, onRemove }: WidgetProps) {
  const [config, setConfig] = useWidgetConfig(widget, DEFAULTS);
  const [settings, setSettings] = useState(false);
  const [status, setStatus] = useState<Record<string, Status>>({});
  const [message, setMessage] = useState<Record<string, string>>({});
  const wakingSince = useRef<Record<string, number>>({});
  const devices = config.devices;

  const setFor = (id: string, s: Status, msg = '') => {
    setStatus((prev) => ({ ...prev, [id]: s }));
    setMessage((prev) => ({ ...prev, [id]: msg }));
  };

  async function refresh(d: Device) {
    if (!d.host) return;
    try {
      const online = await isOnline(d.host);
      const since = wakingSince.current[d.id];
      if (since && !online) {
        if (Date.now() - since < WAKE_TIMEOUT_MS) return; // still waiting for it to boot
        delete wakingSince.current[d.id];
        return setFor(d.id, 'offline', "Didn't come online — is Wake-on-LAN enabled?");
      }
      delete wakingSince.current[d.id];
      setFor(d.id, online ? 'online' : 'offline');
    } catch {
      setFor(d.id, 'error', 'Pi not reachable');
    }
  }

  useVisibleInterval(() => devices.forEach((d) => void refresh(d)), STATUS_POLL_MS, [devices.map((d) => d.id + d.host).join()]);

  // Poll faster while a device is booting.
  const anyWaking = Object.values(status).includes('waking');
  useEffect(() => {
    if (!anyWaking) return;
    const t = setInterval(() => devices.filter((d) => status[d.id] === 'waking').forEach((d) => void refresh(d)), WAKING_POLL_MS);
    return () => clearInterval(t);
  });

  async function wake(d: Device) {
    try {
      const res = await fetch('/api/wol', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mac: d.mac }),
        signal: AbortSignal.timeout(10_000),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => null))?.error ?? `HTTP ${res.status}`);
      if (d.host) {
        wakingSince.current[d.id] = Date.now();
        setFor(d.id, 'waking', 'Magic packet sent — starting up…');
      } else {
        setFor(d.id, 'unknown', 'Magic packet sent');
      }
    } catch (err) {
      setFor(d.id, 'error', navigator.onLine ? `Failed: ${(err as Error).message}` : 'Offline — connect to Tailscale or home WiFi');
    }
  }

  const label: Record<Status, string> = { unknown: '', online: 'Online', offline: 'Offline', waking: 'Waking…', error: '' };

  return (
    <WidgetFrame title="Wake PC" icon="💻" editing={editing} onRemove={onRemove} onSettings={() => setSettings((s) => !s)} settingsOpen={settings || !devices.length}>
      {settings || !devices.length ? (
        <div className="settings">
          <AddDevice
            onAdd={(d) => {
              setSettings(true); // stay open after the first device, so more can be added
              void setConfig({ devices: [...devices, d] });
            }}
          />
          <ul className="link-edit-list">
            {devices.map((d) => (
              <li key={d.id}>
                <span className="link-edit-title">
                  {d.name}
                  <small>
                    {d.mac}
                    {d.host && ` · ${d.host}`}
                  </small>
                </span>
                <button className="icon-btn subtle" title="Remove" onClick={() => setConfig({ devices: devices.filter((x) => x.id !== d.id) })}>
                  ✕
                </button>
              </li>
            ))}
          </ul>
          {devices.length > 0 && (
            <button className="primary" onClick={() => setSettings(false)}>
              Done
            </button>
          )}
        </div>
      ) : (
        <ul className="wake-list">
          {devices.map((d) => {
            const s = status[d.id] ?? 'unknown';
            return (
              <li key={d.id}>
                <span className={`wake-dot ${s}`} title={label[s] || 'Status unknown'} />
                <span className="wake-info">
                  <span className="wake-name">{d.name}</span>
                  <small className={s === 'error' ? 'error-text' : 'muted'}>{message[d.id] || label[s] || (d.host ? 'Checking…' : 'No IP set for status')}</small>
                </span>
                <button className="primary small" disabled={s === 'waking' || s === 'online'} onClick={() => wake(d)}>
                  {s === 'online' ? 'On' : s === 'waking' ? '…' : '⚡ Wake'}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </WidgetFrame>
  );
}

function AddDevice({ onAdd }: { onAdd: (d: Device) => void }) {
  const [name, setName] = useState('');
  const [mac, setMac] = useState('');
  const [host, setHost] = useState('');
  const macOk = MAC_RE.test(mac.trim());
  const hostOk = !host.trim() || HOST_RE.test(host.trim());

  function submit(e: FormEvent) {
    e.preventDefault();
    if (!macOk || !hostOk) return;
    onAdd({ id: newId(), name: name.trim() || 'PC', mac: mac.trim().toUpperCase().replace(/:/g, '-'), host: host.trim() });
    setName('');
    setMac('');
    setHost('');
  }

  return (
    <form className="inline-form" onSubmit={submit}>
      <input placeholder="Name, e.g. Gaming PC" value={name} onChange={(e) => setName(e.target.value)} />
      <input placeholder="MAC address, e.g. AA-BB-CC-DD-EE-FF" value={mac} onChange={(e) => setMac(e.target.value)} required />
      <input placeholder="IP for online status, e.g. 192.168.1.20 (optional)" value={host} onChange={(e) => setHost(e.target.value)} />
      {mac && !macOk && <p className="error-text">That doesn't look like a MAC address (6 pairs of hex digits).</p>}
      {!hostOk && <p className="error-text">Enter an IP address or hostname.</p>}
      <p className="muted">
        Find both on the PC: <code>ipconfig /all</code> → "Physical Address" and "IPv4 Address".
      </p>
      <button type="submit" className="primary" disabled={!macOk || !hostOk}>
        Add device
      </button>
    </form>
  );
}
