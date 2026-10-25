// When a recurring chore counts as done, due or overdue.
// A chore stays checked until it resets: a daily chore at the end of the day it was done, a weekly one
// at the end of that week's Sunday (weeks run Monday–Sunday). "Every N days/weeks" stretches that to N periods.
import { addDays, addWeeks, differenceInCalendarDays, differenceInCalendarWeeks, startOfWeek } from 'date-fns';
import { WEEK_STARTS_ON, fromDateStr, toDateStr } from './dates.ts';
import type { ChoreRec } from '../../shared/src/types.ts';

export type ChoreUnit = 'days' | 'weeks';

/** Weekly intervals are stored as multiples of 7 days. */
export const choreUnit = (intervalDays: number): ChoreUnit => (intervalDays % 7 === 0 ? 'weeks' : 'days');

export type ChoreStatus =
  /** Checked until the end of `resetsAfter` (YYYY-MM-DD). */
  | { state: 'done'; resetsAfter: string }
  /** `overdueBy`: whole days or weeks (see `unit`) past the period it was due in. */
  | { state: 'due' | 'overdue'; unit: ChoreUnit; overdueBy: number };

export function choreStatus(chore: Pick<ChoreRec, 'intervalDays' | 'lastDone'>, today: string): ChoreStatus {
  const unit = choreUnit(chore.intervalDays);
  if (!chore.lastDone) return { state: 'due', unit, overdueBy: 0 };

  const now = fromDateStr(today);
  const done = fromDateStr(chore.lastDone);
  // First day it's due again, and how many periods today is past that.
  let dueFrom: Date;
  let behind: number;
  if (unit === 'weeks') {
    const opts = { weekStartsOn: WEEK_STARTS_ON } as const;
    dueFrom = addWeeks(startOfWeek(done, opts), chore.intervalDays / 7);
    behind = differenceInCalendarWeeks(now, dueFrom, opts);
  } else {
    dueFrom = addDays(done, chore.intervalDays);
    behind = differenceInCalendarDays(now, dueFrom);
  }
  if (behind < 0) return { state: 'done', resetsAfter: toDateStr(addDays(dueFrom, -1)) };
  return { state: behind === 0 ? 'due' : 'overdue', unit, overdueBy: behind };
}
