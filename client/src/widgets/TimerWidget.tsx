import { useEffect, useState, type FormEvent } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, type TimerRec } from '../db.ts';
import { newId } from '../data.ts';
import { startAlarm, stopAlarm, unlockAudio } from '../alarm.ts';
import { useNow } from '../dates.ts';
import { WidgetFrame, type WidgetProps } from './WidgetFrame.tsx';

const PRESETS_MIN = [1, 3, 5, 10, 15, 30];

function formatMs(ms: number) {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const mmss = `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return h ? `${h}:${mmss}` : mmss;
}

/** Accepts "5" (minutes), "5:30" (m:ss) or "1:05:00" (h:mm:ss). */
function parseDuration(input: string): number | null {
  const parts = input.trim().split(':').map(Number);
  if (!parts.length || parts.some((p) => !Number.isFinite(p) || p < 0)) return null;
  const [a, b = 0, c] = parts;
  const sec = parts.length === 1 ? a * 60 : parts.length === 2 ? a * 60 + b : a * 3600 + b * 60 + (c ?? 0);
  return sec > 0 ? sec * 1000 : null;
}

export function TimerWidget({ widget, editing, onRemove }: WidgetProps) {
  const timers = useLiveQuery(
    () => db.timers.where('widgetId').equals(widget.id).sortBy('createdAt'),
    [widget.id],
    [] as TimerRec[],
  );
  const anyRunning = timers.some((t) => t.endAt !== null);
  const now = useNow(250, anyRunning);
  const [label, setLabel] = useState('');
  const [custom, setCustom] = useState('');

  // Fire alarms for timers that have run out.
  useEffect(() => {
    for (const t of timers) {
      if (t.endAt !== null && t.endAt <= now) void db.timers.update(t.id, { endAt: null, remainingMs: 0, ringing: true });
      if (t.ringing) startAlarm(t.id, t.label);
    }
  }, [timers, now]);

  async function start(durationMs: number) {
    unlockAudio();
    await db.timers.add({
      id: newId(),
      widgetId: widget.id,
      label: label.trim(),
      durationMs,
      endAt: Date.now() + durationMs,
      remainingMs: durationMs,
      ringing: false,
      createdAt: Date.now(),
    });
    setLabel('');
    setCustom('');
  }

  function startCustom(e: FormEvent) {
    e.preventDefault();
    const ms = parseDuration(custom);
    if (ms) void start(ms);
  }

  function togglePause(t: TimerRec) {
    unlockAudio();
    if (t.endAt !== null) void db.timers.update(t.id, { endAt: null, remainingMs: t.endAt - Date.now() });
    else void db.timers.update(t.id, { endAt: Date.now() + t.remainingMs });
  }

  function dismiss(t: TimerRec) {
    stopAlarm(t.id);
    void db.timers.delete(t.id);
  }

  function restart(t: TimerRec) {
    stopAlarm(t.id);
    unlockAudio();
    void db.timers.update(t.id, { endAt: Date.now() + t.durationMs, remainingMs: t.durationMs, ringing: false });
  }

  async function removeWidget() {
    timers.forEach((t) => stopAlarm(t.id));
    await db.timers.where('widgetId').equals(widget.id).delete();
    onRemove();
  }

  return (
    <WidgetFrame title="Timers" icon="⏱️" editing={editing} onRemove={removeWidget}>
      <div className="presets">
        {PRESETS_MIN.map((m) => (
          <button key={m} className="small" onClick={() => start(m * 60_000)}>
            {m} min
          </button>
        ))}
      </div>
      <form className="add-row" onSubmit={startCustom}>
        <input placeholder="Label (optional)" value={label} onChange={(e) => setLabel(e.target.value)} />
        <input
          className="duration"
          placeholder="mm:ss"
          inputMode="numeric"
          value={custom}
          onChange={(e) => setCustom(e.target.value)}
        />
        <button type="submit" className="icon-btn" title="Start" disabled={!parseDuration(custom)}>
          ▶
        </button>
      </form>
      <ul className="timers">
        {timers.map((t) => {
          const remaining = t.endAt !== null ? t.endAt - now : t.remainingMs;
          return (
            <li key={t.id} className={`timer${t.ringing ? ' ringing' : ''}`}>
              <div className="timer-info">
                <span className="timer-time">{t.ringing ? "Time's up!" : formatMs(remaining)}</span>
                <span className="timer-label">{t.label || formatMs(t.durationMs)}</span>
              </div>
              {t.ringing ? (
                <>
                  <button className="primary" onClick={() => dismiss(t)}>
                    Stop
                  </button>
                  <button className="icon-btn" title="Restart" onClick={() => restart(t)}>
                    ↻
                  </button>
                </>
              ) : (
                <>
                  <button className="icon-btn" title={t.endAt !== null ? 'Pause' : 'Resume'} onClick={() => togglePause(t)}>
                    {t.endAt !== null ? '⏸' : '▶'}
                  </button>
                  <button className="icon-btn subtle" title="Cancel" onClick={() => dismiss(t)}>
                    ✕
                  </button>
                </>
              )}
            </li>
          );
        })}
        {timers.length === 0 && <li className="empty">Pick a preset or enter a time</li>}
      </ul>
    </WidgetFrame>
  );
}
