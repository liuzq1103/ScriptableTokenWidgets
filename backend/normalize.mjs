const PROVIDERS = {
  codex: { id: 'codex', label: 'Codex', plan: 'ChatGPT' },
  'minimax-cn': { id: 'minimax', label: 'MiniMax', plan: 'Coding Plan' },
  minimax: { id: 'minimax', label: 'MiniMax', plan: 'Coding Plan' },
  zhipu: { id: 'glm', label: 'GLM', plan: 'Coding Plan' },
};
export const iso = value => typeof value === 'string' && Number.isFinite(Date.parse(value))
  ? new Date(value).toISOString() : null;
export const number = value => typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : 0;
export const label = (value, fallback = '') => typeof value === 'string'
  ? value.replace(/[\w.+-]+@[\w.-]+\.[a-z]{2,}/gi, '[account]').replace(/[\u0000-\u001f]/g, '').slice(0, 96) : fallback;

export function metrics(raw = {}) {
  const inputTokens = number(raw.input), outputTokens = number(raw.output);
  const cacheReadTokens = number(raw.cache_read), cacheWriteTokens = number(raw.cache_write);
  const inputTotal = inputTokens + cacheReadTokens + cacheWriteTokens;
  return {
    requests: number(raw.calls), errors: number(raw.errors),
    inputTokens, outputTokens, cacheReadTokens, cacheWriteTokens,
    reasoningTokens: number(raw.reasoning),
    totalTokens: inputTotal + outputTokens,
    cacheHitPercent: inputTotal ? cacheReadTokens / inputTotal * 100 : null,
  };
}
export function normalizeQuotas(raw, cache = {}) {
  if (!raw || !Array.isArray(raw.data)) throw new Error('Invalid quota response');
  const counts = {};
  return raw.data.flatMap(card => {
    const provider = PROVIDERS[card.provider];
    if (!provider || !Array.isArray(card.windows)) return [];
    const index = counts[provider.id] = (counts[provider.id] || 0) + 1;
    const cached = Object.values(cache).filter(item => item?.quota?.provider === card.provider);
    const updatedAt = iso(card.readAt) || (cached.length === 1 ? iso(cached[0].at) : null);
    return [{
      id: index === 1 ? provider.id : provider.id + '-' + index,
      provider: provider.id, label: provider.label + (index > 1 ? ' ' + index : ''),
      plan: label(card.plan, provider.plan) || provider.plan, updatedAt,
      windows: card.windows.map(window => {
        const known = typeof window.used === 'number' && Number.isFinite(window.used) && window.used >= 0;
        const usedPercent = known ? Math.min(100, window.used) : null;
        return {
          label: label(window.name, 'Quota'), usedPercent,
          remainingPercent: known ? 100 - usedPercent : null,
          resetsAt: iso(window.resetsAt),
          amount: typeof window.amount === 'number' ? number(window.amount) : null,
          limit: typeof window.limit === 'number' ? number(window.limit) : null,
        };
      }),
    }];
  }).sort((a, b) => ['codex', 'minimax', 'glm'].indexOf(a.provider) - ['codex', 'minimax', 'glm'].indexOf(b.provider));
}
function ranking(rows, type) {
  return (Array.isArray(rows) ? rows : []).map((row, i) => ({
    id: type + '-' + (i + 1), label: label(row.name || row.model || row.id, 'Unknown'), ...metrics(row),
  })).sort((a, b) => b.totalTokens - a.totalTokens).slice(0, type === 'model' ? 8 : 20);
}
export function normalizeUsage(raw) {
  if (!raw || !['input', 'output', 'cache_read', 'cache_write', 'calls'].every(key =>
    typeof raw[key] === 'number' && Number.isFinite(raw[key]) && raw[key] >= 0)) throw new Error('Invalid usage response');
  return {
    metrics: metrics(raw),
    trend: (Array.isArray(raw.series) ? raw.series : []).map(item => ({
      at: iso(item.time), label: label(item.label), ...metrics(item),
    })),
    models: ranking(raw.by?.model, 'model'),
    providers: ranking(raw.by?.provider, 'provider'),
    computers: ranking(raw.computers, 'computer'),
  };
}
export const shanghaiDay = value => new Date(value + 8 * 3600_000).toISOString().slice(0, 10);
export function project(snapshot, now = Date.now()) {
  const sources = {};
  for (const key of ['quotas', 'today', 'week']) {
    const part = snapshot.parts[key];
    sources[key] = {
      state: !part ? 'unavailable' : snapshot.failures[key] || now - Date.parse(part.observedAt) > 180_000 ? 'stale' : 'ok',
      observedAt: part?.observedAt || null,
    };
  }
  const todayPart = snapshot.parts.today;
  const outdated = !!todayPart && (todayPart.periodDay || shanghaiDay(Date.parse(todayPart.observedAt))) !== shanghaiDay(now);
  if (outdated) { sources.today.state = 'stale'; sources.today.outdated = true; }
  const subscriptions = (snapshot.parts.quotas?.data || []).map(card => ({
    ...card,
    stale: sources.quotas.state !== 'ok' || !!card.updatedAt && now - Date.parse(card.updatedAt) > 900_000,
    windows: card.windows.map(window => ({ ...window,
      expired: !!window.resetsAt && Date.parse(window.resetsAt) <= now,
    })),
  }));
  return {
    schemaVersion: 1, generatedAt: new Date(now).toISOString(), timezone: 'Asia/Shanghai', sources,
    subscriptions,
    usage: { today: outdated ? null : snapshot.parts.today?.data.metrics || null, week: snapshot.parts.week?.data.metrics || null },
    trend: snapshot.parts.week?.data.trend || [],
    rankings: {
      models: snapshot.parts.week?.data.models || [],
      providers: snapshot.parts.week?.data.providers || [],
      computers: snapshot.parts.week?.data.computers || [],
    },
  };
}
