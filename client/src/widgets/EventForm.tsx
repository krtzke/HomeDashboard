import { useState, type FormEvent } from 'react';
import { addDays, differenceInCalendarDays } from 'date-fns';
import { create, remove, update } from '../data.ts';
import { fromDateStr, toDateStr } from '../dates.ts';
import { COLOR_HEX } from '../colors.ts';
import { endDateOf } from '../events.ts';
import { EVENT_COLORS } from '../../../shared/src/types.ts';
import type { EventColor, EventRec } from '../../../shared/src/types.ts';

interface Props {
  /** Existing event to edit, or defaults for a new one. */
  event: EventRec | { date: string; start?: string };
  onClose: () => void;
}

export function EventForm({ event, onClose }: Props) {
  const existing = 'id' in event ? event : null;
  const [title, setTitle] = useState(existing?.title ?? '');
  const [date, setDate] = useState(event.date);
  const [endDate, setEndDate] = useState(existing ? endDateOf(existing) : event.date);
  const [allDay, setAllDay] = useState(existing?.allDay ?? false);
  const [start, setStart] = useState(existing?.start || event.start || '09:00');
  const [end, setEnd] = useState(existing?.end ?? '');
  const [notes, setNotes] = useState(existing?.notes ?? '');
  const [color, setColor] = useState<EventColor>(existing?.color ?? 'blue');

  const multiDay = endDate > date;

  /** Moving the start date keeps the event's length. */
  function changeDate(value: string) {
    if (!value) return;
    const span = differenceInCalendarDays(fromDateStr(endDate), fromDateStr(date));
    setDate(value);
    setEndDate(toDateStr(addDays(fromDateStr(value), Math.max(span, 0))));
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!title.trim()) return;
    const finalEnd = endDate < date ? date : endDate;
    const fields = {
      title: title.trim(),
      date,
      endDate: finalEnd,
      allDay,
      start: allDay ? '' : start,
      // Same-day events need an end after the start; multi-day events can end at any time.
      end: allDay || !end || (finalEnd === date && end <= start) ? '' : end,
      notes: notes.trim(),
      color,
    };
    if (existing) await update('events', existing.id, fields);
    else await create('events', fields);
    onClose();
  }

  async function del() {
    if (existing && confirm(`Delete "${existing.title}"?`)) {
      await remove('events', [existing.id]);
      onClose();
    }
  }

  return (
    <form className="event-form" onSubmit={submit}>
      <input autoFocus placeholder="Title" value={title} onChange={(e) => setTitle(e.target.value)} required />
      <div className="row">
        <label className="field">
          From
          <input type="date" value={date} onChange={(e) => changeDate(e.target.value)} required />
        </label>
        <label className="field">
          To
          <input type="date" value={endDate} min={date} onChange={(e) => setEndDate(e.target.value || date)} required />
        </label>
      </div>
      <div className="row">
        <label className="check">
          <input type="checkbox" checked={allDay} onChange={(e) => setAllDay(e.target.checked)} /> All day
        </label>
        {!allDay && (
          <>
            <input type="time" value={start} onChange={(e) => setStart(e.target.value)} required title="Start time" />
            <span>–</span>
            <input type="time" value={end} onChange={(e) => setEnd(e.target.value)} title={multiDay ? 'End time on the last day' : 'End time'} />
          </>
        )}
      </div>
      <div className="swatches" role="radiogroup" aria-label="Color">
        {EVENT_COLORS.map((c) => (
          <button
            key={c}
            type="button"
            role="radio"
            aria-checked={c === color}
            aria-label={c}
            title={c}
            className={`swatch${c === color ? ' active' : ''}`}
            style={{ background: COLOR_HEX[c] }}
            onClick={() => setColor(c)}
          />
        ))}
      </div>
      <textarea placeholder="Notes" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
      <div className="row">
        <button type="submit" className="primary">
          {existing ? 'Save' : 'Add'}
        </button>
        <button type="button" onClick={onClose}>
          Cancel
        </button>
        {existing && (
          <button type="button" className="danger push-right" onClick={del}>
            Delete
          </button>
        )}
      </div>
    </form>
  );
}
