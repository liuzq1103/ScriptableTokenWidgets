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
