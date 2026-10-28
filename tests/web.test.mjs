import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import { makeDemo } from '../fixtures/demo.mjs';
const source = await readFile(new URL('../web/app.js', import.meta.url), 'utf8');
const fixed = Date.parse('2026-06-12T04:00:00Z');
class FakeDate extends Date { constructor(...args) { super(...(args.length ? args : [fixed])); } static now() { return fixed; } }
function makeElement(id = '') {
  const element = {
    id, textContent: '', title: '', value: 0, hidden: false, open: false, max: 0, className: '',
    children: [], listeners: {},
    append(...nodes) { element.children.push(...nodes); },
    replaceChildren() { element.children = []; },
    setAttribute(name, value) { element['attr-' + name] = value; },
    addEventListener(type, handler) { (element.listeners[type] ||= []).push(handler); },
    showModal() { element.open = true; },
    close() { element.open = false; },
    classList: { toggle(name, on) { element.className = on ? name : ''; } },
  };
  return element;
}
function textOf(node) {
  let out = node.textContent || '';
  for (const child of node.children || []) out += textOf(child);
  return out;
}
async function loadPage() {
  const elements = {};
  const storage = new Map();
  const demo = makeDemo(fixed);
  const context = {
    URLSearchParams, Date: FakeDate,
    console,
    document: {
      getElementById: id => elements[id] ||= makeElement(id),
      createElement: () => makeElement(),
      createElementNS: () => makeElement(),
      documentElement: { dataset: {} },
      addEventListener() {},
    },
    location: { hash: '#token=demo', pathname: '/' },
    history: { replaceState() {} },
    sessionStorage: {
      getItem: key => storage.get(key) ?? null,
      setItem: (key, value) => storage.set(key, String(value)),
      removeItem: key => storage.delete(key),
    },
    matchMedia: () => ({ matches: false }),
    fetch: async () => ({ status: 200, ok: true, json: async () => demo }),
    AbortSignal: { timeout: () => null },
    setInterval: () => 0,
  };
  vm.runInNewContext(source, context, { timeout: 2000 });
  await new Promise(resolve => setImmediate(resolve));
  await new Promise(resolve => setImmediate(resolve));
  return { elements, storage, demo };
}
test('the dashboard renders quotas, cost, speed and ranking tabs from the projected payload', async () => {
  const { elements } = await loadPage();
  const quotas = textOf(elements.quotas);
  assert.ok(quotas.includes('Codex') && quotas.includes('MiniMax') && quotas.includes('GLM'));
  assert.ok(quotas.includes('59') && quotas.includes('剩余'));
  assert.ok(quotas.includes('读数 96M / 600M'), 'absolute readings appear when the vendor provides them');
  assert.ok(elements['today-extras'].textContent.includes('tok/s'));
  assert.ok(elements['today-extras'].textContent.includes('预估费用'));
  assert.ok(elements.requests.textContent.includes('432 次请求'));
  assert.ok(elements.requests.textContent.includes('失败 2'), 'errors surface next to the request count');
  assert.ok(elements['week-requests'].textContent.includes('432 次请求'));
  assert.ok(elements['week-requests'].textContent.includes('预估费用'));
  assert.ok(elements['mode-remaining'].className.includes('active'));
  assert.ok(textOf(elements['rank-body']).includes('gpt-5-demo'));
  assert.ok(textOf(elements['rank-body']).match(/\d+\.\d{2}/), 'ranking rows show the estimated cost');
  assert.ok(elements['rank-note'].textContent.length > 0);
});
test('the remaining/used toggle flips percent direction and state colors', async () => {
  const { elements } = await loadPage();
  for (const handler of elements['mode-used'].listeners.click) handler();
  const quotas = textOf(elements.quotas);
  assert.ok(quotas.includes('已用') && quotas.includes('41'));
  assert.ok(elements['mode-used'].className.includes('active'));
  assert.ok(!elements['mode-remaining'].className.includes('active'));
  assert.equal(elements['mode-used']['attr-aria-pressed'], 'true');
});
test('ranking tabs switch between models, providers, agents and computers', async () => {
  const { elements } = await loadPage();
  for (const handler of elements['tab-agents'].listeners.click) handler();
  assert.ok(textOf(elements['rank-body']).includes('Claude Code'));
  assert.ok(elements['rank-note'].textContent.includes('客户端'));
  for (const handler of elements['tab-computers'].listeners.click) handler();
  assert.ok(textOf(elements['rank-body']).includes('Demo-PC'));
});
