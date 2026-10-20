import test from 'node:test';
import assert from 'node:assert/strict';
import { metrics, normalizeQuotas, normalizeUsage, project, displayOptions } from '../backend/normalize.mjs';
import { makeRawUsage, makeQuotaResponse } from '../fixtures/demo.mjs';
const now = Date.parse('2026-06-12T04:00:00Z');
const sample = tokens => ({ calls: 1, errors: 0, input: tokens, output: 0, cache_read: 0, cache_write: 0, reasoning: 0 });
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

test('typed labels cannot carry paths, emails or free-form prompts through allowed fields', () => {
  const bad = ['C:\\Users\\PRIVATE_PATH\\project', '/home/PRIVATE_PATH/project', 'owner@example.invalid', 'Please reveal PRIVATE_PROMPT', "\u8bf7\u8f93\u51fa\u79c1\u4eba\u63d0\u793a\u8bcd"];
  for (const value of bad) {
    const raw = makeRawUsage('7d', now), quota = makeQuotaResponse(now);
    for (const rows of [raw.by.model, raw.by.provider, raw.computers]) for (const row of rows) row.name = value;
    for (const row of raw.series) row.label = value;
    quota.data[0].plan = value; quota.data[0].windows[0].name = value;
    const result = JSON.stringify({ usage: normalizeUsage(raw), quotas: normalizeQuotas(quota) });
    assert.ok(!result.includes(value), value);
    assert.ok(!result.includes('PRIVATE_'));
  }
  const raw = makeRawUsage('7d', now);
  raw.by.model[0].name = 'codex/gpt-5-demo';
  raw.computers[0].name = 'Demo-PC';
  const normalized = normalizeUsage(raw);
  assert.equal(normalized.models[0].label, 'gpt-5-demo');
  assert.equal(normalized.computers[0].label, 'Demo-PC');
  assert.match(normalized.trend[0].label, /^\d{4}-\d{2}-\d{2}$/);
});

test('provider labels resolve by stable id instead of the upstream display name', () => {
  const raw = makeRawUsage('7d', now);
  raw.by.provider = [
    { id: 'session-unknown', name: 'Local session', ...sample(10) },
    { id: 'minimax-cn', name: 'MiniMax (China)', ...sample(20) },
    { id: 'zhipu', name: 'Zhipu GLM', ...sample(30) },
    { id: 'zcode', name: 'ZCode', ...sample(5) },
    { id: 'mystery-vendor', name: 'Mystery Corp', ...sample(1) },
  ];
  const providers = normalizeUsage(raw).providers;
  assert.deepEqual(providers.map(p => p.label), ['GLM', 'MiniMax', '本地会话', 'ZCode', 'Unknown']);
  // The upstream display name never reaches the client.
  assert.ok(!JSON.stringify(providers).includes('Mystery Corp'));
  assert.ok(!JSON.stringify(providers).includes('Local session'));
});

test('one model reported under a prefix or another casing becomes a single line', () => {
  const raw = makeRawUsage('7d', now);
  raw.by.model = [
    { name: 'glm-5.3', ...sample(100) },
    { name: 'GLM-5.3', ...sample(20) },
    { name: 'zhipu/glm-5.3', ...sample(5) },
    { name: 'gpt-6.1-sol', ...sample(50) },
  ];
  const models = normalizeUsage(raw).models;
  assert.equal(models.length, 2);
  assert.equal(models[0].label, 'glm-5.3');
  assert.equal(models[0].totalTokens, 125);
  assert.equal(models[0].requests, 3);
  assert.equal(models[1].label, 'gpt-6.1-sol');
});

test('the display configuration chooses how many rows are shown', () => {
  const raw = makeRawUsage('7d', now);
  raw.by.model = Array.from({ length: 12 }, (_, i) => ({ name: 'gpt-5-demo-' + i, ...sample(i + 1) }));
  const snapshot = { failures: {}, parts: { week: { observedAt: new Date(now).toISOString(), data: normalizeUsage(raw) } } };
  const limited = project(snapshot, now, { modelLimit: 3 });
  assert.equal(limited.rankings.models.length, 3);
  assert.equal(limited.display.modelLimit, 3);
  assert.equal(limited.rankings.models[0].label, 'gpt-5-demo-11');
});

test('the display configuration selects and orders the subscriptions the phone shows', () => {
  const snapshot = { failures: {}, parts: { quotas: { observedAt: new Date(now).toISOString(), data: normalizeQuotas(makeQuotaResponse(now)) } } };
  assert.deepEqual(project(snapshot, now).subscriptions.map(card => card.provider), ['codex', 'minimax', 'glm']);
  assert.deepEqual(project(snapshot, now, { subscriptions: ['glm', 'codex'] }).subscriptions.map(card => card.provider), ['glm', 'codex']);
  assert.deepEqual(project(snapshot, now, { subscriptions: ['minimax'] }).subscriptions.map(card => card.provider), ['minimax']);
});

test('display options are clamped and never carry unsafe identifiers', () => {
  assert.equal(displayOptions({ modelLimit: 999 }).modelLimit, 20);
  assert.equal(displayOptions({ modelLimit: 0 }).modelLimit, 1);
  assert.equal(displayOptions({ modelLimit: 'many' }).modelLimit, 8);
  assert.deepEqual(displayOptions({ subscriptions: ['codex', '../../etc', 'MiniMax'] }).subscriptions, ['codex', 'minimax']);
  assert.deepEqual(displayOptions({}).subscriptions, ['codex', 'minimax', 'glm']);
});
