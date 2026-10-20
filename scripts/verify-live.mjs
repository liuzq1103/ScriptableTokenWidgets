import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Collector } from '../backend/collector.mjs';
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
const rankedTypes = [
  ['models', originals['7d'].by?.model || [], 8],
  ['providers', originals['7d'].by?.provider || [], 20],
  ['computers', originals['7d'].computers || [], 20],
];
for (const [type, rows, limit] of rankedTypes) {
  const ranked = [...rows].sort((a, b) =>
    (b.input + b.output + b.cache_read + b.cache_write) - (a.input + a.output + a.cache_read + a.cache_write));
  assert.equal(result.rankings[type].length, Math.min(limit, rows.length));
  for (const [index, row] of result.rankings[type].entries()) {
    const raw = ranked[index];
    assert.equal(row.totalTokens, raw.input + raw.output + raw.cache_read + raw.cache_write);
    assert.equal(row.requests, raw.calls);
  }
}
for (const [index, row] of result.trend.entries()) {
  const raw = originals['7d'].series[index];
  assert.equal(row.totalTokens, raw.input + raw.output + raw.cache_read + raw.cache_write);
}
assert.ok(result.subscriptions.length > 0);
console.log('Live verification passed: merged today/7d totals, daily trend, ' + result.rankings.computers.length + ' devices and ' + result.subscriptions.length + ' subscriptions. No credentials or private usage printed.');
