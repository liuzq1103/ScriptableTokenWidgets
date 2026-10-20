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
    originals[url.searchParams.get('period') || 'quotas'] = data;
    return { ok: response.ok, json: async () => data };
  },
});
await collector.refresh();
const result = collector.overview();
for (const source of Object.values(result.sources)) assert.equal(source.state, 'ok');
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
console.log('Live verification passed: merged today/7d totals, daily trend, ' + result.rankings.models.length + ' models, ' + result.rankings.computers.length + ' devices and ' + result.subscriptions.length + ' subscriptions. No credentials or private usage printed.');
