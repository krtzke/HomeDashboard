import { format, parseISO } from 'date-fns';
import { useEffect, useState } from 'react';

export const WEEK_STARTS_ON = 1; // Monday

export const toDateStr = (d: Date) => format(d, 'yyyy-MM-dd');
export const fromDateStr = (s: string) => parseISO(s);

/** "HH:mm" → minutes since midnight */
export function toMinutes(time: string): number {
  const [h, m] = time.split(':').map(Number);
  return h * 60 + m;
}

/** Re-renders every `intervalMs` and returns the current time. */
export function useNow(intervalMs: number, enabled = true): number {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    if (!enabled) return;
    setNow(Date.now());
    const t = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(t);
  }, [intervalMs, enabled]);
  return now;
}
