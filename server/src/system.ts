// Host health for the "Pi status" widget. Everything is best-effort: missing sources yield null.
import os from 'node:os';
import { execFile } from 'node:child_process';
import { readFile, stat, statfs } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { SystemStatus } from '../../shared/src/types.ts';

const startedAt = Date.now();

async function cpuTemp(): Promise<number | null> {
  try {
    const raw = await readFile('/sys/class/thermal/thermal_zone0/temp', 'utf8');
    return Math.round(Number(raw) / 100) / 10; // millidegrees → °C, 1 decimal
  } catch {
    return null;
  }
}

/** MemAvailable is what's really free for apps (os.freemem() ignores reclaimable cache). */
async function memAvailable(): Promise<number> {
  try {
    const m = (await readFile('/proc/meminfo', 'utf8')).match(/^MemAvailable:\s+(\d+) kB/m);
    if (m) return Number(m[1]) * 1024;
  } catch {
    /* not Linux */
  }
  return os.freemem();
}

async function disk(path: string): Promise<{ total: number; free: number } | null> {
  try {
    const s = await statfs(path);
    return { total: s.blocks * s.bsize, free: s.bavail * s.bsize };
  } catch {
    return null;
  }
}

function throttled(): Promise<number | null> {
  return new Promise((resolve) => {
    execFile('vcgencmd', ['get_throttled'], { timeout: 2000 }, (err, stdout) => {
      const m = !err && stdout.match(/throttled=(0x[0-9a-f]+)/i);
      resolve(m ? parseInt(m[1], 16) : null);
    });
  });
}

export async function getSystemStatus(dbPath: string): Promise<SystemStatus> {
  const [temp, avail, d, thr, dbSize] = await Promise.all([
    cpuTemp(),
    memAvailable(),
    disk(dirname(dbPath)),
    throttled(),
    stat(dbPath).then((s) => s.size).catch(() => null),
  ]);
  const [l1, l5, l15] = os.loadavg();
  return {
    hostname: os.hostname(),
    platform: `${os.type()} ${os.release()} (${os.arch()})`,
    cpuTempC: temp,
    load: [l1, l5, l15],
    cpuCount: os.availableParallelism(),
    memTotal: os.totalmem(),
    memAvailable: avail,
    diskTotal: d?.total ?? null,
    diskFree: d?.free ?? null,
    uptimeSec: Math.round(os.uptime()),
    appUptimeSec: Math.round((Date.now() - startedAt) / 1000),
    nodeVersion: process.version,
    dbSizeBytes: dbSize,
    throttled: thr,
  };
}
