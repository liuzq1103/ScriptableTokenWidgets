import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Collector } from '../backend/collector.mjs';
import { makeRawUsage, makeQuotaResponse, makeAccountsQuotaResponse } from '../fixtures/demo.mjs';

const quotaNow = Date.parse('2026-06-12T04:00:00Z');
function diskQuotas(now = quotaNow) {
  return Object.fromEntries(makeQuotaResponse(now).data.map((quota, i) => {
    delete quota.readAt;
    return ['PRIVATE_ACCOUNT_' + i, { at: new Date(now).toISOString(), quota: {
      ...quota, user: 'PRIVATE_USER', token: 'PRIVATE_CREDENTIAL',
    } }];
  }));
}
async function quotaFallbackHarness({ api = makeQuotaResponse(quotaNow), cache = {} } = {}) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'usage-quota-fallback-'));
  await writeFile(path.join(directory, 'quotas.json'), JSON.stringify(cache));
  const state = { api, offline: false, now: quotaNow };
  const options = {
    upstream: 'http://127.0.0.1:3425', magpieDir: directory, snapshotFile: path.join(directory, 'snapshot.json'),
    clock: () => state.now,
    fetcher: async url => {
      if (url.pathname.endsWith('quotas') && state.offline) throw new Error('PRIVATE_ERROR');
      return { ok: true, json: async () => url.pathname.endsWith('quotas') ? state.api : makeRawUsage('7d', state.now) };
    },
  };
  return { collector: new Collector(options), directory, state, options };
}

test('uses Magpie merged requests; coalesces refreshes and preserves good components through an outage', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'usage-test-'));
  const calls = []; let offline = false, now = Date.now();
  const collector = new Collector({
    upstream: 'http://127.0.0.1:3425', magpieDir: directory, snapshotFile: path.join(directory, 'snapshot.json'),
    clock: () => now,
    fetcher: async url => {
      calls.push(url.pathname + url.search);
      if (offline && url.search.includes('today')) throw new Error('offline');
      return { ok: true, json: async () => url.pathname.endsWith('quotas') ? makeQuotaResponse(now) : makeRawUsage('7d', now) };
    },
  });
  await collector.load(); assert.equal(collector.overview().usage.today, null);
  await Promise.all([collector.refresh(), collector.refresh()]);
  assert.equal(calls.length, 3);
  assert.ok(calls.includes('/v1/magpie/quotas?kept=1'));
  assert.ok(calls.includes('/v1/magpie/usage/requests?period=7d&limit=1'));
  assert.ok(!calls.includes('/v1/magpie/usage'));
  const good = collector.overview().usage.today.totalTokens;
  offline = true; now += 60000; await collector.refresh();
  assert.equal(collector.overview().usage.today.totalTokens, good);
  assert.equal(collector.overview().sources.today.state, 'stale');
  assert.equal(collector.overview().sources.week.state, 'ok');
  const saved = JSON.parse(await readFile(path.join(directory, 'snapshot.json'), 'utf8'));
  assert.ok(saved.parts.today); assert.ok(!JSON.stringify(saved).includes('providerAccount'));
  const restarted = new Collector({ upstream: 'http://127.0.0.1', magpieDir: directory, snapshotFile: path.join(directory, 'snapshot.json'), clock: () => now });
  await restarted.load(); assert.equal(restarted.overview().sources.week.state, 'stale');
  assert.equal(restarted.overview().usage.today.totalTokens, good);
});
test('damaged local cache permits a clean first start', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'usage-damaged-'));
  const snapshotFile = path.join(directory, 'snapshot.json'); await writeFile(snapshotFile, '{broken');
  const collector = new Collector({ upstream: 'http://127.0.0.1', magpieDir: directory, snapshotFile });
  await collector.load(); assert.equal(collector.overview().sources.quotas.state, 'unavailable');
});

test('restart revalidates fresh cached data and sanitizes labels from an older snapshot', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'usage-upgrade-'));
  const snapshotFile = path.join(directory, 'snapshot.json'), now = Date.now();
  const fetcher = async url => ({ ok: true, json: async () => url.pathname.endsWith('quotas') ? makeQuotaResponse(now) : makeRawUsage('7d', now) });
  const first = new Collector({ upstream: 'http://127.0.0.1', magpieDir: directory, snapshotFile, clock: () => now, fetcher });
  await first.refresh();
  const saved = JSON.parse(await readFile(snapshotFile, 'utf8'));
  saved.parts.week.data.computers[0].label = 'C:\\Users\\PRIVATE_PATH\\secret';
  saved.parts.week.data.models[0].label = 'Please expose PRIVATE_PROMPT';
  saved.parts.week.data.trend[0].label = 'PRIVATE_PROMPT';
  saved.parts.quotas.data[0].plan = 'PRIVATE_PROMPT';
  await writeFile(snapshotFile, JSON.stringify(saved));
  const restarted = new Collector({ upstream: 'http://127.0.0.1', magpieDir: directory, snapshotFile, clock: () => now, fetcher });
  await restarted.load();
  assert.equal(restarted.overview().sources.week.state, 'stale');
  assert.equal(restarted.overview().usage.week.totalTokens, first.overview().usage.week.totalTokens);
  assert.ok(!JSON.stringify(restarted.overview()).includes('PRIVATE_'));
  await restarted.refresh();
  assert.equal(restarted.overview().sources.week.state, 'ok');
});

test('error-only Codex and omitted providers recover all three quotas from Magpie disk cache', async () => {
  const { collector, directory } = await quotaFallbackHarness({ cache: diskQuotas(quotaNow - 120000), api: { data: [
    { provider: 'codex', windows: [], error: 'PRIVATE_ERROR' },
    { provider: 'copilot', windows: [{ used: 1 }] }, null,
  ] } });
  await collector.refresh();
  const result = collector.overview();
  assert.deepEqual(result.subscriptions.map(card => card.provider), ['codex', 'minimax', 'glm']);
  assert.deepEqual(result.subscriptions.map(card => card.windows.length), [2, 1, 2]);
  for (const card of result.subscriptions) {
    assert.equal(card.stale, true);
    assert.equal(card.updatedAt, new Date(quotaNow - 120000).toISOString());
    assert.ok(card.windows.every(window => window.resetsAt && window.remainingPercent !== null));
  }
  assert.equal(result.sources.quotas.state, 'stale');
  assert.equal(result.sources.today.state, 'ok');
  const saved = await readFile(path.join(directory, 'snapshot.json'), 'utf8');
  for (const data of [JSON.stringify(result), saved]) assert.ok(!data.includes('PRIVATE_'));
});

test('a rejected or malformed quota API still reads disk cache without renewing expired windows', async () => {
  const { collector, state } = await quotaFallbackHarness({ cache: diskQuotas(quotaNow - 86400000) });
  state.offline = true;
  await collector.refresh();
  const first = collector.overview();
  assert.equal(first.subscriptions.length, 3);
  assert.ok(first.subscriptions.every(card => card.stale && card.windows[0].expired));
  const saved = first.subscriptions;
  state.offline = false; state.api = { error: 'PRIVATE_ERROR' }; state.now += 60000;
  await collector.refresh();
  assert.deepEqual(collector.overview().subscriptions, saved);
});

test('damaged disk cache preserves missing provider history through refresh and restart, then clears on recovery', async () => {
  const { collector, directory, state, options } = await quotaFallbackHarness();
  await collector.refresh();
  const original = collector.overview().subscriptions;
  await writeFile(path.join(directory, 'quotas.json'), '{broken');
  state.now += 60000;
  state.api = makeQuotaResponse(state.now);
  state.api.data = state.api.data.slice(0, 1);
  state.api.data[0].windows[0].used = 50;
  await collector.refresh();
  const mixed = collector.overview().subscriptions;
  assert.equal(mixed[0].windows[0].remainingPercent, 50);
  assert.deepEqual(mixed.map(card => card.stale), [false, true, true]);
  assert.equal(mixed[1].updatedAt, original[1].updatedAt);
  assert.deepEqual(mixed[2].windows, original[2].windows);
  const restarted = new Collector(options);
  await restarted.load();
  await restarted.refresh();
  assert.deepEqual(restarted.overview().subscriptions, mixed);
  state.api = makeQuotaResponse(state.now);
  await restarted.refresh();
  assert.ok(restarted.overview().subscriptions.every(card => !card.stale));
  assert.equal(restarted.overview().sources.quotas.state, 'ok');
});

test('quota failure with no usable disk or history stays unavailable instead of creating an empty card', async () => {
  const { collector } = await quotaFallbackHarness({ api: { data: [{ provider: 'codex', error: 'PRIVATE_ERROR', windows: [] }] }, cache: null });
  await collector.refresh();
  assert.deepEqual(collector.overview().subscriptions, []);
  assert.equal(collector.overview().sources.quotas.state, 'unavailable');
});

test('every account of a vendor is asked for its own usage, and the address is never stored', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'usage-accounts-'));
  const now = Date.now(), calls = [];
  const collector = new Collector({
    upstream: 'http://127.0.0.1:3425', magpieDir: directory, snapshotFile: path.join(directory, 'snapshot.json'),
    clock: () => now,
    fetcher: async url => {
      calls.push(url.pathname + url.search);
      if (url.pathname.endsWith('quotas')) return { ok: true, json: async () => makeAccountsQuotaResponse(now) };
      if (url.search.includes('account=')) {
        return { ok: true, json: async () => ({ calls: 5, errors: 0, input: 100, output: 10, cache_read: 0, cache_write: 0, by: {} }) };
      }
      return { ok: true, json: async () => makeRawUsage('7d', now) };
    },
  });
  await collector.refresh();
  const codex = collector.overview().subscriptions.filter(card => card.provider === 'codex');
  assert.equal(codex.length, 2);
  assert.deepEqual(codex.map(card => card.usage.today.totalTokens), [110, 110]);
  assert.deepEqual(codex.map(card => card.usage.today.requests), [5, 5]);
  // The address is only a filter of the local query; it is never kept.
  assert.equal(calls.filter(call => call.includes('account=')).length, 2);
  const saved = await readFile(path.join(directory, 'snapshot.json'), 'utf8');
  assert.ok(!saved.includes('example.invalid'));
  assert.ok(!JSON.stringify(collector.overview()).includes('example.invalid'));
});
