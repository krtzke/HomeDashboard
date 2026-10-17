import { useState, type FormEvent } from 'react';
import { newId } from '../data.ts';
import { useWidgetConfig } from './config.ts';
import { WidgetFrame, type WidgetProps } from './WidgetFrame.tsx';

interface LinkItem {
  id: string;
  title: string;
  url: string;
  emoji: string;
}

interface LinksConfig {
  links: LinkItem[];
}

const DEFAULTS: LinksConfig = { links: [] };

/**
 * Adds a scheme if missing: LAN-style hosts (IPs, localhost, .local/.lan/.box/.home, no dot) get http://,
 * everything else https://. Returns null for anything that isn't http(s).
 */
export function normalizeUrl(input: string): string | null {
  let s = input.trim();
  if (!s) return null;
  if (!/^[a-z][a-z0-9+.-]*:/i.test(s)) {
    const host = s.split(/[/:?#]/)[0];
    const lan = /^(\d{1,3}\.){3}\d{1,3}$/.test(host) || !host.includes('.') || /\.(local|lan|box|home|internal)$/i.test(host);
    s = `${lan ? 'http' : 'https'}://${s}`;
  }
  try {
    const url = new URL(s);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.toString() : null;
  } catch {
    return null;
  }
}

const hostOf = (url: string) => new URL(url).host.replace(/^www\./, '');

/** Emoji if set, else the site's favicon once it has loaded, else the first letter (also while loading). */
function LinkIcon({ link }: { link: LinkItem }) {
  const [state, setState] = useState<'loading' | 'loaded' | 'failed'>('loading');
  if (link.emoji) return <span className="link-icon emoji">{link.emoji}</span>;
  return (
    <>
      {state !== 'failed' && (
        <img
          className="link-icon"
          style={state === 'loaded' ? undefined : { display: 'none' }}
          src={`${new URL(link.url).origin}/favicon.ico`}
          alt=""
          onLoad={() => setState('loaded')}
          onError={() => setState('failed')}
        />
      )}
      {state !== 'loaded' && <span className="link-icon letter">{(link.title || hostOf(link.url))[0].toUpperCase()}</span>}
    </>
  );
}

export function LinksWidget({ widget, editing, onRemove }: WidgetProps) {
  const [config, setConfig] = useWidgetConfig(widget, DEFAULTS);
  const [settings, setSettings] = useState(false);
  const links = config.links;

  const move = (i: number, dir: -1 | 1) => {
    const next = [...links];
    [next[i], next[i + dir]] = [next[i + dir], next[i]];
    setConfig({ links: next });
  };

  return (
    <WidgetFrame
      title="Quick links"
      icon="🔗"
      editing={editing}
      onRemove={onRemove}
      onSettings={() => setSettings((s) => !s)}
      settingsOpen={settings}
    >
      {settings ? (
        <div className="settings">
          <AddLink onAdd={(l) => setConfig({ links: [...links, l] })} />
          <ul className="link-edit-list">
            {links.map((l, i) => (
              <li key={l.id}>
                <LinkIcon link={l} />
                <span className="link-edit-title">
                  {l.title}
                  <small>{l.url}</small>
                </span>
                <button className="icon-btn" title="Move up" disabled={i === 0} onClick={() => move(i, -1)}>
                  ↑
                </button>
                <button className="icon-btn" title="Move down" disabled={i === links.length - 1} onClick={() => move(i, 1)}>
                  ↓
                </button>
                <button className="icon-btn subtle" title="Remove" onClick={() => setConfig({ links: links.filter((x) => x.id !== l.id) })}>
                  ✕
                </button>
              </li>
            ))}
          </ul>
          <button className="primary" onClick={() => setSettings(false)}>
            Done
          </button>
        </div>
      ) : (
        <div className="link-grid">
          {links.map((l) => (
            <a key={l.id} className="link-tile" href={l.url} target="_blank" rel="noopener noreferrer" title={l.url}>
              <LinkIcon link={l} />
              <span>{l.title}</span>
            </a>
          ))}
          {links.length === 0 && (
            <p className="empty">
              No links yet — click <button className="link-btn" onClick={() => setSettings(true)}>⚙</button> to add some
            </p>
          )}
        </div>
      )}
    </WidgetFrame>
  );
}

function AddLink({ onAdd }: { onAdd: (link: LinkItem) => void }) {
  const [title, setTitle] = useState('');
  const [url, setUrl] = useState('');
  const [emoji, setEmoji] = useState('');
  const normalized = normalizeUrl(url);

  function submit(e: FormEvent) {
    e.preventDefault();
    if (!normalized) return;
    onAdd({ id: newId(), title: title.trim() || hostOf(normalized), url: normalized, emoji: emoji.trim() });
    setTitle('');
    setUrl('');
    setEmoji('');
  }

  return (
    <form className="inline-form" onSubmit={submit}>
      <div className="row">
        <input className="emoji-input" placeholder="🌐" value={emoji} onChange={(e) => setEmoji(e.target.value)} maxLength={8} title="Emoji (optional, otherwise the site's icon)" />
        <input placeholder="Title" value={title} onChange={(e) => setTitle(e.target.value)} />
      </div>
      <div className="row">
        <input placeholder="URL, e.g. 192.168.178.1 or example.com" value={url} onChange={(e) => setUrl(e.target.value)} required />
        <button type="submit" className="primary" disabled={!normalized}>
          Add
        </button>
      </div>
    </form>
  );
}
