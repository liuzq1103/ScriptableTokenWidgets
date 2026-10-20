import { readFile, writeFile, mkdir, rename } from 'node:fs/promises';
import path from 'node:path';
import { normalizeQuotas, normalizeUsage, project, shanghaiDay } from './normalize.mjs';

export class Collector {
  constructor({ upstream, magpieDir, snapshotFile, fetcher = fetch, clock = Date.now }) {
    Object.assign(this, { upstream, magpieDir, snapshotFile, fetcher, clock });
    this.snapshot = { version: 1, parts: {}, failures: {} };
    this.pending = null;
  }
  async load() {
    try {
      const saved = JSON.parse(await readFile(this.snapshotFile, 'utf8'));
      if (saved.version === 1 && saved.parts && saved.failures) {
        this.snapshot = saved;
        for (const key of Object.keys(saved.parts)) this.snapshot.failures[key] = true;
      }
    } catch { /* A new or damaged cache must not prevent startup. */ }
  }
  async request(endpoint) {
    const result = await this.fetcher(new URL(endpoint, this.upstream), {
      signal: AbortSignal.timeout(15_000), headers: { Accept: 'application/json' }, redirect: 'error',
    });
    if (!result.ok) throw new Error('Magpie unavailable');
    return result.json();
  }
  async quotaCache() {
    try { return JSON.parse(await readFile(path.join(this.magpieDir, 'quotas.json'), 'utf8')); }
    catch { return {}; }
  }
  refresh() {
    if (this.pending) return this.pending;
    this.pending = this.collect().finally(() => { this.pending = null; });
    return this.pending;
  }
  async collect() {
    const jobs = {
      quotas: async () => normalizeQuotas(await this.request('/v1/magpie/quotas?kept=1'), await this.quotaCache()),
      today: async () => normalizeUsage(await this.request('/v1/magpie/usage/requests?period=today&limit=1')),
      week: async () => normalizeUsage(await this.request('/v1/magpie/usage/requests?period=7d&limit=1')),
    };
    await Promise.all(Object.entries(jobs).map(async ([key, job]) => {
      try {
        const periodDay = shanghaiDay(this.clock());
        const data = await job();
        this.snapshot.parts[key] = { observedAt: new Date(this.clock()).toISOString(), periodDay, data };
        delete this.snapshot.failures[key];
      } catch { this.snapshot.failures[key] = true; }
    }));
    try {
      await mkdir(path.dirname(this.snapshotFile), { recursive: true });
      await writeFile(this.snapshotFile + '.tmp', JSON.stringify(this.snapshot), { mode: 0o600 });
      await rename(this.snapshotFile + '.tmp', this.snapshotFile);
    } catch { console.warn('Snapshot could not be saved; serving the in-memory snapshot.'); }
  }
  overview() { return project(this.snapshot, this.clock()); }
}
