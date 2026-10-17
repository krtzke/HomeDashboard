import type { DatabaseSync } from 'node:sqlite';
import type { Change, SyncRequest, SyncResponse, SyncTable } from '../../shared/src/types.ts';

export const PAGE_SIZE = 500;

/**
 * Applies the client's changes (last-write-wins by updatedAt) and returns everything
 * the server has with a version greater than `since`.
 */
export function applySync(db: DatabaseSync, req: SyncRequest, pageSize = PAGE_SIZE): SyncResponse {
  const getExisting = db.prepare('SELECT updatedAt FROM records WHERE tbl = ? AND id = ?');
  const upsert = db.prepare(
    `INSERT INTO records (tbl, id, data, updatedAt, deleted, version) VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT (tbl, id) DO UPDATE SET
       data = excluded.data, updatedAt = excluded.updatedAt,
       deleted = excluded.deleted, version = excluded.version`,
  );

  db.exec('BEGIN IMMEDIATE');
  try {
    let version = currentVersion(db);
    for (const { table, record } of req.changes) {
      const existing = getExisting.get(table, record.id) as { updatedAt: number } | undefined;
      // Strictly newer wins; re-sending the same change is a no-op.
      if (existing && existing.updatedAt >= record.updatedAt) continue;
      version++;
      upsert.run(table, record.id, JSON.stringify(record), record.updatedAt, record.deleted ? 1 : 0, version);
    }
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }

  // A cursor ahead of the server means the server DB was reset/restored: resend everything.
  const since = req.since > currentVersion(db) ? 0 : req.since;

  const rows = db
    .prepare('SELECT tbl, data, version FROM records WHERE version > ? ORDER BY version LIMIT ?')
    .all(since, pageSize + 1) as { tbl: SyncTable; data: string; version: number }[];

  const hasMore = rows.length > pageSize;
  const page = hasMore ? rows.slice(0, pageSize) : rows;
  const changes = page.map((r) => ({ table: r.tbl, record: JSON.parse(r.data) }) as Change);
  const cursor = page.length ? page[page.length - 1].version : since;

  return { cursor, changes, hasMore };
}

function currentVersion(db: DatabaseSync): number {
  const row = db.prepare('SELECT COALESCE(MAX(version), 0) AS v FROM records').get() as { v: number };
  return row.v;
}
