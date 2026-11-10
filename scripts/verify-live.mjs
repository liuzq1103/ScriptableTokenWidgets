import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Collector } from '../backend/collector.mjs';
import { modelKey } from '../backend/normalize.mjs';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const config = JSON.parse(await readFile(path.join(root, '.local/config.json'), 'utf8'));
const originals = {};
const collector = new Collector({
  ...config, snapshotFile: path.join(root, '.local/validation-snapshot.json'),
  fetcher: async (url, options) => {
    const response = await fetch(url, options), data = await response.json();
    // An account's own usage is a separate query; it must not replace the
    // day's totals the checks below compare against.
    const account = url.searchParams.get('account');
    originals[account ? 'account:' + account : (url.searchParams.get('period') || 'quotas')] = data;
    return { ok: response.ok, json: async () => data };
  },
});
await collector.refresh();
const result = collector.overview();
for (const key of ['today', 'week']) assert.equal(result.sources[key].state, 'ok');
assert.notEqual(result.sources.quotas.state, 'unavailable');
for (const [period, key] of [['today', 'today'], ['7d', 'week']]) {
  const raw = originals[period], normalized = result.usage[key];
  assert.equal(normalized.totalTokens, raw.input + raw.output + raw.cache_read + raw.cache_write);
  assert.equal(normalized.requests, raw.calls);
  assert.equal(normalized.reasoningTokens, raw.reasoning || 0);
}
assert.equal(result.trend.length, originals['7d'].series.length);
const total = row => row.input + row.output + row.cache_read + row.cache_write;
// One model may be reported under a provider prefix or another casing; the
// service merges those rows, so the expectation is rebuilt the same way.
function mergedModels(rows) {
  const groups = new Map();
  for (const [index, row] of rows.entries()) {
    const key = modelKey(row.name || row.model || row.id) ?? 'unknown:' + index;
    const group = groups.get(key) || { totalTokens: 0, requests: 0 };
    group.totalTokens += total(row);
    group.requests += row.calls || 0;
    groups.set(key, group);
  }
  return [...groups.values()].sort((a, b) => b.totalTokens - a.totalTokens);
}
const display = result.display;
const simple = rows => [...rows].map(row => ({ totalTokens: total(row), requests: row.calls || 0 }))
  .sort((a, b) => b.totalTokens - a.totalTokens);
const rankedTypes = [
  ['models', mergedModels(originals['7d'].by?.model || []), display.modelLimit],
  ['providers', simple(originals['7d'].by?.provider || []), display.providerLimit],
  ['computers', simple(originals['7d'].computers || []), display.computerLimit],
];
for (const [type, ranked, limit] of rankedTypes) {
  assert.equal(result.rankings[type].length, Math.min(limit, ranked.length));
  for (const [index, row] of result.rankings[type].entries()) {
    const expected = ranked[index];
    assert.equal(row.totalTokens, expected.totalTokens);
    assert.equal(row.requests, expected.requests);
  }
}
const rawModelTotal = (originals['7d'].by?.model || []).reduce((sum, row) => sum + total(row), 0);
const mergedModelTotal = mergedModels(originals['7d'].by?.model || []).reduce((sum, group) => sum + group.totalTokens, 0);
assert.equal(mergedModelTotal, rawModelTotal);
for (const [index, row] of result.trend.entries()) {
  const raw = originals['7d'].series[index];
  assert.equal(row.totalTokens, total(raw));
}
assert.ok(result.subscriptions.length > 0);
for (const card of result.subscriptions) {
  assert.ok(card.windows.some(window => window.usedPercent !== null));
  for (const window of card.windows) {
    if (window.usedPercent === null) continue;
    assert.ok(window.usedPercent >= 0 && window.usedPercent <= 100);
    assert.equal(window.remainingPercent, 100 - window.usedPercent);
  }
  // A subscription's own usage is part of the day's total, never more.
  if (card.usage && card.usage.today) {
    assert.ok(card.usage.today.totalTokens >= 0);
    assert.ok(card.usage.today.totalTokens <= result.usage.today.totalTokens);
    assert.ok(card.usage.today.requests <= result.usage.today.requests);
  }
}
const accounts = Object.keys(originals).filter(key => key.startsWith('account:'));
assert.equal(accounts.length, result.subscriptions.filter(card => card.accountUsage).length,
  'every account of a vendor is asked for its own usage');
const cached = result.subscriptions.filter(card => card.stale).length;
console.log('Live verification passed: merged today/7d totals, daily trend, ' + result.rankings.models.length + ' models, ' + result.rankings.computers.length + ' devices and ' + result.subscriptions.length + ' subscriptions (' + cached + ' cached). No credentials or private usage printed.');
