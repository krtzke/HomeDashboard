import { test } from 'node:test';
import assert from 'node:assert/strict';
import { expandRrule, icsDate, parseIcs } from '../src/ics.ts';
import { wasteStyle } from '../src/waste.ts';

const cal = (...events: string[]) =>
  ['BEGIN:VCALENDAR', 'VERSION:2.0', ...events.map((e) => `BEGIN:VEVENT\r\n${e}\r\nEND:VEVENT`), 'END:VCALENDAR'].join('\r\n');

test('parses all-day and timed events, unfolding and unescaping', () => {
  const text = cal(
    'DTSTART;VALUE=DATE:20261020\r\nSUMMARY:Gelbe Tonne\\, Straße A',
    'DTSTART;TZID=Europe/Berlin:20261021T060000\r\nSUMMARY:Restm\r\n üll',
    'DTSTART;VALUE=DATE:20250101\r\nSUMMARY:Too old',
  );
  assert.deepEqual(parseIcs(text, '2026-01-01', '2026-12-31'), [
    { date: '2026-10-20', summary: 'Gelbe Tonne, Straße A' },
    { date: '2026-10-21', summary: 'Restmüll' },
  ]);
});

test('skips cancelled events and EXDATEs', () => {
  const text = cal(
    'DTSTART;VALUE=DATE:20261020\r\nSUMMARY:Papier\r\nSTATUS:CANCELLED',
    'DTSTART;VALUE=DATE:20261001\r\nRRULE:FREQ=WEEKLY;COUNT=4\r\nEXDATE;VALUE=DATE:20261008,20261015\r\nSUMMARY:Bio',
  );
  assert.deepEqual(
    parseIcs(text, '2026-01-01', '2026-12-31').map((e) => e.date),
    ['2026-10-01', '2026-10-22'],
  );
});

test('expands biweekly, monthly and BYDAY rules', () => {
  assert.deepEqual(expandRrule('2026-10-02', 'FREQ=WEEKLY;INTERVAL=2;COUNT=3', '2027-12-31'), [
    '2026-10-02',
    '2026-10-16',
    '2026-10-30',
  ]);
  assert.deepEqual(expandRrule('2026-01-31', 'FREQ=MONTHLY;UNTIL=20260601', '2027-12-31'), [
    '2026-01-31',
    '2026-03-31',
    '2026-05-31',
  ]);
  assert.deepEqual(expandRrule('2026-10-05', 'FREQ=WEEKLY;BYDAY=MO,TH;COUNT=4', '2027-12-31'), [
    '2026-10-05',
    '2026-10-08',
    '2026-10-12',
    '2026-10-15',
  ]);
});

test('UTC times convert to local dates', () => {
  const expected = new Date(Date.UTC(2026, 9, 19, 23, 30)).toLocaleDateString('sv-SE'); // YYYY-MM-DD in local TZ
  assert.equal(icsDate('20261019T233000Z'), expected);
});

test('recognises waste types', () => {
  assert.equal(wasteStyle('Gelber Sack').emoji, '🟡');
  assert.equal(wasteStyle('Altpapier').emoji, '🔵');
  assert.equal(wasteStyle('Biotonne').emoji, '🟤');
  assert.equal(wasteStyle('Restmülltonne').emoji, '⚫');
  assert.equal(wasteStyle('Weihnachtsbaumabfuhr').emoji, '🎄');
  assert.equal(wasteStyle('Something else').emoji, '🗑️');
});
