import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../src/db.ts';
import { applySync } from '../src/sync.ts';
import type { Change, ItemRec } from '../../shared/src/types.ts';

function item(id: string, updatedAt: number, patch: Partial<ItemRec> = {}): Change {
  return {
    table: 'items',
    record: { id, updatedAt, deleted: false, listId: 'l1', text: id, checked: false, persistent: false, sortOrder: 0, ...patch },
  };
}

test('pushes changes and returns them with a cursor', () => {
  const db = openDb(':memory:');
  const res = applySync(db, { since: 0, changes: [item('a', 1), item('b', 1)] });
  assert.equal(res.changes.length, 2);
  assert.equal(res.cursor, 2);
  assert.equal(res.hasMore, false);

  const again = applySync(db, { since: res.cursor, changes: [] });
  assert.deepEqual(again.changes, []);
  assert.equal(again.cursor, 2);
});

test('last write wins by updatedAt', () => {
  const db = openDb(':memory:');
  applySync(db, { since: 0, changes: [item('a', 100, { text: 'new' })] });
  applySync(db, { since: 0, changes: [item('a', 50, { text: 'old' })] });
  const { changes } = applySync(db, { since: 0, changes: [] });
  assert.equal((changes[0].record as ItemRec).text, 'new');
});

test('re-sending the same change is idempotent', () => {
  const db = openDb(':memory:');
  const first = applySync(db, { since: 0, changes: [item('a', 1)] });
  const second = applySync(db, { since: first.cursor, changes: [item('a', 1)] });
  assert.equal(second.changes.length, 0);
  assert.equal(second.cursor, first.cursor);
});

test('tombstones propagate to other clients', () => {
  const db = openDb(':memory:');
  const a = applySync(db, { since: 0, changes: [item('x', 1)] });
  applySync(db, { since: a.cursor, changes: [item('x', 2, { deleted: true })] });
  const other = applySync(db, { since: a.cursor, changes: [] });
  assert.equal(other.changes.length, 1);
  assert.equal(other.changes[0].record.deleted, true);
});

test('paginates large result sets', () => {
  const db = openDb(':memory:');
  applySync(db, { since: 0, changes: Array.from({ length: 5 }, (_, i) => item(`i${i}`, 1)) }, 2);
  const seen: string[] = [];
  let since = 0;
  for (;;) {
    const res = applySync(db, { since, changes: [] }, 2);
    seen.push(...res.changes.map((c) => c.record.id));
    since = res.cursor;
    if (!res.hasMore) break;
  }
  assert.deepEqual(seen, ['i0', 'i1', 'i2', 'i3', 'i4']);
});

test('cursor ahead of server (DB reset) resends everything', () => {
  const db = openDb(':memory:');
  applySync(db, { since: 0, changes: [item('a', 1)] });
  const res = applySync(db, { since: 999, changes: [] });
  assert.equal(res.changes.length, 1);
  assert.equal(res.cursor, 1);
});
