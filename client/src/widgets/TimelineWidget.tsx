import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { addDays, differenceInCalendarDays, format } from 'date-fns';
import { fromDateStr, toDateStr, useNow } from '../dates.ts';
import { colorOf, coversDay, daySegment, eventTimeLabel, eventsInRange, isMultiDay, sortEvents, spanDays } from '../events.ts';
import { EventForm } from './EventForm.tsx';
import { WidgetFrame, type WidgetProps } from './WidgetFrame.tsx';
import type { EventRec } from '../../../shared/src/types.ts';

const HOUR_PX = 48;
const UPCOMING_DAYS = 7;

interface Placed {
  event: EventRec;
  startMin: number;
  endMin: number;
  lane: number;
  lanes: number;
}

/** Assigns overlapping time blocks to side-by-side lanes. */
function layoutBlocks(blocks: Omit<Placed, 'lane' | 'lanes'>[]): Placed[] {
  const placed: Placed[] = blocks.map((b) => ({ ...b, lane: 0, lanes: 1 })).sort((a, b) => a.startMin - b.startMin);

  let group: Placed[] = [];
  let groupEnd = -1;
  const flush = () => group.forEach((p) => (p.lanes = Math.max(...group.map((g) => g.lane)) + 1));
  for (const p of placed) {
    if (p.startMin >= groupEnd) {
      flush();
      group = [];
    }
    const laneEnds = new Map<number, number>();
    for (const g of group) laneEnds.set(g.lane, Math.max(laneEnds.get(g.lane) ?? 0, g.endMin));
    let lane = 0;
    while ((laneEnds.get(lane) ?? -1) > p.startMin) lane++;
    p.lane = lane;
    group.push(p);
    groupEnd = Math.max(groupEnd, p.endMin);
  }
  flush();
  return placed;
}

/** "Vacation · day 2/5" for multi-day events. */
function dayOfSpan(e: EventRec, day: string) {
  return `day ${differenceInCalendarDays(fromDateStr(day), fromDateStr(e.date)) + 1}/${spanDays(e)}`;
}

export function TimelineWidget({ editing, onRemove }: WidgetProps) {
  const today = toDateStr(new Date());
  const [day, setDay] = useState(today);
  const [form, setForm] = useState<EventRec | { date: string; start?: string } | null>(null);
  const now = useNow(60_000);
  const scrollRef = useRef<HTMLDivElement>(null);

  const upcomingTo = toDateStr(addDays(fromDateStr(day), UPCOMING_DAYS));
  const events = useLiveQuery(() => eventsInRange(day, upcomingTo), [day, upcomingTo], [] as EventRec[]);

  const dayEvents = events.filter((e) => coversDay(e, day)).sort(sortEvents);
  const chips: EventRec[] = [];
  const blocks: Omit<Placed, 'lane' | 'lanes'>[] = [];
  for (const e of dayEvents) {
    const seg = daySegment(e, day);
    if (seg.kind === 'chip') chips.push(e);
    else blocks.push({ event: e, startMin: seg.startMin, endMin: seg.endMin });
  }
  const timed = layoutBlocks(blocks);
  // Upcoming: events starting after this day (ongoing ones are already shown above).
  const upcoming = events.filter((e) => e.date > day).sort(sortEvents);

  const isToday = day === today;
  const nowDate = new Date(now);
  const nowMin = nowDate.getHours() * 60 + nowDate.getMinutes();

  // Scroll to the current time (or the first event) when the day changes.
  useEffect(() => {
    const target = isToday ? nowMin : (timed[0]?.startMin ?? 8 * 60);
    scrollRef.current?.scrollTo({ top: Math.max(0, (target / 60 - 1) * HOUR_PX) });
  }, [day]);

  function shiftDay(n: number) {
    setDay((d) => toDateStr(addDays(fromDateStr(d), n)));
    setForm(null);
  }

  return (
    <WidgetFrame
      title={isToday ? 'Today' : format(fromDateStr(day), 'EEE, d MMM')}
      icon="🕒"
      editing={editing}
      onRemove={onRemove}
      actions={
        <>
          <button className="icon-btn" title="Previous day" onClick={() => shiftDay(-1)}>
            ‹
          </button>
          {!isToday && (
            <button className="small" onClick={() => setDay(today)}>
              Today
            </button>
          )}
          <button className="icon-btn" title="Next day" onClick={() => shiftDay(1)}>
            ›
          </button>
        </>
      }
    >
      {form ? (
        <EventForm key={'id' in form ? form.id : form.date + form.start} event={form} onClose={() => setForm(null)} />
      ) : (
        <>
          {chips.length > 0 && (
            <div className="allday">
              {chips.map((e) => (
                <button
                  key={e.id}
                  className="chip"
                  style={{ '--event-color': colorOf(e) } as CSSProperties}
                  onClick={() => setForm(e)}
                  title={eventTimeLabel(e)}
                >
                  {e.title}
                  {isMultiDay(e) && <span className="chip-sub"> · {dayOfSpan(e, day)}</span>}
                </button>
              ))}
            </div>
          )}
          <div className="timeline-scroll" ref={scrollRef}>
            <div className="timeline" style={{ height: 24 * HOUR_PX }}>
              {Array.from({ length: 24 }, (_, h) => (
                <div
                  key={h}
                  className="hour"
                  style={{ top: h * HOUR_PX, height: HOUR_PX }}
                  onClick={() => setForm({ date: day, start: `${String(h).padStart(2, '0')}:00` })}
                >
                  <span>{String(h).padStart(2, '0')}:00</span>
                </div>
              ))}
              {timed.map(({ event, startMin, endMin, lane, lanes }) => (
                <button
                  key={event.id}
                  className="tl-event"
                  style={
                    {
                      '--event-color': colorOf(event),
                      top: (startMin / 60) * HOUR_PX,
                      height: Math.max(((endMin - startMin) / 60) * HOUR_PX - 2, 18),
                      left: `calc(3.2rem + (100% - 3.4rem) * ${lane / lanes})`,
                      width: `calc((100% - 3.4rem) / ${lanes} - 2px)`,
                    } as CSSProperties
                  }
                  onClick={() => setForm(event)}
                  title={event.notes || undefined}
                >
                  <strong>{event.title}</strong> <span>{eventTimeLabel(event)}</span>
                </button>
              ))}
              {isToday && <div className="now-line" style={{ top: (nowMin / 60) * HOUR_PX }} />}
            </div>
          </div>
          {upcoming.length > 0 && (
            <div className="upcoming">
              <h3>Next {UPCOMING_DAYS} days</h3>
              <ul className="event-list">
                {upcoming.slice(0, 8).map((e) => (
                  <li key={e.id} onClick={() => setForm(e)}>
                    <span className="color-dot" style={{ background: colorOf(e) }} />
                    <span className="event-time">{format(fromDateStr(e.date), 'EEE d')}</span>
                    <span className="event-title">
                      {!e.allDay && !isMultiDay(e) ? `${e.start} ` : ''}
                      {e.title}
                      {isMultiDay(e) && <span className="event-time"> · {spanDays(e)} days</span>}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </>
      )}
    </WidgetFrame>
  );
}
