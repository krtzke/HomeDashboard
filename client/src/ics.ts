// Minimal iCalendar (ICS) parser for date-based calendars such as waste collection schedules.
// Supports all-day and timed DTSTART, SUMMARY, STATUS:CANCELLED, EXDATE and simple RRULEs
// (FREQ=DAILY/WEEKLY/MONTHLY/YEARLY with INTERVAL, COUNT, UNTIL and BYDAY for weekly rules).
import { addDays, addMonths, addYears, format, getDay, parseISO, startOfWeek } from 'date-fns';

export interface IcsEvent {
  /** Local date YYYY-MM-DD */
  date: string;
  summary: string;
}

interface Prop {
  params: Record<string, string>;
  value: string;
}

const MAX_OCCURRENCES = 5000;
const WEEKDAYS = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];

const unescape = (s: string) => s.replace(/\\n/gi, ' ').replace(/\\([,;\\])/g, '$1').trim();

function parseLine(line: string): [string, Prop] | null {
  const colon = line.search(/:(?=(?:[^"]*"[^"]*")*[^"]*$)/); // first colon outside quotes
  if (colon < 0) return null;
  const [name, ...paramParts] = line.slice(0, colon).split(';');
  const params: Record<string, string> = {};
  for (const p of paramParts) {
    const [k, v = ''] = p.split('=');
    params[k.toUpperCase()] = v.replace(/^"|"$/g, '');
  }
  return [name.toUpperCase(), { params, value: line.slice(colon + 1) }];
}

/** ICS date or date-time → local YYYY-MM-DD. UTC times ("…Z") are converted to local time. */
export function icsDate(value: string): string | null {
  const m = value.match(/^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})(Z)?)?/);
  if (!m) return null;
  if (m[7]) return format(new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6])), 'yyyy-MM-dd');
  return `${m[1]}-${m[2]}-${m[3]}`;
}

/** Expands an RRULE starting at `start` and returns occurrence dates (YYYY-MM-DD) up to `to`. */
export function expandRrule(start: string, rrule: string, to: string): string[] {
  const rule = Object.fromEntries(rrule.split(';').map((p) => p.split('=') as [string, string]));
  const interval = Math.max(1, Number(rule.INTERVAL) || 1);
  const count = rule.COUNT ? Number(rule.COUNT) : Infinity;
  const until = rule.UNTIL ? icsDate(rule.UNTIL) ?? to : to;
  const end = until < to ? until : to;
  const s = parseISO(start);
  const out: string[] = [];
  const push = (d: Date) => {
    const ds = format(d, 'yyyy-MM-dd');
    if (ds < start || ds > end || out.length >= count) return false;
    out.push(ds);
    return true;
  };

  if (rule.FREQ === 'WEEKLY' && rule.BYDAY) {
    const days = rule.BYDAY.split(',')
      .map((d) => WEEKDAYS.indexOf(d.slice(-2)))
      .filter((d) => d >= 0)
      .sort((a, b) => ((a + 6) % 7) - ((b + 6) % 7)); // Monday-first order
    const wkst = startOfWeek(s, { weekStartsOn: 1 });
    for (let w = 0; out.length < count && w < MAX_OCCURRENCES; w++) {
      const weekStart = addDays(wkst, w * 7 * interval);
      if (format(weekStart, 'yyyy-MM-dd') > end) break;
      for (const wd of days) {
        const d = addDays(weekStart, (wd + 6) % 7);
        if (getDay(d) === wd) push(d);
      }
    }
    return out;
  }

  const step: Record<string, (d: Date, n: number) => Date> = {
    DAILY: (d, n) => addDays(d, n),
    WEEKLY: (d, n) => addDays(d, 7 * n),
    MONTHLY: (d, n) => addMonths(d, n),
    YEARLY: (d, n) => addYears(d, n),
  };
  const next = step[rule.FREQ];
  if (!next) return [start];
  for (let i = 0; i < MAX_OCCURRENCES && out.length < count; i++) {
    const d = next(s, i * interval);
    // Months/years without that day (e.g. the 31st) are skipped, as the spec requires.
    if ((rule.FREQ === 'MONTHLY' || rule.FREQ === 'YEARLY') && d.getDate() !== s.getDate()) continue;
    if (format(d, 'yyyy-MM-dd') > end) break;
    push(d);
  }
  return out;
}

/** Parses an ICS file and returns events between `from` and `to` (inclusive), sorted by date. */
export function parseIcs(text: string, from: string, to: string): IcsEvent[] {
  const lines = text.replace(/\r\n?/g, '\n').replace(/\n[ \t]/g, '').split('\n');
  const events: IcsEvent[] = [];
  let props: [string, Prop][] | null = null;

  for (const line of lines) {
    if (line === 'BEGIN:VEVENT') props = [];
    else if (line === 'END:VEVENT' && props) {
      const get = (n: string) => props!.find(([k]) => k === n)?.[1];
      const start = get('DTSTART') && icsDate(get('DTSTART')!.value);
      const status = get('STATUS')?.value.toUpperCase();
      if (start && status !== 'CANCELLED') {
        const summary = unescape(get('SUMMARY')?.value ?? '');
        const exdates = new Set(
          props.filter(([k]) => k === 'EXDATE').flatMap(([, p]) => p.value.split(',').map(icsDate)),
        );
        const rrule = get('RRULE')?.value;
        const dates = rrule ? expandRrule(start, rrule, to) : [start];
        for (const date of dates) {
          if (date >= from && date <= to && !exdates.has(date)) events.push({ date, summary });
        }
      }
      props = null;
    } else if (props) {
      const parsed = parseLine(line);
      if (parsed) props.push(parsed);
    }
  }
  return events.sort((a, b) => a.date.localeCompare(b.date) || a.summary.localeCompare(b.summary));
}
