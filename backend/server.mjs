import { readFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { createServer } from './http.mjs';
import { Collector } from './collector.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const demo = process.argv.includes('--demo');
let config;
try { config = demo ? { port: 8800, token: 'demo' } : JSON.parse(await readFile(path.join(root, '.local/config.json'), 'utf8')); }
catch { console.error('Run node scripts/configure.mjs before starting the service.'); process.exit(1); }
if (!demo && (typeof config.token !== 'string' || config.token.length < 32)) {
  console.error('A strong read-only token is required. Run the configure script.'); process.exit(1);
}
const upstream = new URL(config.upstream || 'http://127.0.0.1:3425');
if (upstream.protocol !== 'http:' || !['127.0.0.1', 'localhost', '[::1]'].includes(upstream.hostname) || upstream.username || upstream.password) {
  throw new Error('Magpie upstream must be a local loopback HTTP URL.');
}
const collector = new Collector({
  upstream: upstream.href,
  magpieDir: config.magpieDir || path.join(os.homedir(), '.config', 'magpie'),
  snapshotFile: path.join(root, '.local/snapshot.json'),
});
if (demo) {
  const { makeDemo } = await import('../fixtures/demo.mjs');
  collector.overview = () => makeDemo();
} else {
  await collector.load();
  void collector.refresh();
}
const servers = new Map();
function listen(host) {
  const server = createServer({ root, token: config.token, collector });
  servers.set(host, server);
  server.on('error', error => {
    servers.delete(host);
    if (host === '127.0.0.1') {
      console.error('Cannot listen on the local service port (' + error.code + ').');
      process.exit(1);
    }
    console.warn('Tailscale interface unavailable; retrying in one minute.');
  });
  server.listen(config.port || 8799, host, () => console.log('Usage bridge listening on ' + host + ':' + (config.port || 8799)));
}
function ensureTailnet() {
  if (demo) return;
  const host = config.tailnetIP;
  const octets = String(host).split('.').map(Number);
  if (octets.length !== 4 || octets[0] !== 100 || octets[1] < 64 || octets[1] > 127 ||
      octets.some(n => !Number.isInteger(n) || n < 0 || n > 255)) throw new Error('A valid Tailscale IPv4 address is required.');
  if (!servers.has(host)) listen(host);
}
listen('127.0.0.1');
ensureTailnet();
const interval = setInterval(() => { ensureTailnet(); if (!demo) void collector.refresh(); }, 60_000);
for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, () => {
  clearInterval(interval);
  for (const server of servers.values()) server.close();
  setTimeout(() => process.exit(0), 1000).unref();
});
