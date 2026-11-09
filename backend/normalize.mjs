const PROVIDERS = {
  codex: { id: 'codex', label: 'Codex', plan: 'ChatGPT' },
  'minimax-cn': { id: 'minimax', label: 'MiniMax', plan: 'Coding Plan' },
  minimax: { id: 'minimax', label: 'MiniMax', plan: 'Coding Plan' },
  zhipu: { id: 'glm', label: 'GLM', plan: 'Coding Plan' },
};
// Canonical display order of the known subscription families.
const PROVIDER_ORDER = ['codex', 'minimax', 'glm'];
export const iso = value => typeof value === 'string' && Number.isFinite(Date.parse(value))
  ? new Date(value).toISOString() : null;
export const number = value => typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : 0;
// Labels are typed metadata, never arbitrary upstream text.
const plans = /^(?:ChatGPT|Coding Plan|Free|Go|Plus|Pro|Team|Business|Enterprise|Starter|Lite|Basic|Standard|Max|Ultra)$/i;
const windows = /^(?:\d{1,3}\s*(?:h|hours?|d|days?|minutes?|weeks?|months?|小时|天|周|月)|weekly|daily|monthly|yearly|tokens?|requests?|search|mcp|total)$/i;
const modelFamily = /^(?:gpt[-.]?\d|o[1-9](?:-|$)|codex(?:-|$)|claude[-.](?:opus|sonnet|haiku|\d)|minimax-m\d|glm[-.]?\d|gemini[-.]?\d|qwen\d|deepseek[-.]?(?:v\d|r\d|chat|reasoner)|kimi[-.]?(?:k\d|latest)|grok[-.]?\d|mistral[-.]|llama[-.]?\d)/i;
// Keys are stable upstream ids. The display name is registered as an alias as well,
// so re-normalizing a stored label returns the same label instead of "Unknown"
const PROVIDER_LABELS = {
  codex: 'Codex', 'minimax-cn': 'MiniMax', minimax: 'MiniMax', zhipu: 'GLM', glm: 'GLM',
  zcode: 'ZCode', gemini: 'Gemini', 'session-unknown': '本地会话',
  openai: 'OpenAI', anthropic: 'Anthropic', google: 'Google', deepseek: 'DeepSeek',
  qwen: 'Qwen', kimi: 'Kimi', moonshot: 'Moonshot', ollama: 'Ollama',
};
const providerNames = new Map();
for (const [id, label] of Object.entries(PROVIDER_LABELS)) {
  providerNames.set(id, label);
  providerNames.set(label.toLowerCase(), label);
}
// Agents are identified by a stable upstream id (claude, codex, gemini-cli...);
// the id is registered as its own alias so stored labels survive restarts.
// The list is every agent Magpie knows (its internal/agent registry), so an
// agent Magpie adds later is still shown, by its id, until this map grows.
const AGENT_LABELS = {
  agy: 'Antigravity CLI', aionui: 'AionUi', air: 'JetBrains Air', 'air-ide': 'Air (JetBrains IDEs)',
  alma: 'Alma', ante: 'Ante', antigravity: 'Antigravity', aside: 'Aside', astrbot: 'AstrBot',
  atomcode: 'AtomCode', cherrystudio: 'Cherry Studio', cindy: 'Cindy', claude: 'Claude Code',
  'claude-desktop': 'Claude Desktop', 'claude-science': 'Claude Science', cline: 'Cline',
  codebuddy: 'CodeBuddy', codex: 'Codex', commandcode: 'Command Code', copilot: 'Copilot CLI',
  'copilot-jetbrains': 'Copilot (JetBrains)', crush: 'Crush', curl: 'curl', cursor: 'Cursor CLI',
  'cursor-local': 'Cursor Private Inference', deveco: 'DevEco Code', devin: 'Devin', droid: 'Droid',
  'ds-bot': 'DS Bot', dsh: 'DeepSeek Harness', empryo: 'Empryo', fx: 'fx', gemini: 'Gemini CLI',
  'gemini-cli': 'Gemini CLI', goose: 'Goose', grok: 'Grok Build', 'grok-app': 'Grok App',
  hanako: 'OpenHanako', hermes: 'Hermes Agent', jcode: 'jcode', kimi: 'Kimi Code',
  'kimi-code-desktop': 'Kimi Code Desktop', kirocrew: 'Kiro Crew', liveagent: 'LiveAgent',
  lody: 'Lody', magpie: 'magpie', mimocode: 'MiMo Code', 'minimax-code': 'MiniMax Code',
  morph: 'Mister Morph', mothx: 'MothX', muse: 'Muse Code', newmax: 'NewMax', omo: 'OmO',
  omp: 'omp', openbot: 'OpenBot', openchamber: 'OpenChamber', openclaw: 'OpenClaw',
  opencode: 'OpenCode', openmausbot: 'OpenMausBot', openpencil: 'OpenPencil', pencil: 'Pencil',
  penguin: 'PenguinHarness', pi: 'Pi', 'pi-desktop': 'PI-Desktop', 'prime-agent': 'Prime Agent',
  qoder: 'Qoder', 'qoder-cn': 'Qoder CN', qwen: 'Qwen Code', qwenpaw: 'QwenPaw', raft: 'Raft',
  raycast: 'Raycast', reasonix: 'Reasonix Studio', snow: 'Snow CLI', stepcode: 'StepCode',
  t3code: 'T3 Code', vscode: 'VS Code', 'vscode-insiders': 'VS Code Insiders', vscodium: 'VSCodium',
  workbuddy: 'WorkBuddy', 'workbuddy-ai': 'WorkBuddy AI',
  zcode: 'ZCode', zed: 'Zed', 'zoo-code': 'Zoo Code',
  // Clients the gateway only knows by the User-Agent they send.
  aider: 'Aider', roo: 'Roo Code', windsurf: 'Windsurf',
  'python-urllib': 'Python', 'go-http-client': 'Go Client',
};
const agentNames = new Map();
for (const [id, label] of Object.entries(AGENT_LABELS)) {
  agentNames.set(id, label);
  agentNames.set(label.toLowerCase(), label);
}
function typedLabel(value, type, index) {
  if (typeof value !== 'string') return type === 'computer' ? 'Device ' + (index + 1) : 'Unknown';
  if (type === 'computer') return /^[a-z0-9][a-z0-9_-]{0,62}$/i.test(value) ? value : 'Device ' + (index + 1);
  if (type === 'provider') return providerNames.get(value.toLowerCase()) || 'Unknown';
  if (type === 'agent') {
    const known = agentNames.get(value.toLowerCase());
    if (known) return known;
    // An agent running in a WSL distro carries the distro after an "@"
    // (codex@wsl:Ubuntu-22.04); the agent itself is the part before it.
    const at = value.indexOf('@');
    if (at > 0) {
      const base = agentNames.get(value.slice(0, at).toLowerCase());
      if (base) return base;
    }
    return /^[a-z0-9][a-z0-9-_.]{0,39}$/i.test(value) ? value : 'Unknown';
  }
  // Accept model identifiers from known families; discard provider prefixes.
  if (value.length > 120 || /^(?:[a-z]:|[\/~.])/i.test(value) || value.includes('\\') || value.split('/').length > 2) return 'Unknown';
  const model = value.split('/').at(-1);
  return /^[a-z0-9][a-z0-9._-]{0,79}$/i.test(model) && modelFamily.test(model) ? model : 'Unknown';
}
// Upstream rows carry both a display name and a stable id. Providers and agents
// resolve by id; models resolve by name because upstream reuses one id per model string.
function labelSource(row, type) {
  if (type === 'provider' || type === 'agent') return row.id || row.name || row.model;
  return row.name || row.model || row.id;
}
export function metrics(raw = {}) {
  const inputTokens = number(raw.input), outputTokens = number(raw.output);
  const cacheReadTokens = number(raw.cache_read), cacheWriteTokens = number(raw.cache_write);
  const inputTotal = inputTokens + cacheReadTokens + cacheWriteTokens;
  const decodeMs = number(raw.decode_ms), decodeOut = number(raw.decode_out);
  const timed = number(raw.timed);
  return {
    requests: number(raw.calls), errors: number(raw.errors),
    inputTokens, outputTokens, cacheReadTokens, cacheWriteTokens,
    reasoningTokens: number(raw.reasoning),
    totalTokens: inputTotal + outputTokens,
    cacheHitPercent: inputTotal ? cacheReadTokens / inputTotal * 100 : null,
    // Cost is Magpie's own estimate at each model's effective prices; the
    // currency unit follows the Magpie price table and is not inferred here.
    cost: number(raw.cost), unpriced: number(raw.unpriced),
    // Streaming decode throughput and mean first-token latency over measured requests.
    outputTokensPerSecond: decodeMs ? Math.round(decodeOut / decodeMs * 1000 * 10) / 10 : null,
    ttftMs: timed ? Math.round(number(raw.ttft_ms) / timed) : null,
  };
}
// A subscription account is told apart by the identity Magpie reports for it.
// Only the part before the "@" is kept: it names the account on screen without
// carrying the address itself.
const accountName = value => {
  if (typeof value !== 'string') return null;
  const local = value.split('@')[0] || '';
  return /^[A-Za-z0-9._-]{1,32}$/.test(local) ? local : null;
};
// Magpie lets the user name an account of their own ("magpie accounts alias
// codex <email> <name>"). The name is the user's own text for it, so it may be
// shown, but only as a short plain label: no path, no address, no markup.
const aliasName = value => {
  if (typeof value !== 'string') return null;
  const name = value.trim();
  return /^[\p{L}\p{N}][\p{L}\p{N} ._*'-]{0,31}$/u.test(name) ? name : null;
};
export function normalizeQuotas(raw, cache = {}) {
  if (!raw || !Array.isArray(raw.data)) throw new Error('Invalid quota response');
  const counts = {};
  // How many cards a family has: one account keeps the plain name, several are
  // named after their own identity so they never swap places.
  const familySize = new Map();
  for (const card of raw.data) {
    const family = PROVIDERS[card?.provider]?.id;
    if (family) familySize.set(family, (familySize.get(family) || 0) + 1);
  }
  const taken = new Set();
  return raw.data.flatMap(card => {
    const provider = PROVIDERS[card?.provider];
    if (!provider || !Array.isArray(card.windows)) return [];
    const index = counts[provider.id] = (counts[provider.id] || 0) + 1;
    const account = accountName(card?.user ?? card?.account);
    const alias = aliasName(card?.alias);
    // A cached reading belongs to the account it was taken for, so two accounts
    // of one vendor never borrow each other's timestamp.
    const cached = Object.values(cache || {}).filter(item => item?.quota?.provider === card.provider &&
      (!account || accountName(item.quota.user) === account));
    const singleAccount = familySize.get(provider.id) === 1;
    const updatedAt = iso(card.readAt) ||
      (cached.length === 1 && (account || singleAccount) ? iso(cached[0].at) : null);
    // The account names its own card, but only where it is needed to tell two
    // accounts of one vendor apart: a vendor with a single account keeps its
    // plain name, and no identity leaves the machine for nothing. A name the
    // user gave the account in Magpie is theirs to show either way.
    const several = familySize.get(provider.id) > 1;
    const named = several && account;
    const base = named ? provider.id + '@' + account : provider.id + (index > 1 ? '-' + index : '');
    let id = base, attempt = 2;
    while (taken.has(id)) id = base + '-' + attempt++;
    taken.add(id);
    const shown = alias || (named ? account : null);
    return [{
      id,
      provider: provider.id,
      label: shown ? provider.label + ' · ' + shown : provider.label + (index > 1 ? ' ' + index : ''),
      account: named ? account : null,
      alias,
      plan: typeof card.plan === 'string' && plans.test(card.plan) ? card.plan : provider.plan, updatedAt,
      stale: card.stale === true,
      windows: card.windows.filter(window => window && typeof window === 'object').map(window => {
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
  }).sort((a, b) => {
    // Known families keep their canonical order; anything else sorts last instead of first.
    const ai = PROVIDER_ORDER.indexOf(a.provider), bi = PROVIDER_ORDER.indexOf(b.provider);
    return (ai < 0 ? PROVIDER_ORDER.length : ai) - (bi < 0 ? PROVIDER_ORDER.length : bi);
  });
}
// Select complete provider groups instead of guessing which anonymous API row
// belongs to a private cache key. All selected rows still cross the same allowlist.
// Accounts of one vendor are kept apart: a reading is only ever taken from the
// account it belongs to, so two Codex accounts never trade places.
export function resolveQuotas(raw, cache = {}, previous = []) {
  const group = rows => {
    const groups = new Map();
    for (const row of rows) {
      const provider = PROVIDERS[row?.provider]?.id;
      if (!provider) continue;
      const account = accountName(row?.user ?? row?.account) || '';
      const key = provider + '|' + account;
      groups.set(key, [...(groups.get(key) || []), row]);
    }
    return groups;
  };
  const usable = card => !card.error && Array.isArray(card.windows) && card.windows.length > 0 &&
    card.windows.every(window => window && typeof window === 'object') &&
    card.windows.some(window => typeof window.used === 'number' && Number.isFinite(window.used) && window.used >= 0);
  const complete = rows => rows.length > 0 && rows.every(usable);
  const api = group(Array.isArray(raw?.data) ? raw.data : []);
  const disk = group(Object.values(cache || {}).map(item => item?.quota && ({
    ...item.quota, readAt: iso(item.quota.readAt) || iso(item.at),
  })));
  const history = group(previous.map(card => ({
    ...card, provider: card.provider === 'glm' ? 'zhipu' : card.provider,
    readAt: card.updatedAt,
    windows: card.windows.map(window => ({ ...window, name: window.label, used: window.usedPercent })),
  })));
  const selected = [];
  for (const provider of PROVIDER_ORDER) {
    const prefix = provider + '|';
    const of = source => [...source.entries()].filter(([key]) => key.startsWith(prefix));
    const live = of(api), familyCached = of(disk).flatMap(([, rows]) => rows),
      familySaved = of(history).flatMap(([, rows]) => rows);
    if (!live.length) {
      // No live reading at all: the cached accounts are the ones on screen.
      const fallback = complete(familyCached) ? familyCached : complete(familySaved) ? familySaved : [];
      if (fallback.length) selected.push(...normalizeQuotas({ data: fallback }).map(card => ({ ...card, stale: true })));
      continue;
    }
    // The live answer names the accounts. Each account is recovered on its own:
    // a reading one account is missing never takes the other account's with it.
    const picks = [];
    for (const [key, accountLive] of live) {
      const named = key !== prefix;
      const cached = named ? (disk.get(key) || []) : familyCached;
      const saved = named ? (history.get(key) || []) : familySaved;
      picks.push(complete(accountLive) ? { rows: accountLive, stale: false }
        : complete(cached) ? { rows: cached, stale: true }
        : complete(saved) ? { rows: saved, stale: true }
        : { rows: accountLive.filter(usable), stale: true });
    }
    const rows = picks.flatMap(pick => pick.rows);
    const stale = picks.flatMap(pick => pick.rows.map(() => pick.stale));
    const cards = normalizeQuotas({ data: rows });
    selected.push(...cards.map((card, index) => (stale[index] ? { ...card, stale: true } : card)));
  }
  if (!selected.length) throw new Error('No usable quota readings');
  return selected;
}
const SUM_FIELDS = ['calls', 'errors', 'input', 'output', 'cache_read', 'cache_write', 'reasoning',
  'cost', 'unpriced', 'timed', 'ttft_ms', 'decode_ms', 'decode_out', 'decode_n'];
// Internal ceiling; the effective number of rows is chosen by the display configuration.
const RANKING_CAP = 50;
// The grouping key of a model row. Rows whose name does not pass the label rules
// are never merged, so they keep their own line.
export function modelKey(value) {
  const label = typedLabel(value, 'model', 0);
  return label === 'Unknown' ? null : label.toLowerCase();
}
// Upstream can report one model several times: with a provider prefix, with a
// different case, or under another account. Merge those rows into one line.
function mergeModels(rows) {
  const groups = new Map();
  for (const [index, row] of rows.entries()) {
    const source = labelSource(row, 'model');
    const label = typedLabel(source, 'model', index);
    const key = modelKey(source) ?? 'unknown:' + index;
    const tokens = metrics(row).totalTokens;
    const group = groups.get(key);
    if (!group) { groups.set(key, { label, tokens, row: { ...row } }); continue; }
    if (tokens > group.tokens) { group.label = label; group.tokens = tokens; }
    for (const field of SUM_FIELDS) group.row[field] = number(group.row[field]) + number(row[field]);
  }
  return [...groups.values()];
}
function ranking(rows, type) {
  const list = Array.isArray(rows) ? rows : [];
  const entries = type === 'model'
    ? mergeModels(list).map(group => ({ label: group.label, row: group.row }))
    : list.map((row, i) => ({ label: typedLabel(labelSource(row, type), type, i), row }));
  return entries.map((entry, i) => ({
    id: type + '-' + (i + 1), label: entry.label, ...metrics(entry.row),
  })).sort((a, b) => b.totalTokens - a.totalTokens).map((entry, i) => ({ ...entry, id: type + '-' + (i + 1) }))
    .slice(0, RANKING_CAP);
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
    agents: ranking(raw.by?.agent, 'agent'),
    computers: ranking(raw.computers, 'computer'),
  };
}
export function sanitizeCachedLabels(data, key) {
  if (key === 'quotas') return normalizeQuotas({ data: data.map(card => ({
    provider: card.provider === 'glm' ? 'zhipu' : card.provider, plan: card.plan, readAt: card.updatedAt, stale: card.stale === true,
    account: card.account,
    alias: card.alias,
    windows: card.windows.map(window => ({ ...window, name: window.label, used: window.usedPercent })),
  })) });
  const cleanRows = (rows, type) => (rows || []).map((row, index) => ({ ...row, label: typedLabel(row.label, type, index) }));
  return { ...data,
    trend: data.trend.map((row, index) => ({ ...row, label: iso(row.at) ? shanghaiDay(Date.parse(row.at)) : 'Day ' + (index + 1) })),
    models: cleanRows(data.models, 'model'), providers: cleanRows(data.providers, 'provider'),
    agents: cleanRows(data.agents, 'agent'), computers: cleanRows(data.computers, 'computer'),
  };
}
export const shanghaiDay = value => new Date(value + 8 * 3600_000).toISOString().slice(0, 10);
// Display choices live in the PC-side configuration; the phone and the dashboard
// only render what the service projects.
export const DEFAULT_DISPLAY = {
  modelLimit: 8, agentLimit: 6, providerLimit: 20, computerLimit: 20, subscriptions: ['codex', 'minimax', 'glm'],
};
// A subscription is a vendor family (codex) or one of its accounts
// (codex@fangzt98). The family's case does not matter; the account's does.
const splitSubscription = id => {
  const at = typeof id === 'string' ? id.indexOf('@') : -1;
  const family = (at < 0 ? String(id) : id.slice(0, at)).toLowerCase();
  const account = at < 0 ? '' : id.slice(at + 1);
  return { family, account };
};
const subscriptionId = id => {
  const { family, account } = splitSubscription(id);
  return family + (account ? '@' + account : '');
};
const SUBSCRIPTION_ID = /^[a-z][a-z0-9-]{0,19}$/;
const SUBSCRIPTION_ACCOUNT = /^[A-Za-z0-9._-]{1,32}$/;
export function displayOptions(value = {}) {
  const limit = (input, fallback) => {
    if (input === null || input === undefined || input === '') return fallback;
    const parsed = Number(input);
    if (!Number.isFinite(parsed)) return fallback;
    return Math.max(1, Math.min(20, Math.round(parsed)));
  };
  const requested = Array.isArray(value.subscriptions) ? value.subscriptions : [];
  const subscriptions = requested.filter(id => {
    if (typeof id !== 'string') return false;
    if (id === '*') return true;
    const { family, account } = splitSubscription(id);
    return SUBSCRIPTION_ID.test(family) && (!account || SUBSCRIPTION_ACCOUNT.test(account));
  }).map(subscriptionId);
  return {
    modelLimit: limit(value.modelLimit, DEFAULT_DISPLAY.modelLimit),
    agentLimit: limit(value.agentLimit, DEFAULT_DISPLAY.agentLimit),
    providerLimit: limit(value.providerLimit, DEFAULT_DISPLAY.providerLimit),
    computerLimit: limit(value.computerLimit, DEFAULT_DISPLAY.computerLimit),
    subscriptions: subscriptions.length ? subscriptions : [...DEFAULT_DISPLAY.subscriptions],
  };
}
// Command line overrides for the configuration script. An empty value never
// replaces a saved choice; it is ignored so a typo cannot silently reset it.
export function displayOverrides(argv = []) {
  const flags = new Map();
  for (let index = 2; index < argv.length; index += 2) {
    const key = String(argv[index] || '').replace(/^--/, '');
    if (key) flags.set(key, argv[index + 1]);
  }
  const overrides = {};
  for (const [flag, key] of [['model-limit', 'modelLimit'], ['agent-limit', 'agentLimit'], ['provider-limit', 'providerLimit'], ['computer-limit', 'computerLimit']]) {
    if (!flags.has(flag)) continue;
    const value = Number(flags.get(flag));
    if (Number.isFinite(value)) overrides[key] = value;
  }
  if (flags.has('subscriptions')) {
    const requested = String(flags.get('subscriptions')).split(',').map(item => item.trim()).filter(Boolean);
    if (requested.length) overrides.subscriptions = requested;
  }
  return overrides;
}
export function project(snapshot, now = Date.now(), display = {}) {
  const options = displayOptions(display);
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
    stale: card.stale === true || sources.quotas.state !== 'ok' || !!card.updatedAt && now - Date.parse(card.updatedAt) > 900_000,
    windows: card.windows.map(window => ({ ...window,
      expired: !!window.resetsAt && Date.parse(window.resetsAt) <= now,
    })),
  }));
  const showAll = options.subscriptions.includes('*');
  // Without an explicit list the canonical family order is used; a provider that
  // is not listed sorts last instead of first.
  const order = showAll ? PROVIDER_ORDER : options.subscriptions;
  // A card is ranked by the first entry that names it: its family, or the one
  // account of that family the list picked.
  const rank = card => {
    const index = order.findIndex(entry => entry === card.provider || entry === card.id);
    return index < 0 ? order.length : index;
  };
  const shown = subscriptions
    .filter(card => showAll || options.subscriptions.includes(card.provider) || options.subscriptions.includes(card.id))
    .sort((a, b) => rank(a) - rank(b));
  const week = snapshot.parts.week?.data;
  return {
    schemaVersion: 1, generatedAt: new Date(now).toISOString(), timezone: 'Asia/Shanghai', sources,
    display: options,
    subscriptions: shown,
    usage: { today: outdated ? null : snapshot.parts.today?.data.metrics || null, week: week?.metrics || null },
    trend: week?.trend || [],
    rankings: {
      models: (week?.models || []).slice(0, options.modelLimit),
      agents: (week?.agents || []).slice(0, options.agentLimit),
      providers: (week?.providers || []).slice(0, options.providerLimit),
      computers: (week?.computers || []).slice(0, options.computerLimit),
    },
  };
}
