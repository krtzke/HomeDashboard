import { useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import {
  addDays,
  addMonths,
  endOfMonth,
  endOfWeek,
  format,
  isSameMonth,
  startOfMonth,
  startOfWeek,
} from 'date-fns';
import { WEEK_STARTS_ON, fromDateStr, toDateStr } from '../dates.ts';
import { assignLanes, colorOf, coversDay, endDateOf, eventTimeLabel, eventsInRange, sortEvents } from '../events.ts';
import { EventForm } from './EventForm.tsx';
import { WidgetFrame, type WidgetProps } from './WidgetFrame.tsx';
import type { EventRec } from '../../../shared/src/types.ts';

/** Bars shown per day cell; further events are summarised as "+n". */
const MAX_BARS = 3;

export function CalendarWidget({ editing, onRemove }: WidgetProps) {
  const today = toDateStr(new Date());
  const [month, setMonth] = useState(() => startOfMonth(new Date()));
  const [selected, setSelected] = useState(today);
  const [form, setForm] = useState<EventRec | { date: string } | null>(null);

  const days = useMemo(() => {
    const first = startOfWeek(month, { weekStartsOn: WEEK_STARTS_ON });
    const last = endOfWeek(endOfMonth(month), { weekStartsOn: WEEK_STARTS_ON });
    const result: string[] = [];
    for (let d = first; d <= last; d = addDays(d, 1)) result.push(toDateStr(d));
    return result;
  }, [month]);

  const from = days[0];
  const to = days[days.length - 1];
  const events = useLiveQuery(() => eventsInRange(from, to), [from, to], [] as EventRec[]);
  const lanes = useMemo(() => assignLanes(events, days), [events, days]);

  const selectedEvents = events.filter((e) => coversDay(e, selected)).sort(sortEvents);

  function goToday() {
    setMonth(startOfMonth(new Date()));
    setSelected(today);
  }

  return (
    <WidgetFrame
      title={format(month, 'MMMM yyyy')}
      icon="📅"
      editing={editing}
      onRemove={onRemove}
      actions={
        <>
          <button className="icon-btn" title="Previous month" onClick={() => setMonth((m) => addMonths(m, -1))}>
            ‹
          </button>
          <button className="small" onClick={goToday}>
            Today
          </button>
          <button className="icon-btn" title="Next month" onClick={() => setMonth((m) => addMonths(m, 1))}>
            ›
          </button>
        </>
      }
    >
      <div className="month">
        {days.slice(0, 7).map((d) => (
          <div key={d} className="weekday">
            {format(fromDateStr(d), 'EEEEEE')}
          </div>
        ))}
        {days.map((ds, i) => {
          const dayLanes = lanes.get(ds) ?? [];
          const hidden = dayLanes.slice(MAX_BARS).filter(Boolean).length;
          const cls = [
            'day',
            !isSameMonth(fromDateStr(ds), month) && 'outside',
            ds === today && 'today',
            ds === selected && 'selected',
          ]
            .filter(Boolean)
            .join(' ');
          return (
            <button key={ds} className={cls} onClick={() => setSelected(ds)} onDoubleClick={() => setForm({ date: ds })}>
              <span className="day-num">{fromDateStr(ds).getDate()}</span>
              <span className="bars">
                {dayLanes.slice(0, MAX_BARS).map((e, lane) =>
                  e ? (
                    <span
                      key={lane}
                      title={e.title}
                      className={[
                        'bar',
                        // Continue the bar into the neighbouring cell unless the event or the week starts/ends here.
                        e.date !== ds && i % 7 !== 0 && 'cont-l',
                        endDateOf(e) !== ds && i % 7 !== 6 && 'cont-r',
                      ]
                        .filter(Boolean)
                        .join(' ')}
                      style={{ background: colorOf(e) }}
                    />
                  ) : (
                    <span key={lane} className="bar empty" />
                  ),
                )}
                {hidden > 0 && <span className="more">+{hidden}</span>}
              </span>
            </button>
          );
        })}
      </div>

      <div className="day-detail">
        <div className="day-detail-head">
          <strong>{format(fromDateStr(selected), 'EEEE, d MMM')}</strong>
          <button className="small" onClick={() => setForm({ date: selected })}>
            ＋ Event
          </button>
        </div>
        {form ? (
          <EventForm key={'id' in form ? form.id : form.date} event={form} onClose={() => setForm(null)} />
        ) : (
          <ul className="event-list">
            {selectedEvents.map((e) => (
              <li key={e.id} onClick={() => setForm(e)} title={e.notes || undefined}>
                <span className="color-dot" style={{ background: colorOf(e) }} />
                <span className="event-title">{e.title}</span>
                <span className="event-time">{eventTimeLabel(e)}</span>
              </li>
            ))}
            {selectedEvents.length === 0 && <li className="empty">No appointments</li>}
          </ul>
        )}
      </div>
    </WidgetFrame>
  );
}
