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
function ownedForwards(marker) {
  if (!marker) return [];
  const records = marker.pending === true ? marker.forwards : [marker];
  if (!Array.isArray(records) || records.length < 1 || records.length > 32) throw new Error('Invalid saved ownership record.');
  const seen = new Set();
  return records.map(record => {
    const port = portNumber(record.port);
    if (record.target !== targetFor(port) || seen.has(port)) throw new Error('Invalid saved ownership record; forwarding was left untouched.');
    seen.add(port);
    return { port, target: record.target };
  });
}

// Validate every affected port before changing anything, including interrupted migrations.
export function planForward({ operation, config = {}, marker = null, state = {} }) {
  const commands = [], saved = ownedForwards(marker);
  const existing = port => state.TCP?.[port];
  const check = port => {
    const current = existing(port);
    if (current && !unchanged(current, targetFor(port))) throw new Error('Forwarding configuration changed or belongs to another service; it was left untouched.');
    return current;
  };
  for (const item of saved) check(item.port);
  if (operation === 'disable') {
    for (const item of saved) if (existing(item.port)) commands.push(['serve', '--tcp=' + item.port, 'off']);
    return { commands, clearMarker: !!marker, message: 'Project Tailnet forwarding removed or already absent.' };
  }
  const port = portNumber(config.port), target = targetFor(port);
  if (operation === 'enable') {
    const current = check(port);
    for (const item of saved) if (item.port !== port && existing(item.port)) commands.push(['serve', '--tcp=' + item.port, 'off']);
    if (!current) commands.push(['serve', '--bg', '--tcp=' + port, 'tcp://' + target]);
    const forwards = [...saved.filter(item => item.port !== port), { port, target }];
    return { commands,
      journal: { version: 2, pending: true, forwards },
      marker: { version: 1, port, target },
      message: 'Private Tailnet TCP forwarding is ready. Other Serve ports were preserved.' };
  }
  if (operation === 'status') return { commands, message: !marker?.pending && unchanged(existing(port), target) && (!saved.length || saved[0].port === port)
    ? 'Tailnet forward: OK' : 'Tailnet forward: not configured for the current port; run the installer.' };
  throw new Error('Use enable, disable or status.');
}

// Persist intent BEFORE system changes; an interrupted operation remains recoverable.
export async function applyForward(plan, { run, saveMarker, clearMarker }) {
  if (plan.journal) await saveMarker(plan.journal);
  for (const command of plan.commands) await run(command);
  if (plan.marker) await saveMarker(plan.marker);
  if (plan.clearMarker) await clearMarker();
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
  await applyForward(plan, { run,
    saveMarker: async record => {
      // Atomic replacement keeps a killed process from leaving truncated JSON.
      const temporary = markerPath + '.tmp';
      await writeFile(temporary, JSON.stringify(record), { mode: 0o600 });
      const { rename } = await import('node:fs/promises');
      await rename(temporary, markerPath);
    },
    clearMarker: () => unlink(markerPath),
  });
  console.log(plan.message);
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
