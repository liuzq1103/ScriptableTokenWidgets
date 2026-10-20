const PROVIDERS = {
  codex: { id: 'codex', label: 'Codex', plan: 'ChatGPT' },
  'minimax-cn': { id: 'minimax', label: 'MiniMax', plan: 'Coding Plan' },
  minimax: { id: 'minimax', label: 'MiniMax', plan: 'Coding Plan' },
  zhipu: { id: 'glm', label: 'GLM', plan: 'Coding Plan' },
};
export const iso = value => typeof value === 'string' && Number.isFinite(Date.parse(value))
  ? new Date(value).toISOString() : null;
export const number = value => typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : 0;
// Labels are typed metadata, never arbitrary upstream text.
const plans = /^(?:ChatGPT|Coding Plan|Free|Go|Plus|Pro|Team|Business|Enterprise|Starter|Lite|Basic|Standard|Max|Ultra)$/i;
const windows = /^(?:\d{1,3}\s*(?:h|hours?|d|days?|minutes?|weeks?|months?|小时|天|周|月)|weekly|daily|monthly|yearly|tokens?|requests?|search|mcp|total)$/i;
const modelFamily = /^(?:gpt[-.]?\d|o[1-9](?:-|$)|codex(?:-|$)|claude[-.](?:opus|sonnet|haiku|\d)|minimax-m\d|glm[-.]?\d|gemini[-.]?\d|qwen\d|deepseek[-.]?(?:v\d|r\d|chat|reasoner)|kimi[-.]?(?:k\d|latest)|grok[-.]?\d|mistral[-.]|llama[-.]?\d)/i;
const providerNames = new Map(Object.entries({
  codex: 'Codex', 'minimax-cn': 'MiniMax', minimax: 'MiniMax', zhipu: 'GLM', glm: 'GLM',
  openai: 'OpenAI', anthropic: 'Anthropic', google: 'Google', deepseek: 'DeepSeek',
  qwen: 'Qwen', kimi: 'Kimi', moonshot: 'Moonshot', ollama: 'Ollama',
}));
function typedLabel(value, type, index) {
  if (typeof value !== 'string') return type === 'computer' ? 'Device ' + (index + 1) : 'Unknown';
  if (type === 'computer') return /^[a-z0-9][a-z0-9_-]{0,62}$/i.test(value) ? value : 'Device ' + (index + 1);
  if (type === 'provider') return providerNames.get(value.toLowerCase()) || 'Unknown';
  // Accept model identifiers from known families; discard provider prefixes.
  if (value.length > 120 || /^(?:[a-z]:|[\/~.])/i.test(value) || value.includes('\\') || value.split('/').length > 2) return 'Unknown';
  const model = value.split('/').at(-1);
  return /^[a-z0-9][a-z0-9._-]{0,79}$/i.test(model) && modelFamily.test(model) ? model : 'Unknown';
}

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
      plan: typeof card.plan === 'string' && plans.test(card.plan) ? card.plan : provider.plan, updatedAt,
      windows: card.windows.map(window => {
        const known = typeof window.used === 'number' && Number.isFinite(window.used) && window.used >= 0;
        const usedPercent = known ? Math.min(100, window.used) : null;
        return {
          label: typeof window.name === 'string' && windows.test(window.name) ? window.name : 'Quota', usedPercent,
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
    id: type + '-' + (i + 1), label: typedLabel(row.name || row.model || row.id, type, i), ...metrics(row),
  })).sort((a, b) => b.totalTokens - a.totalTokens).slice(0, type === 'model' ? 8 : 20);
}
export function normalizeUsage(raw) {
  if (!raw || !['input', 'output', 'cache_read', 'cache_write', 'calls'].every(key =>
    typeof raw[key] === 'number' && Number.isFinite(raw[key]) && raw[key] >= 0)) throw new Error('Invalid usage response');
  return {
    metrics: metrics(raw),
    trend: (Array.isArray(raw.series) ? raw.series : []).map((item, index) => ({
      at: iso(item.time), label: iso(item.time) ? shanghaiDay(Date.parse(item.time)) : 'Day ' + (index + 1), ...metrics(item),
    })),
    models: ranking(raw.by?.model, 'model'),
    providers: ranking(raw.by?.provider, 'provider'),
    computers: ranking(raw.computers, 'computer'),
  };
}

export function sanitizeCachedLabels(data, key) {
  if (key === 'quotas') return normalizeQuotas({ data: data.map(card => ({
    provider: card.provider === 'glm' ? 'zhipu' : card.provider, plan: card.plan, readAt: card.updatedAt,
    windows: card.windows.map(window => ({ ...window, name: window.label, used: window.usedPercent })),
  })) });
  const cleanRows = (rows, type) => rows.map((row, index) => ({ ...row, label: typedLabel(row.label, type, index) }));
  return { ...data,
    trend: data.trend.map((row, index) => ({ ...row, label: iso(row.at) ? shanghaiDay(Date.parse(row.at)) : 'Day ' + (index + 1) })),
    models: cleanRows(data.models, 'model'), providers: cleanRows(data.providers, 'provider'),
    computers: cleanRows(data.computers, 'computer'),
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
