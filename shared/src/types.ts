// Types shared between client and server.
// Every synced record carries the same sync fields; the server treats the rest as opaque JSON.

export const SYNC_TABLES = ['lists', 'items', 'events', 'widgets', 'notes', 'chores', 'birthdays'] as const;
export type SyncTable = (typeof SYNC_TABLES)[number];

export interface SyncFields {
  id: string;
  /** Client timestamp (ms) of the last edit — used for last-write-wins. */
  updatedAt: number;
  /** Tombstone: deleted records are kept so the deletion can sync. */
  deleted: boolean;
}

export interface ListRec extends SyncFields {
  name: string;
  kind: 'todo' | 'shopping';
}

export interface ItemRec extends SyncFields {
  listId: string;
  text: string;
  checked: boolean;
  /** Persistent items stay on the list and are only unchecked when clearing. */
  persistent: boolean;
  sortOrder: number;
}

export const EVENT_COLORS = ['blue', 'green', 'red', 'orange', 'purple', 'teal', 'pink', 'gray'] as const;
export type EventColor = (typeof EVENT_COLORS)[number];

export interface EventRec extends SyncFields {
  title: string;
  /** Local start date, YYYY-MM-DD */
  date: string;
  /** Local end date (inclusive), YYYY-MM-DD; equals `date` for single-day events. Missing on old records. */
  endDate?: string;
  allDay: boolean;
  /** Local time HH:mm on the start date ('' when allDay) */
  start: string;
  /** Local time HH:mm on the end date ('' when open-ended or allDay) */
  end: string;
  notes: string;
  /** Missing on old records (shown as blue). */
  color?: EventColor;
}

export interface NoteRec extends SyncFields {
  title: string;
  /** Markdown-ish text, see client/src/markdown.ts */
  text: string;
}

export interface ChoreRec extends SyncFields {
  widgetId: string;
  title: string;
  intervalDays: number;
  /** YYYY-MM-DD of the last time it was done; null = never (due now). */
  lastDone: string | null;
  /** Value of lastDone before the last 'done' click, for undo. */
  prevDone: string | null;
}

export interface BirthdayRec extends SyncFields {
  name: string;
  month: number; // 1-12
  day: number; // 1-31
  /** Birth year, or null if unknown. */
  year: number | null;
}

export type WidgetType =
  | 'list'
  | 'calendar'
  | 'timeline'
  | 'timer'
  | 'note'
  | 'clock'
  | 'countdown'
  | 'links'
  | 'chores'
  | 'birthdays'
  | 'weather'
  | 'waste'
  | 'system';

export interface WidgetRec extends SyncFields {
  type: WidgetType;
  /** Per-widget settings; each widget type defines its own shape (see client/src/widgets/config.ts). */
  config: { listId?: string; noteId?: string; title?: string; [key: string]: unknown };
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface RecordByTable {
  lists: ListRec;
  items: ItemRec;
  events: EventRec;
  widgets: WidgetRec;
  notes: NoteRec;
  chores: ChoreRec;
  birthdays: BirthdayRec;
}

export interface Change<T extends SyncTable = SyncTable> {
  table: T;
  record: RecordByTable[T];
}

export interface SyncRequest {
  /** Highest server version the client has already seen. */
  since: number;
  changes: Change[];
}

export interface SyncResponse {
  /** New cursor to send as `since` next time. */
  cursor: number;
  /** Records changed on the server after `since` (may include the client's own changes). */
  changes: Change[];
  /** True if more changes are pending — call again with the new cursor. */
  hasMore: boolean;
}

/** Response of GET /api/system (Raspberry Pi health). Values are null where unavailable (e.g. on Windows). */
export interface SystemStatus {
  hostname: string;
  platform: string;
  cpuTempC: number | null;
  /** 1/5/15 minute load averages */
  load: [number, number, number];
  cpuCount: number;
  memTotal: number;
  memAvailable: number;
  diskTotal: number | null;
  diskFree: number | null;
  uptimeSec: number;
  appUptimeSec: number;
  nodeVersion: string;
  dbSizeBytes: number | null;
  /** Raw value of `vcgencmd get_throttled` (bit flags), null if not a Pi. */
  throttled: number | null;
}
