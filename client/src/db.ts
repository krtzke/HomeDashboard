import Dexie, { type EntityTable } from 'dexie';
import type { BirthdayRec, ChoreRec, EventRec, ItemRec, ListRec, NoteRec, PageRec, SyncTable, WidgetRec } from '../../shared/src/types.ts';

/** A pending local change that still has to be pushed to the server. */
export interface OutboxEntry {
  key: string; // `${table}:${id}`
  table: SyncTable;
  id: string;
  updatedAt: number;
}

export interface MetaEntry {
  key: string;
  value: unknown;
}

/** Timers are device-local (they ring on the device that started them) and never sync. */
export interface TimerRec {
  id: string;
  widgetId: string;
  label: string;
  durationMs: number;
  /** Timestamp when the timer fires; null while paused/stopped. */
  endAt: number | null;
  /** Remaining time while paused. */
  remainingMs: number;
  ringing: boolean;
  createdAt: number;
}

class DashboardDB extends Dexie {
  lists!: EntityTable<ListRec, 'id'>;
  items!: EntityTable<ItemRec, 'id'>;
  events!: EntityTable<EventRec, 'id'>;
  widgets!: EntityTable<WidgetRec, 'id'>;
  notes!: EntityTable<NoteRec, 'id'>;
  chores!: EntityTable<ChoreRec, 'id'>;
  birthdays!: EntityTable<BirthdayRec, 'id'>;
  pages!: EntityTable<PageRec, 'id'>;
  outbox!: EntityTable<OutboxEntry, 'key'>;
  meta!: EntityTable<MetaEntry, 'key'>;
  timers!: EntityTable<TimerRec, 'id'>;

  constructor() {
    super('home-dashboard');
    this.version(1).stores({
      lists: 'id',
      items: 'id, listId',
      events: 'id, date',
      widgets: 'id',
      outbox: 'key',
      meta: 'key',
      timers: 'id, widgetId',
    });
    this.version(2).stores({ notes: 'id' });
    this.version(3).stores({ chores: 'id, widgetId', birthdays: 'id' });
    this.version(4).stores({ pages: 'id' });
  }
}

export const db = new DashboardDB();

export async function getMeta<T>(key: string, fallback: T): Promise<T> {
  const row = await db.meta.get(key);
  return row ? (row.value as T) : fallback;
}

export function setMeta(key: string, value: unknown) {
  return db.meta.put({ key, value });
}
