import { test } from 'node:test';
import assert from 'node:assert/strict';
import { choreStatus, choreUnit } from '../src/chores.ts';

// 2026-10-19 is a Monday, 2026-10-25 the Sunday of that week.
const chore = (intervalDays: number, lastDone: string | null) => ({ intervalDays, lastDone });

test('weekly intervals are multiples of 7 days', () => {
  assert.equal(choreUnit(1), 'days');
  assert.equal(choreUnit(3), 'days');
  assert.equal(choreUnit(7), 'weeks');
  assert.equal(choreUnit(14), 'weeks');
});

test('a chore that was never done is due', () => {
  assert.deepEqual(choreStatus(chore(1, null), '2026-10-21'), { state: 'due', unit: 'days', overdueBy: 0 });
  assert.deepEqual(choreStatus(chore(7, null), '2026-10-21'), { state: 'due', unit: 'weeks', overdueBy: 0 });
});

test('a daily chore stays checked until the end of the day', () => {
  const c = chore(1, '2026-10-21');
  assert.deepEqual(choreStatus(c, '2026-10-21'), { state: 'done', resetsAfter: '2026-10-21' });
  assert.deepEqual(choreStatus(c, '2026-10-22'), { state: 'due', unit: 'days', overdueBy: 0 });
  assert.deepEqual(choreStatus(c, '2026-10-24'), { state: 'overdue', unit: 'days', overdueBy: 2 });
});

test('a weekly chore stays checked until Sunday night, wherever in the week it was done', () => {
  for (const day of ['2026-10-19', '2026-10-22', '2026-10-25']) {
    const c = chore(7, day);
    assert.deepEqual(choreStatus(c, day), { state: 'done', resetsAfter: '2026-10-25' }, day);
    assert.deepEqual(choreStatus(c, '2026-10-25'), { state: 'done', resetsAfter: '2026-10-25' }, day);
    assert.deepEqual(choreStatus(c, '2026-10-26'), { state: 'due', unit: 'weeks', overdueBy: 0 }, day);
    assert.deepEqual(choreStatus(c, '2026-11-01'), { state: 'due', unit: 'weeks', overdueBy: 0 }, day);
    assert.deepEqual(choreStatus(c, '2026-11-02'), { state: 'overdue', unit: 'weeks', overdueBy: 1 }, day);
  }
});

test('every N weeks stays checked through the Sunday before the week it is due', () => {
  const c = chore(14, '2026-10-21');
  assert.deepEqual(choreStatus(c, '2026-10-30'), { state: 'done', resetsAfter: '2026-11-01' });
  assert.deepEqual(choreStatus(c, '2026-11-01'), { state: 'done', resetsAfter: '2026-11-01' });
  assert.deepEqual(choreStatus(c, '2026-11-02'), { state: 'due', unit: 'weeks', overdueBy: 0 });
});

test('every N days stays checked for N days', () => {
  const c = chore(3, '2026-10-19');
  assert.deepEqual(choreStatus(c, '2026-10-21'), { state: 'done', resetsAfter: '2026-10-21' });
  assert.deepEqual(choreStatus(c, '2026-10-22'), { state: 'due', unit: 'days', overdueBy: 0 });
  assert.deepEqual(choreStatus(c, '2026-10-23'), { state: 'overdue', unit: 'days', overdueBy: 1 });
});

test('weekly resets also work across a year boundary', () => {
  // Thursday 2026-12-31 → that week ends Sunday 2027-01-03.
  const c = chore(7, '2026-12-31');
  assert.deepEqual(choreStatus(c, '2027-01-03'), { state: 'done', resetsAfter: '2027-01-03' });
  assert.deepEqual(choreStatus(c, '2027-01-04'), { state: 'due', unit: 'weeks', overdueBy: 0 });
});
