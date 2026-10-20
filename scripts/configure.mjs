import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import os from 'node:os';
import { displayOptions } from '../backend/normalize.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const directory = path.join(root, '.local');
await mkdir(directory, { recursive: true, mode: 0o700 });
const configFile = path.join(directory, 'config.json');
let old = {};
try { old = JSON.parse(await readFile(configFile, 'utf8')); } catch {}
// Display choices are configured here, on the PC. The phone and the dashboard only
// render what the service projects.
const flags = new Map();
for (let index = 2; index < process.argv.length; index += 2) {
  const key = String(process.argv[index] || '').replace(/^--/, '');
  if (key) flags.set(key, process.argv[index + 1]);
}
const overrides = {};
if (flags.has('model-limit')) overrides.modelLimit = Number(flags.get('model-limit'));
if (flags.has('provider-limit')) overrides.providerLimit = Number(flags.get('provider-limit'));
if (flags.has('computer-limit')) overrides.computerLimit = Number(flags.get('computer-limit'));
if (flags.has('subscriptions')) overrides.subscriptions = String(flags.get('subscriptions')).split(',').map(item => item.trim()).filter(Boolean);
let status;
try { status = JSON.parse(execFileSync('tailscale', ['status', '--json'], { encoding: 'utf8', windowsHide: true, timeout: 15000 })); }
catch { throw new Error('Connect Tailscale before configuring the service.'); }
const tailnetIP = status.TailscaleIPs?.find(ip => /^100\./.test(ip));
if (!tailnetIP) throw new Error('No Tailscale IPv4 address found.');
const phoneIPs = Object.values(status.Peer || {}).filter(peer => peer.OS === 'iOS').flatMap(peer => peer.TailscaleIPs || []).filter(ip => /^100\./.test(ip));
const config = {
  port: old.port || 8799,
  nodePath: process.execPath,
  upstream: old.upstream || 'http://127.0.0.1:3425',
  magpieDir: old.magpieDir || path.join(os.homedir(), '.config', 'magpie'),
  tailnetIP,
  phoneIPs,
  token: typeof old.token === 'string' && old.token.length >= 32 ? old.token : randomBytes(32).toString('base64url'),
  display: displayOptions({ ...(old.display || {}), ...overrides }),
};
await writeFile(configFile, JSON.stringify(config, null, 2) + '\n', { mode: 0o600 });
const url = 'http://' + tailnetIP + ':' + config.port;
const instructions = [
  'iPhone connection (private; do not commit or share publicly)',
  '',
  'Service URL: ' + url,
  'Read-only token: ' + config.token,
  'Dashboard: ' + url + '/#token=' + encodeURIComponent(config.token),
  '',
  '1. Install Scriptable on iPhone and connect Tailscale.',
  '2. Paste SetupUsageWidget.js into a new Scriptable script and run it.',
  '3. Enter the Service URL and Read-only token above.',
  '4. Add a medium Scriptable widget and select UsageWidget.',
].join('\n');
await writeFile(path.join(directory, 'iphone-setup.txt'), instructions + '\n', { mode: 0o600 });
console.log('Configuration ready. Private connection details: .local/iphone-setup.txt');
console.log('Detected ' + phoneIPs.length + ' iOS device(s). No secrets printed.');
console.log('Display settings: ' + config.display.modelLimit + ' models, ' + config.display.subscriptions.join(', ') + '.');
