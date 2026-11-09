import { mkdir, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { render, fixed, positioned } from '../fixtures/scriptable.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
function subscriptions(count, mixed = false) {
  return ['Codex · Work', 'Codex · second', 'MiniMax', 'GLM', 'MiniMax 2', 'GLM 2'].slice(0, count).map((label, index) => {
    const remaining = [85, 100, 98, 97, 72, 64][index];
    const minutes = [229, 229, 182, 266, 58, 320][index];
    return { id: 'demo-' + index, provider: 'codex', label, stale: false, windows: [
      { label: mixed && index % 2 ? '7 days' : '5 hours', remainingPercent: remaining, usedPercent: 100 - remaining,
        resetsAt: new Date(fixed + minutes * 60000).toISOString() },
      { label: '7 days', remainingPercent: 79 - index * 3, usedPercent: 21 + index * 3, resetsAt: new Date(fixed + 86400000).toISOString() },
    ] };
  });
}
const cases = [
  { title: '中号 · 四个订阅 · 截图尺寸', family: 'medium', count: 4 },
  { title: '中号 · 四个订阅 · 窄屏', family: 'medium', count: 4, screen: { width: 320, height: 568 } },
  { title: '中号 · 五个订阅', family: 'medium', count: 5 },
  { title: '中号 · 六个订阅', family: 'medium', count: 6 },
  { title: '大号 · 四个订阅', family: 'large', count: 4 },
  { title: '大号 · 六个订阅', family: 'large', count: 6 },
  { title: '中号 · 四个订阅 · 宽屏', family: 'medium', count: 4, screen: { width: 430, height: 932 } },
  { title: '中号 · 不同额度窗口 · 深色', family: 'medium', count: 4, mixed: true, dark: true },
];
const panels = [];
for (const example of cases) {
  const result = await render(example.family, { ...example, subscriptions: subscriptions(example.count, example.mixed), todayTokens: 21570000 });
  panels.push({ title: example.title, dimensions: result.dimensions, background: result.widget.backgroundColor.value,
    items: positioned(result.widget, result.dimensions).filter(item => item.node.kind === 'text' || item.node.kind === 'image') });
}
await mkdir(path.join(root, '.preview'), { recursive: true });
const model = path.join(root, '.preview/widget-layout.json');
await writeFile(model, JSON.stringify(panels), 'utf8');
execFileSync('python', [path.join(root, 'scripts/render-widget-preview.py'), model, path.join(root, 'docs/preview-widgets.png')], { stdio: 'inherit' });
