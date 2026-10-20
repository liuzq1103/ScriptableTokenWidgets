import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Collector } from '../backend/collector.mjs';
import { makeRawUsage, makeQuotaResponse } from '../fixtures/demo.mjs';

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
