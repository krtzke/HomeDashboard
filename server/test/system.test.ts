import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { getSystemStatus } from '../src/system.ts';

test('returns host status with sane values', async () => {
  const s = await getSystemStatus(fileURLToPath(import.meta.url));
  assert.ok(s.memTotal > 0 && s.memAvailable > 0 && s.memAvailable <= s.memTotal);
  assert.ok(s.cpuCount >= 1);
  assert.equal(s.load.length, 3);
  assert.ok(s.uptimeSec > 0);
  assert.ok(s.dbSizeBytes! > 0);
  assert.ok(s.diskTotal === null || s.diskTotal > 0);
  assert.ok(s.cpuTempC === null || (s.cpuTempC > 0 && s.cpuTempC < 120));
});
