import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import { makeDemo } from '../fixtures/demo.mjs';
const source = await readFile(new URL('../scriptable/UsageWidget.js', import.meta.url), 'utf8');
const fixed = Date.parse('2026-06-12T04:00:00Z');
async function render(family, { offline = false, configured = true, cached = true, expired = false } = {}) {
  const data = makeDemo(fixed);
  if (expired) data.subscriptions.forEach(c => c.windows.forEach(w => { w.resetsAt = new Date(fixed - 60000).toISOString(); }));
  const texts = [], images = [], settings = { baseURL: 'http://127.0.0.1:8799', token: 'test-only-readonly-token' };
  class Stack {
    addText(value) { texts.push(value); return {}; }
    addStack() { return new Stack(); } addSpacer() {} layoutVertically() {} centerAlignContent() {}
    addImage(image) { images.push(image); return {}; } setPadding() {}
    async presentSmall() {} async presentMedium() {} async presentLarge() {}
  }
  class Color { constructor(value) { this.value = value; } static dynamic(light) { return light; } }
  class DrawContext { setFillColor() {} fillRect() {} getImage() { return this.size; } }
  class FakeDate extends Date { constructor(...args) { super(...(args.length ? args : [fixed])); } static now() { return fixed; } }
  const fm = { documentsDirectory: () => '/', joinPath: (a, b) => a + b, fileExists: () => cached, readString: () => JSON.stringify(data), writeString() {} };
  const context = {
    Date: FakeDate, console, config: { widgetFamily: family, runsInWidget: true }, args: { widgetParameter: 'codex' },
    Keychain: { get() { if (!configured) throw new Error('unset'); return JSON.stringify(settings); } },
    FileManager: { local: () => fm }, Device: { isUsingDarkAppearance: () => false },
    Color, ListWidget: Stack, DrawContext,
    Size: class { constructor(width, height) { Object.assign(this, { width, height }); } }, Rect: class {},
    Font: { mediumSystemFont: size => size, systemFont: size => size },
    Request: class { constructor() { this.response = { statusCode: 200 }; } async loadJSON() { if (offline) throw new Error('offline'); return data; } },
    Script: { setWidget(widget) { context.widget = widget; }, complete() {} },
  };
  await vm.runInNewContext('(async()=>{' + source + '\n})()', context, { timeout: 1000 });
  return { texts, images, widget: context.widget };
}
for (const family of ['small', 'medium', 'large']) test(family + ' widget renders actual script with correct data and refresh request', async () => {
  const { texts, widget } = await render(family);
  assert.ok(texts.includes('Codex')); assert.ok(texts.some(t => t.includes('59%')));
  assert.ok(!texts.some(t => /undefined|NaN/.test(t)));
  assert.ok(widget.url.includes('/#token='));
  assert.equal(widget.refreshAfterDate.getTime() - fixed, 300000);
  if (family !== 'small') { assert.ok(texts.includes('MiniMax')); assert.ok(texts.includes('GLM')); }
});
test('offline widget displays a marked cache; first run gives setup instructions', async () => {
  assert.ok((await render('medium', { offline: true })).texts.includes('离线缓存'));
  assert.ok((await render('small', { configured: false, cached: false })).texts.includes('先连接你的用量'));
});
test('an elapsed quota never becomes a fresh 100 percent allowance on the phone', async () => {
  const { texts } = await render('large', { expired: true });
  assert.ok(texts.some(t => t.includes('已到期')));
  assert.ok(!texts.some(t => /\d+%/.test(t)));
});
