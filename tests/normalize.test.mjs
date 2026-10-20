import test from 'node:test';
import assert from 'node:assert/strict';
import { metrics, normalizeQuotas, normalizeUsage, project } from '../backend/normalize.mjs';
import { makeRawUsage, makeQuotaResponse } from '../fixtures/demo.mjs';
const now = Date.parse('2026-06-12T04:00:00Z');
test('cache is added once; reasoning is not added to output again', () => {
  const data = metrics({ calls: 3, input: 10, output: 20, cache_read: 30, cache_write: 40, reasoning: 15 });
  assert.equal(data.totalTokens, 100); assert.equal(data.reasoningTokens, 15);
  assert.equal(data.cacheHitPercent, 37.5);
  assert.equal(metrics({}).cacheHitPercent, null);
});
test('used percentage becomes remaining; missing is unknown, zero is valid, overflow clamps', () => {
  const raw = makeQuotaResponse(now);
  raw.data[0].windows = [{ used: 0 }, { used: 150 }, {}, { used: -1 }];
  const windows = normalizeQuotas(raw)[0].windows;
  assert.deepEqual(windows.map(w => w.remainingPercent), [100, 0, null, null]);
});
test('inactive provider, identities, paths, prompts and credential fields never cross the boundary', () => {
  const raw = makeQuotaResponse(now);
  raw.data.push({ provider: 'zcode', user: 'old@example.invalid', windows: [] });
  raw.data[0].user = 'owner@example.invalid'; raw.data[0].token = 'PRIVATE_CREDENTIAL';
  const quotas = normalizeQuotas(raw);
  assert.equal(quotas.length, 3);
  const usage = makeRawUsage('7d', now);
  usage.rows = [{ prompt: 'PRIVATE_PROMPT', account: 'PRIVATE_ACCOUNT' }];
  usage.path = 'PRIVATE_PATH'; usage.callerKeys = [{ token: 'PRIVATE_CREDENTIAL' }];
  const result = JSON.stringify({ quotas, usage: normalizeUsage(usage) });
  for (const marker of ['PRIVATE_', 'example.invalid', 'zcode', 'callerKeys', '"rows"']) assert.ok(!result.includes(marker));
});
test('invalid upstream statistics are rejected, not silently turned into zero', () => {
  assert.throws(() => normalizeUsage({ error: 'not ready' }));
  assert.throws(() => normalizeQuotas({ data: null }));
});
test('expired windows retain historical percentages but explicitly require an update', () => {
  const quotas = normalizeQuotas(makeQuotaResponse(now));
  const snapshot = { failures: {}, parts: { quotas: { observedAt: new Date(now).toISOString(), data: quotas } } };
  const result = project(snapshot, now + 6 * 3600000);
  assert.equal(result.subscriptions[0].windows[0].expired, true);
  assert.equal(result.subscriptions[0].windows[0].remainingPercent, 59);
  assert.equal(result.sources.quotas.state, 'stale');
  assert.equal(result.usage.today, null);
});
test('quota reading timestamps come from the quota cache when the API omits them', () => {
  const raw = makeQuotaResponse(now); delete raw.data[1].readAt;
  const result = normalizeQuotas(raw, { privateIdentity: { at: new Date(now).toISOString(), quota: { provider: 'minimax-cn' } } });
  assert.equal(result[1].updatedAt, new Date(now).toISOString());
  assert.ok(!JSON.stringify(result).includes('privateIdentity'));
});
test('Shanghai midnight never relabels yesterday as today', () => {
  const observedAt = '2026-06-12T15:59:00Z';
  const snapshot = { failures: {}, parts: { today: { observedAt, data: normalizeUsage(makeRawUsage()) } } };
  assert.ok(project(snapshot, Date.parse('2026-06-12T15:59:30Z')).usage.today);
  const next = project(snapshot, Date.parse('2026-06-12T16:00:01Z'));
  assert.equal(next.usage.today, null);
  assert.equal(next.sources.today.state, 'stale');
});
