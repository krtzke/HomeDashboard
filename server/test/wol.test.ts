import { test } from 'node:test';
import assert from 'node:assert/strict';
import dgram from 'node:dgram';
import { checkOnline, isValidHost, lanBroadcasts, magicPacket, parseMac, sendWol } from '../src/wol.ts';

test('parses MAC addresses in common formats', () => {
  const expected = Buffer.from('aabbccddeeff', 'hex');
  assert.deepEqual(parseMac('AA-BB-CC-DD-EE-FF'), expected);
  assert.deepEqual(parseMac('aa:bb:cc:dd:ee:ff'), expected);
  assert.deepEqual(parseMac('AABBCCDDEEFF'), expected);
  assert.equal(parseMac('AA-BB-CC-DD-EE'), null);
  assert.equal(parseMac('ZZ-BB-CC-DD-EE-FF'), null);
});

test('builds a magic packet', () => {
  const mac = parseMac('AA-BB-CC-DD-EE-FF')!;
  const p = magicPacket(mac);
  assert.equal(p.length, 102);
  assert.deepEqual(p.subarray(0, 6), Buffer.alloc(6, 0xff));
  for (let i = 0; i < 16; i++) assert.deepEqual(p.subarray(6 + i * 6, 12 + i * 6), mac);
});

test('computes LAN broadcast addresses, skipping loopback and Tailscale', () => {
  const iface = (address: string, netmask: string, internal = false) =>
    ({ address, netmask, family: 'IPv4', internal, mac: '', cidr: null }) as never;
  const result = lanBroadcasts({
    lo: [iface('127.0.0.1', '255.0.0.0', true)],
    eth0: [iface('192.168.1.50', '255.255.255.0')],
    tailscale0: [iface('100.101.102.103', '255.255.255.255')],
  });
  assert.deepEqual(result.sort(), ['192.168.1.255', '255.255.255.255']);
});

test('sends the magic packet over UDP', async () => {
  const receiver = dgram.createSocket('udp4');
  await new Promise<void>((r) => receiver.bind(0, '127.0.0.1', () => r()));
  const { port } = receiver.address();
  const got = new Promise<Buffer>((r) => receiver.once('message', (msg) => r(msg)));
  const mac = parseMac('AA-BB-CC-DD-EE-FF')!;
  await sendWol(mac, ['127.0.0.1'], port);
  assert.deepEqual(await got, magicPacket(mac));
  receiver.close();
});

test('rejects hosts that could be command-line options', () => {
  assert.ok(isValidHost('192.168.1.20'));
  assert.ok(isValidHost('desktop-pc.fritz.box'));
  assert.ok(!isValidHost('-c 100 x'));
  assert.ok(!isValidHost('a;rm -rf /'));
  assert.ok(!isValidHost(''));
});

test('reports reachable and unreachable hosts', async () => {
  assert.equal(await checkOnline('127.0.0.1'), true);
  // 192.0.2.0/24 is reserved for documentation, so nothing answers there
  assert.equal(await checkOnline('192.0.2.1'), false);
});
