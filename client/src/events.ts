// Event helpers: colors, date ranges, querying and month-view lane layout.
import { differenceInCalendarDays, format } from 'date-fns';
import { db } from './db.ts';
import { fromDateStr, toMinutes } from './dates.ts';
import { COLOR_HEX } from './colors.ts';
import type { EventRec } from '../../shared/src/types.ts';

export const colorOf = (e: EventRec) => COLOR_HEX[e.color ?? 'blue'] ?? COLOR_HEX.blue;
export const endDateOf = (e: EventRec) => e.endDate || e.date;
export const isMultiDay = (e: EventRec) => endDateOf(e) !== e.date;
export const spanDays = (e: EventRec) => differenceInCalendarDays(fromDateStr(endDateOf(e)), fromDateStr(e.date)) + 1;
export const coversDay = (e: EventRec, day: string) => e.date <= day && endDateOf(e) >= day;

/** All non-deleted events overlapping [from, to] (inclusive). */
export function eventsInRange(from: string, to: string): Promise<EventRec[]> {
  return db.events
    .where('date')
    .belowOrEqual(to)
    .filter((e) => !e.deleted && endDateOf(e) >= from)
    .toArray();
}

/** Start date, then longer events first (so multi-day bars sit on top), then all-day, then time. */
export function sortEvents(a: EventRec, b: EventRec) {
  if (a.date !== b.date) return a.date < b.date ? -1 : 1;
  const span = spanDays(b) - spanDays(a);
  if (span) return span;
  if (a.allDay !== b.allDay) return a.allDay ? -1 : 1;
  return a.start.localeCompare(b.start);
}

const shortDate = (d: string) => format(fromDateStr(d), 'EEE d MMM');

export function eventTimeLabel(e: EventRec) {
  if (isMultiDay(e)) {
    const from = shortDate(e.date) + (e.allDay || !e.start ? '' : ` ${e.start}`);
    const to = shortDate(endDateOf(e)) + (e.allDay || !e.end ? '' : ` ${e.end}`);
    return `${from} – ${to}`;
  }
  if (e.allDay) return 'All day';
  return e.end ? `${e.start}–${e.end}` : e.start;
}

/**
 * Assigns each event a lane (row) so that a multi-day event keeps the same row on every day it covers.
 * Returns, per day, the lane array (null = free lane).
 */
export function assignLanes(events: EventRec[], days: string[]): Map<string, (EventRec | null)[]> {
  const lanes = new Map<string, (EventRec | null)[]>(days.map((d) => [d, []]));
  for (const e of [...events].sort(sortEvents)) {
    const covered = days.filter((d) => coversDay(e, d));
    let lane = 0;
    while (covered.some((d) => lanes.get(d)![lane])) lane++;
    for (const d of covered) {
      const row = lanes.get(d)!;
      while (row.length < lane) row.push(null);
      row[lane] = e;
    }
  }
  return lanes;
}

const DEFAULT_DURATION_MIN = 60;

/** How an event appears on one day of the timeline: as an all-day chip or as a time block. */
export function daySegment(e: EventRec, day: string): { kind: 'chip' } | { kind: 'block'; startMin: number; endMin: number } {
  if (e.allDay) return { kind: 'chip' };
  const first = e.date === day;
  const last = endDateOf(e) === day;
  if (first && last) {
    const startMin = toMinutes(e.start);
    const endMin = e.end ? toMinutes(e.end) : startMin + DEFAULT_DURATION_MIN;
    return { kind: 'block', startMin, endMin: Math.max(endMin, startMin + 15) };
  }
  if (first) return { kind: 'block', startMin: toMinutes(e.start), endMin: 24 * 60 };
  if (last && e.end) return { kind: 'block', startMin: 0, endMin: Math.max(toMinutes(e.end), 15) };
  return { kind: 'chip' };
}
