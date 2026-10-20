import { execFileSync } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const config = JSON.parse(await readFile(path.join(root, '.local/config.json'), 'utf8'));
const markerPath = path.join(root, '.local/tailnet-forward.json');
const port = String(config.port), target = '127.0.0.1:' + port;
const run = args => execFileSync('tailscale', args, { encoding: 'utf8', windowsHide: true, timeout: 15000 });
const state = JSON.parse(run(['serve', 'status', '--json']));
const current = state.TCP?.[port];
const operation = process.argv[2] || 'status';
if (operation === 'enable') {
  if (current && (current.TCPForward !== target || current.TerminateTLS || current.HTTPS || current.HTTP)) throw new Error('This Tailscale port is already used by another service.');
  if (!current) run(['serve', '--bg', '--tcp=' + port, 'tcp://' + target]);
  await writeFile(markerPath, JSON.stringify({ port, target }), { mode: 0o600 });
  console.log('Private Tailnet TCP forwarding is ready. Other Serve ports were preserved.');
} else if (operation === 'disable') {
  let marker;
  try { marker = JSON.parse(await readFile(markerPath, 'utf8')); } catch {}
  if (marker && current) {
    if (marker.port !== port || marker.target !== target || current.TCPForward !== target) throw new Error('Forwarding configuration changed; it was left untouched.');
    run(['serve', '--tcp=' + port, 'off']);
  }
  console.log('Project Tailnet forwarding removed or already absent.');
} else if (operation === 'status') {
  console.log(current?.TCPForward === target ? 'Tailnet forward: OK' : 'Tailnet forward: not configured');
} else throw new Error('Use enable, disable or status.');
