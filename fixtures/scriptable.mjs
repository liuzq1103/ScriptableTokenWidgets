import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import { makeDemo } from './demo.mjs';

const source = await readFile(new URL('../scriptable/UsageWidget.js', import.meta.url), 'utf8');
export const fixed = Date.parse('2026-06-12T04:00:00Z');

// Execute the actual phone script. Both regression checks and previews consume
// this tree, so the preview cannot quietly drift into a separate layout.
export async function render(family, {
  offline = false, configured = true, cached = true, expired = false, dark = false,
  subscriptions = null, parameter = 'codex', screen = { width: 402, height: 874 },
  todayTokens = null,
} = {}) {
  const data = makeDemo(fixed);
  if (subscriptions) data.subscriptions = structuredClone(subscriptions);
  if (todayTokens !== null) data.usage.today.totalTokens = todayTokens;
  if (expired) data.subscriptions.forEach(card => card.windows.forEach(window => { window.resetsAt = new Date(fixed - 60000).toISOString(); }));
  const texts = [], images = [], settings = { baseURL: 'http://127.0.0.1:8799', token: 'test-only-readonly-token' };
  class Stack {
    constructor() { this.kind = 'stack'; this.children = []; this.vertical = false; }
    addText(value) { texts.push(value); const element = { kind: 'text', value }; this.children.push(element); return element; }
    addStack() { const stack = new Stack(); this.children.push(stack); return stack; }
    addSpacer(length) { this.children.push({ kind: 'spacer', length: length ?? 0, flexible: length == null }); }
    layoutVertically() { this.vertical = true; }
    centerAlignContent() { this.alignment = 'center'; } topAlignContent() { this.alignment = 'top'; }
    addImage(image) { images.push(image); const element = { kind: 'image', image }; this.children.push(element); return element; }
    setPadding(...padding) { this.padding = padding; }
    async presentSmall() {} async presentMedium() {} async presentLarge() {}
  }
  class Widget extends Stack { constructor() { super(); this.vertical = true; } }
  class Color { constructor(value) { this.value = value; } static dynamic(light, night) { return dark ? night : light; } }
  class DrawContext {
    constructor() { this.rects = []; }
    setFillColor(color) { this.color = color.value; }
    fillRect(rect) { this.rects.push({ ...rect, color: this.color }); }
    getImage() { return { ...this.size, rects: this.rects }; }
  }
  class FakeDate extends Date { constructor(...args) { super(...(args.length ? args : [fixed])); } static now() { return fixed; } }
  const fm = { documentsDirectory: () => '/', joinPath: (a, b) => a + b, fileExists: () => cached, readString: () => JSON.stringify(data), writeString() {} };
  const context = {
    Date: FakeDate, console, config: { widgetFamily: family, runsInWidget: true }, args: { widgetParameter: parameter },
    Keychain: { get() { if (!configured) throw new Error('unset'); return JSON.stringify(settings); } },
    FileManager: { local: () => fm }, Device: { isUsingDarkAppearance: () => dark, screenSize: () => screen },
    Color, ListWidget: Widget, DrawContext,
    Size: class { constructor(width, height) { Object.assign(this, { width, height }); } },
    Rect: class { constructor(x, y, width, height) { Object.assign(this, { x, y, width, height }); } },
    Font: { mediumSystemFont: size => size, systemFont: size => size },
    Request: class { constructor() { this.response = { statusCode: 200 }; } async loadJSON() { if (offline) throw new Error('offline'); return data; } },
    Script: { setWidget(widget) { context.widget = widget; }, complete() {} },
  };
  const dimensions = await vm.runInNewContext('(async()=>{' + source + '\nreturn dimensions;})()', context, { timeout: 1000 });
  return { texts, images, widget: context.widget, dimensions };
}

export function descendants(node) {
  return [node, ...(node.children || []).flatMap(descendants)];
}

export function textWidth(value, font) {
  return [...value].reduce((sum, char) => sum + (
    char.codePointAt(0) >= 0x2e80 ? 1 : /[MW%]/.test(char) ? 0.85 :
      /[il: .·]/.test(char) ? 0.28 : /\d/.test(char) ? 0.58 : 0.56
  ) * font, 0);
}

export function measure(node) {
  if (node.kind === 'text') return { width: textWidth(node.value, node.font), height: node.font * 1.25 };
  if (node.kind === 'image') return node.imageSize;
  if (node.kind === 'spacer') return { width: node.length, height: node.length };
  const children = node.children.map(measure);
  const sum = key => children.reduce((total, child) => total + child[key], 0);
  const max = key => Math.max(0, ...children.map(child => child[key]));
  const padding = node.padding || [0, 0, 0, 0];
  const naturalWidth = (node.vertical ? max('width') : sum('width')) + padding[1] + padding[3];
  const naturalHeight = (node.vertical ? sum('height') : max('height')) + padding[0] + padding[2];
  return { width: node.size?.width || naturalWidth, height: node.size?.height || naturalHeight, naturalWidth, naturalHeight };
}

// A deterministic approximation of stack layout, including flexible spacers.
// It verifies alignment/space budgets, not UIKit's exact font rasterization.
export function positioned(widget, dimensions) {
  const items = [];
  function place(node, x, y, width, height) {
    items.push({ node, x, y, width, height });
    if (!node.children) return;
    const padding = node.padding || [0, 0, 0, 0];
    x += padding[1]; y += padding[0];
    width -= padding[1] + padding[3]; height -= padding[0] + padding[2];
    const axis = node.vertical ? 'height' : 'width';
    const sizes = node.children.map(measure);
    const fixedSize = sizes.reduce((sum, size) => sum + size[axis], 0);
    const count = node.children.filter(child => child.flexible).length;
    const flexSize = count ? Math.max(0, (node.vertical ? height : width) - fixedSize) / count : 0;
    for (const [index, child] of node.children.entries()) {
      const size = sizes[index];
      if (node.vertical) {
        const childHeight = child.flexible ? flexSize : size.height;
        place(child, x, y, child.size?.width || width, childHeight);
        y += childHeight;
      } else {
        const compression = fixedSize > width ? width / fixedSize : 1;
        const childWidth = child.flexible ? flexSize : size.width * compression;
        const childY = y + (node.alignment === 'center' ? Math.max(0, height - size.height) / 2 : 0);
        place(child, x, childY, childWidth, size.height);
        x += childWidth;
      }
    }
  }
  place(widget, 0, 0, dimensions.width, dimensions.height);
  return items;
}
