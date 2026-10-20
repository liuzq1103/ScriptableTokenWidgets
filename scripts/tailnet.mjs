import { execFileSync } from 'node:child_process';
import { readFile, writeFile, unlink } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

function portNumber(value) {
  const port = String(value);
  if (!/^[1-9]\d{0,4}$/.test(port) || Number(port) > 65535) throw new Error('Invalid forwarding port.');
  return port;
}
function targetFor(port) { return '127.0.0.1:' + port; }
function unchanged(current, target) {
  return current && Object.keys(current).length === 1 && current.TCPForward === target;
}

// Pure command planning keeps ownership checks testable without changing a real Tailnet.
export function planForward({ operation, config = {}, marker = null, state = {} }) {
  const commands = [];
  const savedPort = marker ? portNumber(marker.port) : null;
  if (marker && marker.target !== targetFor(savedPort)) throw new Error('Invalid saved ownership record; forwarding was left untouched.');
  const existing = port => state.TCP?.[port];
  const check = port => {
    const current = existing(port);
    if (current && !unchanged(current, targetFor(port))) throw new Error('Forwarding configuration changed or belongs to another service; it was left untouched.');
    return current;
  };
  if (operation === 'disable') {
    if (savedPort && check(savedPort)) commands.push(['serve', '--tcp=' + savedPort, 'off']);
    return { commands, clearMarker: !!marker, message: 'Project Tailnet forwarding removed or already absent.' };
  }
  const port = portNumber(config.port), target = targetFor(port);
  if (operation === 'enable') {
    const current = check(port);
    // Validate both ends before removing anything during a port migration.
    if (savedPort && savedPort !== port && check(savedPort)) commands.push(['serve', '--tcp=' + savedPort, 'off']);
    if (!current) commands.push(['serve', '--bg', '--tcp=' + port, 'tcp://' + target]);
    return { commands, marker: { version: 1, port, target }, message: 'Private Tailnet TCP forwarding is ready. Other Serve ports were preserved.' };
  }
  if (operation === 'status') return { commands, message: unchanged(existing(port), target) && (!savedPort || savedPort === port)
    ? 'Tailnet forward: OK' : 'Tailnet forward: not configured for the current port; run the installer.' };
  throw new Error('Use enable, disable or status.');
}

async function main() {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const markerPath = path.join(root, '.local/tailnet-forward.json');
  const operation = process.argv[2] || 'status';
  let config = {}, marker = null;
  try { config = JSON.parse(await readFile(path.join(root, '.local/config.json'), 'utf8')); }
  catch (error) { if (operation !== 'disable') throw error; }
  try { marker = JSON.parse(await readFile(markerPath, 'utf8')); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  const run = args => execFileSync('tailscale', args, { encoding: 'utf8', windowsHide: true, timeout: 15000 });
  const state = JSON.parse(run(['serve', 'status', '--json']));
  const plan = planForward({ config, marker, state, operation });
  for (const command of plan.commands) run(command);
  if (plan.marker) await writeFile(markerPath, JSON.stringify(plan.marker), { mode: 0o600 });
  if (plan.clearMarker) await unlink(markerPath);
  console.log(plan.message);
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
