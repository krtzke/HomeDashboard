// All writes to synced tables go through here: they stamp updatedAt and queue the change in the outbox.
import { db } from './db.ts';
import { scheduleSync } from './sync.ts';
import type { RecordByTable, SyncTable } from '../../shared/src/types.ts';

type NewRecord<T extends SyncTable> = Omit<RecordByTable[T], 'id' | 'updatedAt' | 'deleted'> & { id?: string };

/** crypto.randomUUID is only available in secure contexts, so fall back for plain-HTTP testing. */
export function newId(): string {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  const b = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
}

/** Writes full records, stamping them and queueing them for sync. */
export async function putRecords<T extends SyncTable>(table: T, records: RecordByTable[T][]) {
  if (!records.length) return;
  await db.transaction('rw', db.table(table), db.outbox, async () => {
    for (const rec of records) {
      // Keep updatedAt strictly increasing per record even if the clock jumps back.
      const prev = (await db.table(table).get(rec.id)) as RecordByTable[T] | undefined;
      const updatedAt = Math.max(Date.now(), (prev?.updatedAt ?? 0) + 1);
      await db.table(table).put({ ...rec, updatedAt });
      await db.outbox.put({ key: `${table}:${rec.id}`, table, id: rec.id, updatedAt });
    }
  });
  scheduleSync();
}

export async function create<T extends SyncTable>(table: T, fields: NewRecord<T>): Promise<string> {
  const id = fields.id ?? newId();
  await putRecords(table, [{ ...fields, id, updatedAt: 0, deleted: false } as RecordByTable[T]]);
  return id;
}

export async function update<T extends SyncTable>(table: T, id: string, patch: Partial<RecordByTable[T]>) {
  await updateMany(table, [id], () => patch);
}

/** Applies a patch (computed per record) to several records in one go. */
export async function updateMany<T extends SyncTable>(
  table: T,
  ids: string[],
  patch: (rec: RecordByTable[T]) => Partial<RecordByTable[T]>,
) {
  const existing = (await db.table(table).bulkGet(ids)) as (RecordByTable[T] | undefined)[];
  const records = existing.filter((r): r is RecordByTable[T] => !!r).map((r) => ({ ...r, ...patch(r) }));
  await putRecords(table, records);
}

/** Deletes by tombstoning, so the deletion reaches other devices. */
export function remove<T extends SyncTable>(table: T, ids: string[]) {
  return updateMany(table, ids, () => ({ deleted: true }) as Partial<RecordByTable[T]>);
}
