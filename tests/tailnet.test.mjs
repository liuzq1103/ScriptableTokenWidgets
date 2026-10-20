import test from 'node:test';
import assert from 'node:assert/strict';
import { planForward } from '../scripts/tailnet.mjs';
const marker = { port: '8799', target: '127.0.0.1:8799' };
const own = { TCPForward: marker.target };
test('uninstall follows the saved owned port even after config changes', () => {
  const plan = planForward({ operation: 'disable', config: { port: 8801 }, marker, state: { TCP: { '8799': own } } });
  assert.deepEqual(plan.commands, [['serve', '--tcp=8799', 'off']]);
  assert.equal(plan.clearMarker, true);
});
test('port migration removes the old owned forward before recording the new one', () => {
  const plan = planForward({ operation: 'enable', config: { port: 8801 }, marker, state: { TCP: { '8799': own, '9999': { TCPForward: '127.0.0.1:9999' } } } });
  assert.deepEqual(plan.commands, [['serve', '--tcp=8799', 'off'], ['serve', '--bg', '--tcp=8801', 'tcp://127.0.0.1:8801']]);
  assert.equal(plan.marker.port, '8801');
  assert.ok(!JSON.stringify(plan.commands).includes('9999'));
});
test('a foreign destination or changed old forward blocks migration without removing anything', () => {
  for (const state of [
    { TCP: { '8799': own, '8801': { TCPForward: '127.0.0.1:1234' } } },
    { TCP: { '8799': { ...own, TerminateTLS: 'private.example' } } },
    { TCP: { '8799': { TCPForward: '127.0.0.1:1234' } } },
  ]) assert.throws(() => planForward({ operation: 'enable', config: { port: 8801 }, marker, state }), /left untouched/);
});
test('uninstall refuses changed forwarding options and never deletes an unowned port', () => {
  assert.throws(() => planForward({ operation: 'disable', marker, state: { TCP: { '8799': { ...own, ProxyProtocol: 2 } } } }), /left untouched/);
  assert.deepEqual(planForward({ operation: 'disable', config: { port: 8799 }, state: { TCP: { '8799': own } } }).commands, []);
});
test('same-port installation is idempotent and absent old forwarding can be cleaned up', () => {
  assert.deepEqual(planForward({ operation: 'enable', config: { port: 8799 }, marker, state: { TCP: { '8799': own } } }).commands, []);
  assert.deepEqual(planForward({ operation: 'disable', marker, state: {} }).commands, []);
});
test('invalid ownership or port data cannot be used to alter network configuration', () => {
  assert.throws(() => planForward({ operation: 'disable', marker: { port: '8799', target: '127.0.0.1:1234' } }), /Invalid saved/);
  for (const port of [0, 65536, '8799 off', undefined]) assert.throws(() => planForward({ operation: 'enable', config: { port } }), /Invalid forwarding/);
});

test('interrupted migration can recover both old and new owned forwards', () => {
  const pending = { version: 2, pending: true, forwards: [marker, { port: '8801', target: '127.0.0.1:8801' }] };
  const state = { TCP: { '8799': own, '8801': { TCPForward: '127.0.0.1:8801' } } };
  const cleanup = planForward({ operation: 'disable', marker: pending, state });
  assert.deepEqual(cleanup.commands, [['serve', '--tcp=8799', 'off'], ['serve', '--tcp=8801', 'off']]);
  const resume = planForward({ operation: 'enable', config: { port: 8801 }, marker: pending, state });
  assert.deepEqual(resume.commands, [['serve', '--tcp=8799', 'off']]);
  assert.equal(resume.marker.port, '8801');
  assert.throws(() => planForward({ operation: 'disable', marker: pending, state: { TCP: { '8801': { TCPForward: '127.0.0.1:9999' } } } }), /left untouched/);
});
test('write-ahead ownership survives failure after a system change', async () => {
  const { applyForward } = await import('../scripts/tailnet.mjs');
  const plan = planForward({ operation: 'enable', config: { port: 8801 }, marker, state: { TCP: { '8799': own } } });
  let persisted, changed = false;
  await assert.rejects(applyForward(plan, {
    saveMarker: async value => { persisted = value; },
    run: async () => {
      assert.equal(persisted.pending, true);
      changed = true;
      throw new Error('simulated process interruption');
    },
    clearMarker: async () => {},
  }), /simulated/);
  assert.equal(changed, true);
  assert.equal(persisted.forwards.length, 2);
  const cleanup = planForward({ operation: 'disable', marker: persisted, state: { TCP: { '8801': { TCPForward: '127.0.0.1:8801' } } } });
  assert.deepEqual(cleanup.commands, [['serve', '--tcp=8801', 'off']]);
});
