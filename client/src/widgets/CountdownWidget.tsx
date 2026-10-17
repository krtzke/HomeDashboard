import { useState, type FormEvent } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { addDays, differenceInCalendarDays, format } from 'date-fns';
import { newId } from '../data.ts';
import { fromDateStr, toDateStr } from '../dates.ts';
import { COLOR_HEX } from '../colors.ts';
import { coversDay, eventsInRange } from '../events.ts';
import { useWidgetConfig } from './config.ts';
import { WidgetFrame, type WidgetProps } from './WidgetFrame.tsx';
import { EVENT_COLORS } from '../../../shared/src/types.ts';
import type { EventColor, EventRec } from '../../../shared/src/types.ts';

interface CountdownItem {
  id: string;
  title: string;
  date: string;
  emoji: string;
}

interface CountdownConfig {
  items: CountdownItem[];
  /** Also count down to calendar events of this color ('' = off). */
  eventColor: EventColor | '';
}

const DEFAULTS: CountdownConfig = { items: [], eventColor: '' };
const EVENT_HORIZON_DAYS = 365;

interface Row {
  key: string;
  title: string;
  date: string;
  emoji: string;
  /** Manual entries can be deleted here; calendar events are managed in the calendar. */
  manualId?: string;
  ongoing?: boolean;
}

function label(days: number, ongoing?: boolean): [string, string] {
  if (ongoing) return ['Now', ''];
  if (days === 0) return ['Today', '🎉'];
  if (days === 1) return ['1', 'day'];
  return [String(days), 'days'];
}

export function CountdownWidget({ widget, editing, onRemove }: WidgetProps) {
  const [config, setConfig] = useWidgetConfig(widget, DEFAULTS);
  const [adding, setAdding] = useState(false);
  const [settings, setSettings] = useState(false);
  const today = toDateStr(new Date());
  const horizon = toDateStr(addDays(new Date(), EVENT_HORIZON_DAYS));

  const events = useLiveQuery(
    () => (config.eventColor ? eventsInRange(today, horizon) : Promise.resolve([] as EventRec[])),
    [config.eventColor, today, horizon],
    [] as EventRec[],
  );

  const rows: Row[] = [
    ...config.items.filter((i) => i.date >= today).map((i) => ({ key: i.id, title: i.title, date: i.date, emoji: i.emoji || '⏳', manualId: i.id })),
    ...events
      .filter((e) => (e.color ?? 'blue') === config.eventColor)
      .map((e) => ({ key: e.id, title: e.title, date: e.date, emoji: '📅', ongoing: e.date < today && coversDay(e, today) })),
  ];
  rows.sort((a, b) => (a.ongoing ? today : a.date).localeCompare(b.ongoing ? today : b.date));

  const remove = (id: string) => setConfig({ items: config.items.filter((i) => i.id !== id) });

  return (
    <WidgetFrame
      title="Countdown"
      icon="⏳"
      editing={editing}
      onRemove={onRemove}
      onSettings={() => setSettings((s) => !s)}
      settingsOpen={settings}
      actions={
        <button className="icon-btn" title="Add countdown" onClick={() => setAdding((a) => !a)}>
          ＋
        </button>
      }
    >
      {settings && (
        <div className="settings">
          <label className="field">
            Also count down to calendar events with color
            <div className="swatches">
              <button
                className={`swatch none${config.eventColor === '' ? ' active' : ''}`}
                title="Off"
                aria-label="Off"
                onClick={() => setConfig({ eventColor: '' })}
              >
                ∅
              </button>
              {EVENT_COLORS.map((c) => (
                <button
                  key={c}
                  className={`swatch${config.eventColor === c ? ' active' : ''}`}
                  title={c}
                  aria-label={c}
                  style={{ background: COLOR_HEX[c] }}
                  onClick={() => setConfig({ eventColor: c })}
                />
              ))}
            </div>
          </label>
        </div>
      )}
      {adding && (
        <AddCountdown
          onAdd={(item) => {
            setConfig({ items: [...config.items, item] });
            setAdding(false);
          }}
          onCancel={() => setAdding(false)}
        />
      )}
      <ul className="countdowns">
        {rows.map((r) => {
          const days = differenceInCalendarDays(fromDateStr(r.date), fromDateStr(today));
          const [num, unit] = label(days, r.ongoing);
          return (
            <li key={r.key} className={days === 0 || r.ongoing ? 'is-today' : ''}>
              <span className="cd-emoji">{r.emoji}</span>
              <span className="cd-info">
                <span className="cd-title">{r.title}</span>
                <span className="cd-date">{format(fromDateStr(r.date), 'EEE, d MMM yyyy')}</span>
              </span>
              <span className="cd-count">
                <strong>{num}</strong> {unit}
              </span>
              {r.manualId && (
                <button className="icon-btn subtle cd-del" title="Remove" onClick={() => remove(r.manualId!)}>
                  ✕
                </button>
              )}
            </li>
          );
        })}
        {rows.length === 0 && !adding && <li className="empty">Nothing to count down to — click ＋</li>}
      </ul>
    </WidgetFrame>
  );
}

function AddCountdown({ onAdd, onCancel }: { onAdd: (item: CountdownItem) => void; onCancel: () => void }) {
  const [title, setTitle] = useState('');
  const [date, setDate] = useState('');
  const [emoji, setEmoji] = useState('');

  function submit(e: FormEvent) {
    e.preventDefault();
    if (title.trim() && date) onAdd({ id: newId(), title: title.trim(), date, emoji: emoji.trim() });
  }

  return (
    <form className="inline-form" onSubmit={submit}>
      <div className="row">
        <input className="emoji-input" placeholder="🎄" value={emoji} onChange={(e) => setEmoji(e.target.value)} maxLength={8} title="Emoji (optional)" />
        <input autoFocus placeholder="What?" value={title} onChange={(e) => setTitle(e.target.value)} required />
      </div>
      <div className="row">
        <input type="date" value={date} min={toDateStr(new Date())} onChange={(e) => setDate(e.target.value)} required />
        <button type="submit" className="primary">
          Add
        </button>
        <button type="button" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </form>
  );
}
