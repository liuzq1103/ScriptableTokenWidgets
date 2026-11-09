import test from 'node:test';
import assert from 'node:assert/strict';
import { metrics, normalizeQuotas, resolveQuotas, normalizeUsage, project, displayOptions, displayOverrides, sanitizeCachedLabels } from '../backend/normalize.mjs';
import { makeRawUsage, makeQuotaResponse, makeAccountsQuotaResponse } from '../fixtures/demo.mjs';
const now = Date.parse('2026-06-12T04:00:00Z');
const sample = tokens => ({ calls: 1, errors: 0, input: tokens, output: 0, cache_read: 0, cache_write: 0, reasoning: 0 });
test('cache is added once; reasoning is not added to output again', () => {
  const data = metrics({ calls: 3, input: 10, output: 20, cache_read: 30, cache_write: 40, reasoning: 15 });
  assert.equal(data.totalTokens, 100); assert.equal(data.reasoningTokens, 15);
  assert.equal(data.cacheHitPercent, 37.5);
  assert.equal(metrics({}).cacheHitPercent, null);
});
test('used percentage becomes remaining; missing is unknown, zero is valid, overflow clamps', () => {
  const raw = makeQuotaResponse(now);
  raw.data[0].windows = [{ used: 0 }, { used: 150 }, {}, { used: -1 }];
  const windows = normalizeQuotas(raw)[0].windows;
  assert.deepEqual(windows.map(w => w.remainingPercent), [100, 0, null, null]);
});
test('inactive provider, identities, paths, prompts and credential fields never cross the boundary', () => {
  const raw = makeQuotaResponse(now);
  raw.data.push({ provider: 'zcode', user: 'old@example.invalid', windows: [] });
  raw.data[0].user = 'owner@example.invalid'; raw.data[0].token = 'PRIVATE_CREDENTIAL';
  const quotas = normalizeQuotas(raw);
  assert.equal(quotas.length, 3);
  const usage = makeRawUsage('7d', now);
  usage.rows = [{ prompt: 'PRIVATE_PROMPT', account: 'PRIVATE_ACCOUNT' }];
  usage.path = 'PRIVATE_PATH'; usage.callerKeys = [{ token: 'PRIVATE_CREDENTIAL' }];
  const result = JSON.stringify({ quotas, usage: normalizeUsage(usage) });
  for (const marker of ['PRIVATE_', 'example.invalid', 'zcode', 'callerKeys', '"rows"']) assert.ok(!result.includes(marker));
});
test('invalid upstream statistics are rejected, not silently turned into zero', () => {
  assert.throws(() => normalizeUsage({ error: 'not ready' }));
  assert.throws(() => normalizeQuotas({ data: null }));
});
test('expired windows retain historical percentages but explicitly require an update', () => {
  const quotas = normalizeQuotas(makeQuotaResponse(now));
  const snapshot = { failures: {}, parts: { quotas: { observedAt: new Date(now).toISOString(), data: quotas } } };
  const result = project(snapshot, now + 6 * 3600000);
  assert.equal(result.subscriptions[0].windows[0].expired, true);
  assert.equal(result.subscriptions[0].windows[0].remainingPercent, 59);
  assert.equal(result.sources.quotas.state, 'stale');
  assert.equal(result.usage.today, null);
});
test('quota reading timestamps come from the quota cache when the API omits them', () => {
  const raw = makeQuotaResponse(now); delete raw.data[1].readAt;
  const result = normalizeQuotas(raw, { privateIdentity: { at: new Date(now).toISOString(), quota: { provider: 'minimax-cn' } } });
  assert.equal(result[1].updatedAt, new Date(now).toISOString());
  assert.ok(!JSON.stringify(result).includes('privateIdentity'));
});

test('multi-account quota fallback replaces the entire provider group without mixing accounts or sources', () => {
  const codex = makeQuotaResponse(now).data[0];
  const cache = {
    PRIVATE_ACCOUNT_A: { at: new Date(now - 60000).toISOString(), quota: { ...codex, readAt: null, windows: [{ name: '5 hours', used: 10 }] } },
    PRIVATE_ACCOUNT_B: { at: new Date(now - 120000).toISOString(), quota: { ...codex, readAt: null, windows: [{ name: '5 hours', used: 80 }] } },
  };
  const incomplete = { data: [codex, { provider: 'codex', error: 'PRIVATE_ERROR', windows: [] }] };
  const fallback = resolveQuotas(incomplete, cache);
  assert.deepEqual(fallback.map(card => card.id), ['codex', 'codex-2']);
  assert.deepEqual(fallback.map(card => card.windows[0].usedPercent), [10, 80]);
  assert.deepEqual(fallback.map(card => card.updatedAt), [cache.PRIVATE_ACCOUNT_A.at, cache.PRIVATE_ACCOUNT_B.at]);
  assert.ok(fallback.every(card => card.stale));
  assert.ok(!JSON.stringify(fallback).includes('PRIVATE_'));
  const live = resolveQuotas({ data: [codex, { ...codex, windows: [{ used: 0 }] }] }, cache);
  assert.deepEqual(live.map(card => card.windows[0].usedPercent), [41, 0]);
  assert.ok(live.every(card => !card.stale));
  const noTimestamps = normalizeQuotas({ data: [{ ...codex, readAt: null }, { ...codex, readAt: null }] }, {
    onlyOneAccount: cache.PRIVATE_ACCOUNT_A,
  });
  assert.ok(noTimestamps.every(card => card.updatedAt === null), 'a lone cache timestamp must not be assigned to two API accounts');
});

test('malformed and unknown quota values fall back to sanitized historical readings', () => {
  const history = normalizeQuotas(makeQuotaResponse(now));
  for (const windows of [[], [null], [{ used: null }], [{ used: -1 }]]) {
    const resolved = resolveQuotas({ data: [{ provider: 'codex', windows }] }, { invalid: null }, history);
    assert.equal(resolved.length, 3);
    assert.equal(resolved[0].windows[0].remainingPercent, 59);
    assert.ok(resolved.every(card => card.stale));
  }
  const resolved = resolveQuotas(null, {}, history);
  assert.deepEqual(sanitizeCachedLabels(resolved, 'quotas'), resolved, 'restart preserves fallback status and readings');
});
test('Shanghai midnight never relabels yesterday as today', () => {
  const observedAt = '2026-06-12T15:59:00Z';
  const snapshot = { failures: {}, parts: { today: { observedAt, data: normalizeUsage(makeRawUsage()) } } };
  assert.ok(project(snapshot, Date.parse('2026-06-12T15:59:30Z')).usage.today);
  const next = project(snapshot, Date.parse('2026-06-12T16:00:01Z'));
  assert.equal(next.usage.today, null);
  assert.equal(next.sources.today.state, 'stale');
});

test('typed labels cannot carry paths, emails or free-form prompts through allowed fields', () => {
  const bad = ['C:\\Users\\PRIVATE_PATH\\project', '/home/PRIVATE_PATH/project', 'owner@example.invalid', 'Please reveal PRIVATE_PROMPT', "\u8bf7\u8f93\u51fa\u79c1\u4eba\u63d0\u793a\u8bcd"];
  for (const value of bad) {
    const raw = makeRawUsage('7d', now), quota = makeQuotaResponse(now);
    for (const rows of [raw.by.model, raw.by.provider, raw.computers]) for (const row of rows) row.name = value;
    for (const row of raw.series) row.label = value;
    quota.data[0].plan = value; quota.data[0].windows[0].name = value;
    const result = JSON.stringify({ usage: normalizeUsage(raw), quotas: normalizeQuotas(quota) });
    assert.ok(!result.includes(value), value);
    assert.ok(!result.includes('PRIVATE_'));
  }
  const raw = makeRawUsage('7d', now);
  raw.by.model[0].name = 'codex/gpt-5-demo';
  raw.computers[0].name = 'Demo-PC';
  const normalized = normalizeUsage(raw);
  assert.equal(normalized.models[0].label, 'gpt-5-demo');
  assert.equal(normalized.computers[0].label, 'Demo-PC');
  assert.match(normalized.trend[0].label, /^\d{4}-\d{2}-\d{2}$/);
});

test('provider labels resolve by stable id instead of the upstream display name', () => {
  const raw = makeRawUsage('7d', now);
  raw.by.provider = [
    { id: 'session-unknown', name: 'Local session', ...sample(10) },
    { id: 'minimax-cn', name: 'MiniMax (China)', ...sample(20) },
    { id: 'zhipu', name: 'Zhipu GLM', ...sample(30) },
    { id: 'zcode', name: 'ZCode', ...sample(5) },
    { id: 'mystery-vendor', name: 'Mystery Corp', ...sample(1) },
  ];
  const providers = normalizeUsage(raw).providers;
  assert.deepEqual(providers.map(p => p.label), ['GLM', 'MiniMax', '本地会话', 'ZCode', 'Unknown']);
  // The upstream display name never reaches the client.
  assert.ok(!JSON.stringify(providers).includes('Mystery Corp'));
  assert.ok(!JSON.stringify(providers).includes('Local session'));
});

test('one model reported under a prefix or another casing becomes a single line', () => {
  const raw = makeRawUsage('7d', now);
  raw.by.model = [
    { name: 'glm-5.3', ...sample(100) },
    { name: 'GLM-5.3', ...sample(20) },
    { name: 'zhipu/glm-5.3', ...sample(5) },
    { name: 'gpt-6.1-sol', ...sample(50) },
  ];
  const models = normalizeUsage(raw).models;
  assert.equal(models.length, 2);
  assert.equal(models[0].label, 'glm-5.3');
  assert.equal(models[0].totalTokens, 125);
  assert.equal(models[0].requests, 3);
  assert.equal(models[1].label, 'gpt-6.1-sol');
});

test('the display configuration chooses how many rows are shown', () => {
  const raw = makeRawUsage('7d', now);
  raw.by.model = Array.from({ length: 12 }, (_, i) => ({ name: 'gpt-5-demo-' + i, ...sample(i + 1) }));
  const snapshot = { failures: {}, parts: { week: { observedAt: new Date(now).toISOString(), data: normalizeUsage(raw) } } };
  const limited = project(snapshot, now, { modelLimit: 3 });
  assert.equal(limited.rankings.models.length, 3);
  assert.equal(limited.display.modelLimit, 3);
  assert.equal(limited.rankings.models[0].label, 'gpt-5-demo-11');
});

test('the display configuration selects and orders the subscriptions the phone shows', () => {
  const snapshot = { failures: {}, parts: { quotas: { observedAt: new Date(now).toISOString(), data: normalizeQuotas(makeQuotaResponse(now)) } } };
  assert.deepEqual(project(snapshot, now).subscriptions.map(card => card.provider), ['codex', 'minimax', 'glm']);
  assert.deepEqual(project(snapshot, now, { subscriptions: ['glm', 'codex'] }).subscriptions.map(card => card.provider), ['glm', 'codex']);
  assert.deepEqual(project(snapshot, now, { subscriptions: ['minimax'] }).subscriptions.map(card => card.provider), ['minimax']);
  // A wildcard keeps the canonical family order instead of sorting the others first.
  assert.deepEqual(project(snapshot, now, { subscriptions: ['*'] }).subscriptions.map(card => card.provider), ['codex', 'minimax', 'glm']);
  assert.deepEqual(project(snapshot, now, { subscriptions: ['*', 'glm'] }).subscriptions.map(card => card.provider), ['codex', 'minimax', 'glm']);
});

test('display options are clamped and never carry unsafe identifiers', () => {
  assert.equal(displayOptions({ modelLimit: 999 }).modelLimit, 20);
  assert.equal(displayOptions({ modelLimit: 0 }).modelLimit, 1);
  assert.equal(displayOptions({ modelLimit: 'many' }).modelLimit, 8);
  assert.equal(displayOptions({ modelLimit: null }).modelLimit, 8);
  assert.equal(displayOptions({ modelLimit: '' }).modelLimit, 8);
  assert.deepEqual(displayOptions({ subscriptions: ['codex', '../../etc', 'MiniMax'] }).subscriptions, ['codex', 'minimax']);
  assert.deepEqual(displayOptions({}).subscriptions, ['codex', 'minimax', 'glm']);
});

test('a stored label survives the cache clean-up unchanged', () => {
  const raw = makeRawUsage('7d', now);
  raw.by.provider = [
    { id: 'session-unknown', name: 'Local session', ...sample(10) },
    { id: 'minimax-cn', name: 'MiniMax (China)', ...sample(20) },
    { id: 'zcode', name: 'ZCode', ...sample(5) },
  ];
  const usage = normalizeUsage(raw);
  const cleaned = sanitizeCachedLabels(usage, 'week');
  assert.deepEqual(cleaned.providers.map(p => p.label), usage.providers.map(p => p.label));
  assert.ok(cleaned.providers.some(p => p.label === '本地会话'));
  assert.ok(cleaned.providers.some(p => p.label === 'ZCode'));
});

test('an empty command line value never replaces a saved display choice', () => {
  assert.deepEqual(displayOverrides(['node', 'configure.mjs', '--subscriptions', '']), {});
  assert.deepEqual(displayOverrides(['node', 'configure.mjs', '--subscriptions', 'codex,glm']), { subscriptions: ['codex', 'glm'] });
  assert.deepEqual(displayOverrides(['node', 'configure.mjs', '--model-limit', '12']), { modelLimit: 12 });
  assert.deepEqual(displayOverrides(['node', 'configure.mjs', '--model-limit', 'many']), {});
  const saved = { subscriptions: ['glm'], modelLimit: 4 };
  assert.deepEqual(displayOptions({ ...saved, ...displayOverrides(['node', 'configure.mjs', '--subscriptions', '']) }).subscriptions, ['glm']);
});

test('the documented cache hit rate uses input plus both cache directions', () => {
  const data = metrics({ calls: 1, input: 10, output: 5, cache_read: 30, cache_write: 60, reasoning: 0 });
  assert.equal(data.totalTokens, 105);
  assert.equal(data.cacheHitPercent, 30);
  assert.equal(metrics({ cache_read: 30 }).cacheHitPercent, 100);
  assert.equal(metrics({ input: 5 }).cacheHitPercent, 0);
  assert.equal(metrics({}).cacheHitPercent, null);
});

test('cost, unpriced and measured speed join the metrics', () => {
  const data = metrics({ calls: 2, input: 10, output: 5, cache_read: 30, cache_write: 0,
    cost: 1.234, unpriced: 3, timed: 10, ttft_ms: 15000, decode_ms: 2000, decode_out: 90, decode_n: 5 });
  assert.equal(data.cost, 1.234);
  assert.equal(data.unpriced, 3);
  assert.equal(data.outputTokensPerSecond, 45);
  assert.equal(data.ttftMs, 1500);
  assert.equal(metrics({}).outputTokensPerSecond, null);
  assert.equal(metrics({}).cost, 0);
});
test('agent ranking labels resolve by id; free text and icons never pass through', () => {
  const raw = makeRawUsage('7d', now);
  raw.by.agent = [
    { id: 'claude', name: 'FREE TEXT NAME', calls: 2, input: 30, output: 0, cache_read: 0, cache_write: 0, reasoning: 0, icon: 'claudecode-color' },
    { id: 'python-urllib', name: 'Python-urllib', calls: 1, input: 10, output: 0, cache_read: 0, cache_write: 0, reasoning: 0 },
    { id: 'unknown-agent-7', name: 'PRIVATE_PROMPT', calls: 1, input: 5, output: 0, cache_read: 0, cache_write: 0, reasoning: 0 },
    { id: 'evil path', name: 'x', calls: 1, input: 1, output: 0, cache_read: 0, cache_write: 0, reasoning: 0 },
  ];
  const agents = normalizeUsage(raw).agents;
  assert.deepEqual(agents.map(a => a.label), ['Claude Code', 'Python', 'unknown-agent-7', 'Unknown']);
  const text = JSON.stringify(agents);
  assert.ok(!text.includes('FREE TEXT NAME'));
  assert.ok(!text.includes('icon'));
  assert.ok(!text.includes('PRIVATE_PROMPT'));
});
test('every agent Magpie knows is shown by its own name', () => {
  const known = {
    claude: 'Claude Code', codex: 'Codex', gemini: 'Gemini CLI', opencode: 'OpenCode',
    mimocode: 'MiMo Code', deveco: 'DevEco Code', pi: 'Pi', goose: 'Goose', cursor: 'Cursor CLI',
    copilot: 'Copilot CLI', vscode: 'VS Code', crush: 'Crush', dsh: 'DeepSeek Harness',
    commandcode: 'Command Code', fx: 'fx', omp: 'omp', omo: 'OmO', devin: 'Devin',
    hermes: 'Hermes Agent', morph: 'Mister Morph', kimi: 'Kimi Code', muse: 'Muse Code',
    empryo: 'Empryo', 'minimax-code': 'MiniMax Code', droid: 'Droid', grok: 'Grok Build',
    zcode: 'ZCode', hanako: 'OpenHanako', atomcode: 'AtomCode', snow: 'Snow CLI', qwenpaw: 'QwenPaw',
    'claude-desktop': 'Claude Desktop', 'vscode-insiders': 'VS Code Insiders', vscodium: 'VSCodium',
    'prime-agent': 'Prime Agent', 'qoder-cn': 'Qoder CN', 'workbuddy-ai': 'WorkBuddy AI',
    'grok-app': 'Grok App', 'zoo-code': 'Zoo Code', 'copilot-jetbrains': 'Copilot (JetBrains)',
  };
  const raw = makeRawUsage('7d', now);
  raw.by.agent = Object.keys(known).map((id, index) => ({ id, name: 'FREE TEXT', ...sample(100 - index) }));
  const labels = new Set(normalizeUsage(raw).agents.map(agent => agent.label));
  for (const [id, label] of Object.entries(known)) assert.ok(labels.has(label), id + ' should be shown as ' + label);
  const text = JSON.stringify(normalizeUsage(raw).agents);
  assert.ok(!text.includes('FREE TEXT'));
});
test('an agent running in a WSL distro keeps the name of the agent itself', () => {
  const raw = makeRawUsage('7d', now);
  raw.by.agent = [
    { id: 'codex@wsl:Ubuntu-22.04', name: 'Codex · WSL Ubuntu-22.04', ...sample(10) },
    { id: 'claude', name: 'Claude Code', ...sample(20) },
  ];
  assert.deepEqual(normalizeUsage(raw).agents.map(agent => agent.label), ['Claude Code', 'Codex']);
});
test('two accounts of one vendor are told apart by their own identity', () => {
  const raw = makeAccountsQuotaResponse(now);
  const cards = normalizeQuotas(raw);
  const codex = cards.filter(card => card.provider === 'codex');
  assert.deepEqual(codex.map(card => card.id), ['codex@first', 'codex@second']);
  assert.deepEqual(codex.map(card => card.label), ['Codex · Work', 'Codex · second']);
  assert.deepEqual(codex.map(card => card.account), ['first', 'second']);
  // The name the user gave the account in Magpie is kept beside it.
  assert.deepEqual(codex.map(card => card.alias), ['Work', null]);
  // The address never leaves the machine; only the part that names the account does.
  assert.ok(!JSON.stringify(cards).includes('example.invalid'));
  // A vendor with a single account keeps its plain name.
  assert.deepEqual(cards.filter(card => card.provider === 'glm').map(card => card.label), ['GLM']);
  // The order of the upstream rows does not decide which account is which.
  const flipped = normalizeQuotas({ data: [...raw.data].reverse() });
  assert.deepEqual(flipped.map(card => card.id).sort(), cards.map(card => card.id).sort());
  assert.deepEqual(flipped.map(card => card.label).sort(), cards.map(card => card.label).sort());
});
test('a broken account is recovered on its own and never borrows the other one', () => {
  const raw = makeAccountsQuotaResponse(now);
  const broken = { ...raw.data[1], windows: [], error: 'boom' };
  const cached = { at: new Date(now - 60000).toISOString(), quota: { ...raw.data[1], readAt: null, windows: [{ name: '5 hours', used: 55 }] } };
  const resolved = resolveQuotas({ data: [raw.data[0], broken] }, { secondary: cached });
  assert.deepEqual(resolved.map(card => card.id), ['codex@first', 'codex@second']);
  assert.deepEqual(resolved.map(card => card.windows[0].usedPercent), [41, 55]);
  assert.deepEqual(resolved.map(card => card.stale), [false, true]);
  assert.equal(resolved[1].updatedAt, cached.at);
  // A single account of the family keeps the plain id and reads on its own.
  const alone = resolveQuotas({ data: [raw.data[0]] }, {});
  assert.deepEqual(alone.map(card => card.id), ['codex']);
  assert.deepEqual(alone.map(card => card.label), ['Codex · Work']);
});
test('the name the user gave an account is shown, and only a plain one is', () => {
  const raw = makeQuotaResponse(now);
  raw.data[0].alias = '工作账号';
  const named = normalizeQuotas(raw);
  assert.equal(named[0].label, 'Codex · 工作账号');
  assert.equal(named[0].id, 'codex');
  assert.equal(named[0].alias, '工作账号');
  // The account's own address is still not part of the card.
  assert.equal(named[0].account, null);
  for (const alias of ['C:\\Users\\PRIVATE_PATH', 'a@b', '<script>', '', '  ', 'x'.repeat(40)]) {
    raw.data[0].alias = alias;
    const card = normalizeQuotas(raw)[0];
    assert.equal(card.alias, null, alias);
    assert.equal(card.label, 'Codex', alias);
  }
});
test('the display configuration can pick one account of a vendor', () => {
  const snapshot = { failures: {}, parts: { quotas: { observedAt: new Date(now).toISOString(), data: normalizeQuotas(makeAccountsQuotaResponse(now)) } } };
  assert.deepEqual(displayOptions({ subscriptions: ['codex@second'] }).subscriptions, ['codex@second']);
  assert.deepEqual(project(snapshot, now, { subscriptions: ['codex@second'] }).subscriptions.map(card => card.id), ['codex@second']);
  // The vendor name still shows the whole family.
  assert.deepEqual(project(snapshot, now, { subscriptions: ['codex'] }).subscriptions.map(card => card.id), ['codex@first', 'codex@second']);
  // An account that is not a name never reaches the client.
  assert.deepEqual(displayOptions({ subscriptions: ['codex@../../etc'] }).subscriptions, ['codex', 'minimax', 'glm']);
});
test('agent rows from an older snapshot keep labels; missing rows stay empty', () => {
  const raw = makeRawUsage('7d', now);
  raw.by.agent = [{ id: 'claude', name: 'Claude Code', ...sample(10) }];
  const cleaned = sanitizeCachedLabels(normalizeUsage(raw), 'week');
  assert.equal(cleaned.agents[0].label, 'Claude Code');
  const older = sanitizeCachedLabels({ ...normalizeUsage(raw), agents: undefined }, 'week');
  assert.deepEqual(older.agents, []);
});
test('the display configuration limits agent rows like the other rankings', () => {
  assert.equal(displayOptions({ agentLimit: 999 }).agentLimit, 20);
  assert.equal(displayOptions({}).agentLimit, 6);
  assert.deepEqual(displayOverrides(['node', 'configure.mjs', '--agent-limit', '4']), { agentLimit: 4 });
  const snapshot = { failures: {}, parts: { week: { observedAt: new Date(now).toISOString(), data: normalizeUsage(makeRawUsage('7d', now)) } } };
  assert.equal(project(snapshot, now, { agentLimit: 2 }).rankings.agents.length, 2);
  assert.equal(project(snapshot, now).rankings.agents[0].label, 'Claude Code');
});
