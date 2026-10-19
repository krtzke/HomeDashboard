// Wake-on-LAN (magic packets) and "is this device online?" checks for the Wake PC widget.
import dgram from 'node:dgram';
import net from 'node:net';
import os from 'node:os';
import { execFile } from 'node:child_process';

export const WOL_PORT = 9;

/** Accepts aa:bb:cc:dd:ee:ff, aa-bb-cc-dd-ee-ff or aabbccddeeff. */
export function parseMac(input: string): Buffer | null {
  const hex = input.trim().replace(/[:-]/g, '');
  return /^[0-9a-f]{12}$/i.test(hex) ? Buffer.from(hex, 'hex') : null;
}

/** 6 × 0xFF followed by the MAC address 16 times. */
export function magicPacket(mac: Buffer): Buffer {
  return Buffer.concat([Buffer.alloc(6, 0xff), ...Array.from({ length: 16 }, () => mac)]);
}

/**
 * Broadcast addresses of the Pi's LAN interfaces (plus the global broadcast). Directed broadcasts
 * like 192.168.2.255 are more reliable than 255.255.255.255 once VPN interfaces (Tailscale) exist.
 */
export function lanBroadcasts(ifaces: NodeJS.Dict<os.NetworkInterfaceInfo[]> = os.networkInterfaces()): string[] {
  const out = new Set<string>(['255.255.255.255']);
  for (const addrs of Object.values(ifaces)) {
    for (const a of addrs ?? []) {
      if (a.family !== 'IPv4' || a.internal) continue;
      if (a.address.startsWith('100.') && Number(a.address.split('.')[1]) >= 64 && Number(a.address.split('.')[1]) < 128) continue; // Tailscale CGNAT range
      const ip = a.address.split('.').map(Number);
      const mask = a.netmask.split('.').map(Number);
      out.add(ip.map((b, i) => (b & mask[i]) | (~mask[i] & 255)).join('.'));
    }
  }
  return [...out];
}

export async function sendWol(mac: Buffer, targets = lanBroadcasts(), port = WOL_PORT): Promise<string[]> {
  const socket = dgram.createSocket('udp4');
  const packet = magicPacket(mac);
  try {
    await new Promise<void>((resolve, reject) => {
      socket.once('error', reject);
      socket.bind(() => {
        socket.setBroadcast(true);
        resolve();
      });
    });
    for (const target of targets) {
      await new Promise<void>((resolve, reject) => socket.send(packet, port, target, (err) => (err ? reject(err) : resolve())));
    }
    return targets;
  } finally {
    socket.close();
  }
}

/** IPv4 address or hostname; rejects anything that could be read as a command-line option. */
export function isValidHost(host: string): boolean {
  return host.length <= 253 && /^[a-z0-9]([a-z0-9.-]*[a-z0-9])?$/i.test(host);
}

function pingOnce(host: string): Promise<boolean> {
  const win = process.platform === 'win32';
  const args = win ? ['-n', '1', '-w', '1000', host] : ['-c', '1', '-W', '1', host];
  return new Promise((resolve) =>
    execFile('ping', args, { timeout: 3000 }, (err, stdout) =>
      // Windows ping also exits 0 on "Destination host unreachable"; only a reply with TTL counts.
      resolve(!err && (!win || /TTL=/i.test(stdout))),
    ),
  );
}

function tcpOpen(host: string, port: number, timeoutMs = 800): Promise<boolean> {
  return new Promise((resolve) => {
    const s = net.connect({ host, port });
    const done = (ok: boolean) => {
      s.destroy();
      resolve(ok);
    };
    s.setTimeout(timeoutMs, () => done(false));
    s.once('connect', () => done(true));
    s.once('error', () => done(false));
  });
}

/** Windows blocks ping by default, so also try typical ports: RDP, SMB, RPC, SSH. */
const FALLBACK_PORTS = [3389, 445, 135, 22];

export async function checkOnline(host: string): Promise<boolean> {
  if (await pingOnce(host)) return true;
  const results = await Promise.all(FALLBACK_PORTS.map((p) => tcpOpen(host, p)));
  return results.some(Boolean);
}
