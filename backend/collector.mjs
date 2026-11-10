import { readFile, writeFile, mkdir, rename } from 'node:fs/promises';
import path from 'node:path';
import { resolveQuotas, normalizeUsage, project, shanghaiDay, sanitizeCachedLabels, providerFamily, number } from './normalize.mjs';

export class Collector {
  constructor({ upstream, magpieDir, snapshotFile, fetcher = fetch, clock = Date.now, display = {} }) {
    Object.assign(this, { upstream, magpieDir, snapshotFile, fetcher, clock });
    this.display = display;
    this.snapshot = { version: 1, parts: {}, failures: {} };
    this.pending = null;
    // The address of every account, kept in memory only: it is never written
    // to the snapshot and never leaves this machine.
    this.addresses = new Map();
  }
  async load() {
    try {
      const saved = JSON.parse(await readFile(this.snapshotFile, 'utf8'));
      if (saved.version === 1 && saved.parts && saved.failures) {
        for (const key of Object.keys(saved.parts)) {
          saved.parts[key].data = sanitizeCachedLabels(saved.parts[key].data, key);
          saved.failures[key] = true; // Await live revalidation after every process restart.
        }
        this.snapshot = saved;
      }
    } catch { /* A new or damaged cache must not prevent startup. */ }
  }
  async request(endpoint, timeout = 15_000) {
    const result = await this.fetcher(new URL(endpoint, this.upstream), {
      signal: AbortSignal.timeout(timeout), headers: { Accept: 'application/json' }, redirect: 'error',
    });
    if (!result.ok) throw new Error('Magpie unavailable');
    return result.json();
  }
  async quotaCache() {
    try { return JSON.parse(await readFile(path.join(this.magpieDir, 'quotas.json'), 'utf8')); }
    catch { return {}; }
  }
  async quotas() {
    const [response, cache] = await Promise.allSettled([
      this.request('/v1/magpie/quotas?kept=1'), this.quotaCache(),
    ]);
    const raw = response.status === 'fulfilled' ? response.value : null;
    const cards = resolveQuotas(raw, cache.status === 'fulfilled' ? cache.value : {}, this.snapshot.parts.quotas?.data || []);
    await this.accountUsage(raw, cards);
    return cards;
  }
  // An account's own usage is asked for by the address Magpie reports for it.
  // The address goes into the query of the local gateway and only the totals
  // come back, so it never leaves this machine and is never stored.
  async accountUsage(raw, cards) {
    const fresh = new Map();
    for (const card of raw?.data || []) {
      const family = providerFamily(card?.provider);
      const address = typeof card?.user === 'string' ? card.user.trim() : '';
      if (!family || !address.includes('@')) continue;
      const key = family + '@' + address.split('@')[0];
      const known = fresh.get(key);
      // Two accounts of one vendor that share the same name cannot be told
      // apart: their usage stays unknown instead of being taken from the wrong
      // one.
      if (known === null) continue;
      if (known && known !== address) { fresh.set(key, null); continue; }
      fresh.set(key, address);
    }
    // The addresses of the last successful reading are kept in memory only, so
    // the usage of an account survives a quota outage. They are never written
    // to the snapshot.
    if (fresh.size) this.addresses = new Map([...this.addresses, ...fresh]);
    await Promise.all(cards.filter(card => card.account).map(async card => {
      const address = this.addresses.get(card.id);
      if (!address) return;
      try {
        // A short timeout: the reading of the quotas must not wait long for a
        // usage query that only fills in one number.
        const data = await this.request('/v1/magpie/usage/requests?period=today&limit=1&account=' + encodeURIComponent(address), 5000);
        if (!['input', 'output', 'cache_read', 'cache_write', 'calls'].every(key =>
          typeof data[key] === 'number' && Number.isFinite(data[key]))) return;
        const total = number(data.input) + number(data.output) + number(data.cache_read) + number(data.cache_write);
        card.accountUsage = { today: { totalTokens: total, requests: number(data.calls) } };
      } catch { /* The card keeps what the family reports. */ }
    }));
  }
  refresh() {
    if (this.pending) return this.pending;
    this.pending = this.collect().finally(() => { this.pending = null; });
    return this.pending;
  }
  async collect() {
    const jobs = {
      quotas: () => this.quotas(),
      today: async () => normalizeUsage(await this.request('/v1/magpie/usage/requests?period=today&limit=1')),
      week: async () => normalizeUsage(await this.request('/v1/magpie/usage/requests?period=7d&limit=1')),
    };
    await Promise.all(Object.entries(jobs).map(async ([key, job]) => {
      try {
        const periodDay = shanghaiDay(this.clock());
        const data = await job();
        this.snapshot.parts[key] = { observedAt: new Date(this.clock()).toISOString(), periodDay, data };
        if (key === 'quotas' && data.every(card => card.stale)) this.snapshot.failures[key] = true;
        else delete this.snapshot.failures[key];
      } catch { this.snapshot.failures[key] = true; }
    }));
    try {
      await mkdir(path.dirname(this.snapshotFile), { recursive: true });
      await writeFile(this.snapshotFile + '.tmp', JSON.stringify(this.snapshot), { mode: 0o600 });
      await rename(this.snapshotFile + '.tmp', this.snapshotFile);
    } catch { console.warn('Snapshot could not be saved; serving the in-memory snapshot.'); }
  }
  overview() { return project(this.snapshot, this.clock(), this.display); }
}
