import { useState, type FormEvent } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { addDays, differenceInCalendarDays } from 'date-fns';
import { db } from '../db.ts';
import { create, remove, update } from '../data.ts';
import { fromDateStr, toDateStr } from '../dates.ts';
import { useWidgetConfig } from './config.ts';
import { WidgetFrame, type WidgetProps } from './WidgetFrame.tsx';
import type { ChoreRec, WidgetRec } from '../../../shared/src/types.ts';

function dueIn(chore: ChoreRec, today: string): number {
  if (!chore.lastDone) return 0;
  const due = addDays(fromDateStr(chore.lastDone), chore.intervalDays);
  return differenceInCalendarDays(due, fromDateStr(today));
}

function status(days: number): [string, string] {
  if (days < 0) return [`${-days} day${days === -1 ? '' : 's'} overdue`, 'overdue'];
  if (days === 0) return ['Due today', 'due'];
  if (days === 1) return ['Tomorrow', ''];
  return [`in ${days} days`, ''];
}

function every(n: number) {
  if (n === 1) return 'daily';
  if (n % 7 === 0) return n === 7 ? 'weekly' : `every ${n / 7} weeks`;
  return `every ${n} days`;
}

/** Called when the widget is removed: deletes its chores (on all devices). */
export async function cleanupChores(w: WidgetRec): Promise<boolean> {
  const ids = (await db.chores.where('widgetId').equals(w.id).filter((c) => !c.deleted).primaryKeys()) as string[];
  if (ids.length && !confirm(`Remove this widget and its ${ids.length} chore(s) on all devices?`)) return false;
  await remove('chores', ids);
  return true;
}

export function ChoresWidget({ widget, editing, onRemove }: WidgetProps) {
  const today = toDateStr(new Date());
  const chores = useLiveQuery(
    () => db.chores.where('widgetId').equals(widget.id).filter((c) => !c.deleted).toArray(),
    [widget.id],
    [] as ChoreRec[],
  );
  const [adding, setAdding] = useState(false);
  const sorted = [...chores].sort((a, b) => dueIn(a, today) - dueIn(b, today) || a.title.localeCompare(b.title));
  const dueCount = chores.filter((c) => dueIn(c, today) <= 0 && c.lastDone !== today).length;
  const [config, setConfig] = useWidgetConfig(widget, { title: 'Chores' });
  const name = config.title || 'Chores';

  function rename() {
    const title = prompt('Widget name', name)?.trim();
    if (title) void setConfig({ title });
  }

  const title = editing ? (
    <button className="link-btn" onClick={rename} title="Rename">
      {name} ✎
    </button>
  ) : dueCount ? (
    `${name} · ${dueCount} due`
  ) : (
    name
  );

  const markDone = (c: ChoreRec) => update('chores', c.id, { lastDone: today, prevDone: c.lastDone });
  const undo = (c: ChoreRec) => update('chores', c.id, { lastDone: c.prevDone, prevDone: null });

  return (
    <WidgetFrame
      title={title}
      icon="🧹"
      editing={editing}
      onRemove={onRemove}
      actions={
        <button className="icon-btn" title="Add chore" onClick={() => setAdding((a) => !a)}>
          ＋
        </button>
      }
    >
      {adding && <AddChore widgetId={widget.id} onDone={() => setAdding(false)} />}
      <ul className="chores">
        {sorted.map((c) => {
          const doneToday = c.lastDone === today;
          const [text, cls] = status(dueIn(c, today));
          return (
            <li key={c.id} className={doneToday ? 'done' : cls}>
              {doneToday ? (
                <button className="chore-check checked" title="Undo" onClick={() => undo(c)}>
                  ✓
                </button>
              ) : (
                <button className="chore-check" title="Mark as done" onClick={() => markDone(c)} />
              )}
              <span className="chore-info">
                <span className="chore-title">{c.title}</span>
                <span className="chore-every">
                  {every(c.intervalDays)}
                  {c.lastDone && !doneToday && ` · last ${differenceInCalendarDays(fromDateStr(today), fromDateStr(c.lastDone))}d ago`}
                </span>
              </span>
              <span className={`chore-status ${cls}`}>{doneToday ? 'Done ✓' : c.lastDone ? text : 'Due now'}</span>
              {editing && (
                <button className="icon-btn subtle" title="Delete chore" onClick={() => remove('chores', [c.id])}>
                  ✕
                </button>
              )}
            </li>
          );
        })}
        {chores.length === 0 && !adding && <li className="empty">No chores yet — click ＋</li>}
      </ul>
    </WidgetFrame>
  );
}

function AddChore({ widgetId, onDone }: { widgetId: string; onDone: () => void }) {
  const [title, setTitle] = useState('');
  const [n, setN] = useState('1');
  const [unit, setUnit] = useState<'days' | 'weeks'>('weeks');
  const [doneToday, setDoneToday] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    const count = Math.max(1, Math.round(Number(n)) || 1);
    if (!title.trim()) return;
    await create('chores', {
      widgetId,
      title: title.trim(),
      intervalDays: unit === 'weeks' ? count * 7 : count,
      lastDone: doneToday ? toDateStr(new Date()) : null,
      prevDone: null,
    });
    onDone();
  }

  return (
    <form className="inline-form" onSubmit={submit}>
      <input autoFocus placeholder="e.g. Water the plants" value={title} onChange={(e) => setTitle(e.target.value)} required />
      <div className="row">
        <span>every</span>
        <input className="num-input" type="number" min={1} value={n} onChange={(e) => setN(e.target.value)} />
        <select value={unit} onChange={(e) => setUnit(e.target.value as 'days' | 'weeks')}>
          <option value="days">days</option>
          <option value="weeks">weeks</option>
        </select>
      </div>
      <div className="row">
        <label className="check">
          <input type="checkbox" checked={doneToday} onChange={(e) => setDoneToday(e.target.checked)} /> Already done today
        </label>
        <button type="submit" className="primary push-right">
          Add
        </button>
        <button type="button" onClick={onDone}>
          Cancel
        </button>
      </div>
    </form>
  );
}
