// Entirely fictional fixtures; no private runtime records.
import { normalizeQuotas, normalizeUsage, project } from '../backend/normalize.mjs';
export function makeRawUsage(period = 'today', now = Date.now()) {
  const values = [18_400_000, 23_800_000, 11_400_000, 30_600_000, 22_100_000, 16_800_000, 8_720_000];
  const midnight = Math.floor((now + 8 * 3600_000) / 86400_000) * 86400_000 - 8 * 3600_000;
  const total = period === 'today' ? values.at(-1) : values.reduce((a, b) => a + b, 0);
  const sample = tokens => ({ calls: 432, errors: 2, input: tokens * .16, output: tokens * .04, cache_read: tokens * .8, cache_write: 0, reasoning: 18000 });
  return {
    ...sample(total),
    series: values.map((tokens, i) => ({ ...sample(tokens), time: new Date(midnight - (6 - i) * 86400_000).toISOString(), label: 'Day ' + (i + 1) })),
    by: {
      model: [['gpt-5-demo', .47], ['MiniMax-M3-demo', .32], ['glm-5-demo', .21]].map(([name, share]) => ({ name, ...sample(total * share) })),
      provider: [['Codex', .47], ['MiniMax', .32], ['GLM', .21]].map(([name, share]) => ({ name, ...sample(total * share) })),
    },
    computers: [['Demo-PC', .64], ['Demo-Server', .36]].map(([name, share]) => ({ name, ...sample(total * share) })),
  };
}
export function makeQuotaResponse(now = Date.now()) {
  const at = delta => new Date(now + delta).toISOString();
  return { data: [
    { provider: 'codex', plan: 'Plus', readAt: at(0), windows: [{ name: '5 hours', used: 41, resetsAt: at(155 * 60000) }, { name: '7 days', used: 16, resetsAt: at(5 * 86400000) }] },
    { provider: 'minimax-cn', plan: 'Coding Plan', readAt: at(0), windows: [{ name: '5 hours', used: 76, resetsAt: at(47 * 60000) }] },
    { provider: 'zhipu', plan: 'Max', readAt: at(0), windows: [{ name: '5 hours', used: 24, resetsAt: at(94 * 60000) }, { name: '7 days', used: 33, resetsAt: at(3 * 86400000) }] },
  ] };
}
export function makeDemo(now = Date.now()) {
  const observedAt = new Date(now).toISOString();
  return { ...project({ failures: {}, parts: {
    quotas: { observedAt, data: normalizeQuotas(makeQuotaResponse(now)) },
    today: { observedAt, data: normalizeUsage(makeRawUsage('today', now)) },
    week: { observedAt, data: normalizeUsage(makeRawUsage('7d', now)) },
  } }, now), demo: true };
}
