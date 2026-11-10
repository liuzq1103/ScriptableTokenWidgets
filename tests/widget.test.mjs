import test from 'node:test';
import assert from 'node:assert/strict';
import { render, fixed, descendants, measure, positioned } from '../fixtures/scriptable.mjs';
for (const family of ['small', 'medium', 'large']) test(family + ' widget renders actual script with correct data and refresh request', async () => {
  const { texts, widget } = await render(family);
  // The demo carries two Codex accounts, each named after its own identity.
  assert.ok(texts.some(t => t.startsWith('Codex · '))); assert.ok(texts.some(t => t.includes('59%')));
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
  assert.ok(texts.some(t => t.includes('待更新')));
  assert.ok(!texts.some(t => /\d+%/.test(t)));
});


function accounts(count) {
  return Array.from({ length: count }, (_, index) => ({
    id: index ? 'codex-' + (index + 1) : 'codex', provider: 'codex',
    label: 'Codex' + (index ? ' ' + (index + 1) : ''), plan: 'Plus', stale: false,
    windows: [
      { label: '5 hours', usedPercent: 11 + index, remainingPercent: 89 - index, resetsAt: new Date(fixed + 3600000).toISOString() },
      { label: '7 days', usedPercent: 21 + index, remainingPercent: 79 - index, resetsAt: new Date(fixed + 86400000).toISOString() },
    ],
  }));
}
function gridRows(widget) {
  const grid = descendants(widget).find(node => node.vertical && node.size?.width && !node.size.height);
  return grid ? grid.children.filter(node => node.kind === 'stack') : [];
}
for (const family of ['medium', 'large']) {
  for (let count = 0; count <= 7; count++) test(`${family} adapts to ${count} accounts within its layout budget`, async () => {
    const subscriptions = accounts(count);
    const { widget, texts, images, dimensions } = await render(family, { subscriptions });
    const shown = subscriptions.slice(0, 6);
    assert.deepEqual(texts.filter(text => /^Codex(?: \d+)?$/.test(text)), shown.map(card => card.label));
    assert.equal(texts.includes('暂无套餐'), count === 0);
    assert.equal(texts.some(text => text.includes('1/2页')), count === 7);
    assert.ok(!texts.some(text => /undefined|NaN/.test(text)));
    const rows = gridRows(widget);
    const columns = family === 'large' ? Math.min(2, shown.length) : shown.length > 4 ? 3 : shown.length;
    assert.equal(rows.length, shown.length ? Math.ceil(shown.length / columns) : 0);
    for (const row of rows) {
      const cells = row.children.filter(node => node.kind === 'stack');
      assert.equal(cells.length, columns);
      const width = row.children.reduce((sum, node) => sum + (node.size?.width ?? node.length), 0);
      assert.equal(width + 32, dimensions.width, 'columns must fill the available width, not just fit within it');
      for (const cell of cells) for (const image of descendants(cell).filter(node => node.kind === 'image')) {
        assert.ok(image.imageSize.width <= cell.size.width, 'a progress bar must fit its own card');
      }
    }
    assert.equal(images.length, shown.length, 'one primary bar per account, without a trend chart');
    for (const [index, image] of images.entries()) {
      assert.ok(Math.abs(image.rects[1].width / image.width * 100 - (89 - index)) < 1e-8);
      assert.ok(texts.includes((89 - index) + '%'), 'independent accounts keep their own percentages');
      if (family === 'large') assert.ok(texts.includes('7d 剩余 ' + (79 - index) + '%'));
    }
    assert.equal(texts.includes('1时00分'), shown.length > 0 && (family === 'large' || shown.length <= 4));
    assert.ok(measure(widget).height <= dimensions.height, 'content must fit the fixed widget height');
    for (const node of descendants(widget).filter(node => node.size?.height)) {
      assert.ok(measure(node).naturalHeight <= node.size.height, 'fixed-height containers must fit all their children');
    }
    if (family === 'large') {
      assert.ok(texts.some(text => text.startsWith('今日 ')));
      assert.ok(texts.some(text => text.startsWith('近七日 ')));
    }
  });

  test(family + ' pages preserve account order and adapt the last page', async () => {
    const subscriptions = accounts(13);
    const labels = [];
    for (let page = 1; page <= 3; page++) {
      const { texts, widget } = await render(family, { subscriptions, parameter: 'page=' + page });
      labels.push(...texts.filter(text => /^Codex(?: \d+)?$/.test(text)));
      assert.ok(texts.some(text => text.includes(page + '/3页')));
      if (page === 3) assert.equal(gridRows(widget)[0].children.length, 1);
    }
    assert.deepEqual(labels, subscriptions.map(card => card.label));
    const seventh = await render(family, { subscriptions: accounts(7), parameter: ' PAGE=2 | USED ' });
    assert.deepEqual(seventh.texts.filter(text => /^Codex(?: \d+)?$/.test(text)), ['Codex 7']);
    assert.ok(seventh.texts.includes('17%'));
    if (family === 'large') assert.ok(seventh.texts.includes('7d 已用 27%'));
  });

  test(family + ' handles invalid pages and a subscription count that shrinks', async () => {
    for (const parameter of ['', 'page=', 'page=0', 'page=-1', 'page=1.5', 'page=no', 'page=Infinity', 'page=9007199254740992']) {
      const { texts } = await render(family, { subscriptions: accounts(7), parameter });
      assert.ok(texts.some(text => text.includes('1/2页')), parameter);
      assert.ok(texts.includes('Codex') && !texts.includes('Codex 7'));
    }
    const last = await render(family, { subscriptions: accounts(7), parameter: 'page=99' });
    assert.ok(last.texts.includes('Codex 7') && !last.texts.includes('Codex'));
    const shrunk = await render(family, { subscriptions: accounts(3), parameter: 'page=2' });
    assert.deepEqual(shrunk.texts.filter(text => /^Codex(?: \d+)?$/.test(text)), accounts(3).map(card => card.label));
    assert.ok(!shrunk.texts.some(text => text.includes('页')));
    assert.ok((await render(family, { subscriptions: [], parameter: 'page=2' })).texts.includes('暂无套餐'));
  });

  test(family + ' handles dense offline, expired, missing and stale cards in both appearances', async () => {
    for (const dark of [false, true]) {
      const used = await render(family, { subscriptions: accounts(6), parameter: 'used', dark });
      assert.ok(used.texts.includes('11%'));
      assert.equal(used.images[0].rects[0].color, dark ? '#30362d' : '#eef0eb');
      const expired = await render(family, { subscriptions: accounts(6), expired: true, offline: true, dark });
      assert.ok(expired.texts.includes('离线缓存'));
      assert.ok(!expired.texts.some(text => /\d+%/.test(text)));
      assert.ok(expired.images.every(image => image.rects.length === 1));
      if (family === 'large') assert.ok(expired.texts.some(text => text.includes('待更新')));
    }
    const missing = accounts(6);
    missing[0].windows = []; missing[1].stale = true;
    const result = await render(family, { subscriptions: missing });
    assert.ok(result.texts.includes('—'));
    assert.ok(result.texts.some(text => text.startsWith('缓存 ')));
    assert.ok(!result.texts.some(text => /undefined|NaN/.test(text)));
  });
}

test('the widget parameter selects a provider and the percent direction', async () => {
  const remaining = await render('small', { parameter: 'codex' });
  assert.ok(remaining.texts.some(t => t.includes('59%')));
  assert.ok(!remaining.texts.some(t => t.includes('41%')));
  const used = await render('small', { parameter: 'codex|used' });
  assert.ok(used.texts.some(t => t.includes('41%')));
  assert.ok(!used.texts.some(t => t.includes('59%')));
  const medium = await render('medium', { parameter: 'used' });
  assert.ok(medium.texts.some(t => t.includes('41%')));
  assert.ok(medium.texts.some(t => t.includes('已用')));
});

test('the widget parameter picks one account of a vendor', async () => {
  // The vendor name still shows its first account.
  const first = await render('small', { parameter: 'codex' });
  assert.ok(first.texts.some(t => t.includes('59%')));
  assert.ok(!first.texts.some(t => t.includes('92%')));
  // An account is named after its own identity.
  const second = await render('small', { parameter: 'codex@second' });
  assert.ok(second.texts.some(t => t.includes('92%')));
  assert.ok(!second.texts.some(t => t.includes('59%')));
  assert.ok(second.texts.some(t => t.includes('Codex · second')));
});

test('the small widget shows the tokens of the subscription it shows', async () => {
  const first = await render('small', { parameter: 'codex@first' });
  assert.ok(first.texts.some(t => t.includes('12.35M')), 'the first account has its own tokens');
  assert.ok(!first.texts.some(t => t.includes('4.57M')));
  const second = await render('small', { parameter: 'codex@second' });
  assert.ok(second.texts.some(t => t.includes('4.57M')));
  assert.ok(!second.texts.some(t => t.includes('12.35M')));
  // A vendor with one account is counted by its own usage row.
  const glm = await render('small', { parameter: 'glm' });
  assert.ok(glm.texts.some(t => /^今日 [\d.]+[MK] token$/.test(t)), glm.texts.join(' | '));
  // A subscription that is not on screen shows no tokens of its own.
  const missing = await render('small', { parameter: 'nothing' });
  assert.ok(missing.texts.includes('暂无该套餐'));
  assert.ok(missing.texts.some(t => t.includes('今日 — token')), missing.texts.join(' | '));
});

const screenCases = [
  { name: 'narrow', screen: { width: 320, height: 568 }, width: 292 },
  { name: 'compact', screen: { width: 375, height: 667 }, width: 322 },
  { name: 'regular', screen: { width: 375, height: 812 }, width: 329 },
  { name: 'capture', screen: { width: 402, height: 874 }, width: 349 },
  { name: 'wide', screen: { width: 430, height: 932 }, width: 364 },
  { name: 'unknown', screen: { width: 400, height: 900 }, width: 336 },
];
function exampleAccounts(count, mixed = false) {
  const cards = accounts(count);
  const labels = ['Codex', 'Codex 2', 'MiniMax', 'GLM', 'MiniMax 2', 'GLM 2'];
  for (const [index, card] of cards.entries()) {
    card.label = labels[index];
    card.windows[0].remainingPercent = [85, 100, 98, 97, 72, 64][index];
    card.windows[0].usedPercent = 100 - card.windows[0].remainingPercent;
    if (mixed && index % 2) {
      card.windows[0].label = '7 days';
      card.windows[0].resetsAt = new Date(fixed + (12 * 24 + 23) * 3600000).toISOString();
    }
  }
  return cards;
}
for (const family of ['medium', 'large']) for (const device of screenCases) {
  test(`${family} fills ${device.name} width with aligned, readable 1–6 account layouts`, async () => {
    for (let count = 1; count <= 6; count++) for (const mixed of [false, true]) {
      const { widget, dimensions } = await render(family, { screen: device.screen, subscriptions: exampleAccounts(count, mixed) });
      assert.equal(dimensions.width, device.width);
      for (const node of descendants(widget).filter(node => node.size?.height)) {
        assert.ok(measure(node).naturalHeight <= node.size.height + 0.01, `${count} cards: content exceeds container height`);
      }
      const items = positioned(widget, dimensions);
      for (const item of items.filter(item => item.node.kind === 'text' || item.node.kind === 'image')) {
        assert.ok(item.x >= 16 - 0.01 && item.x + item.width <= dimensions.width - 16 + 0.01, 'content must stay inside aligned edges');
        assert.ok(item.y >= widget.padding[0] && item.y + item.height <= dimensions.height - widget.padding[2] + 0.01);
        if (item.node.kind === 'text') {
          assert.ok(measure(item.node).width * item.node.minimumScaleFactor <= item.width + 0.01, 'text must fit without aggressive shrinking: ' + item.node.value);
        }
      }
      for (const row of gridRows(widget)) {
        const cells = row.children.filter(node => node.kind === 'stack');
        const boxes = cells.map(cell => items.find(item => item.node === cell));
        assert.equal(boxes[0].x, 16);
        assert.ok(Math.abs(boxes.at(-1).x + boxes.at(-1).width - (dimensions.width - 16)) < 0.01);
        for (let index = 1; index < boxes.length; index++) {
          const gap = boxes[index].x - boxes[index - 1].x - boxes[index - 1].width;
          assert.ok(Math.abs(gap - (family === 'medium' ? 10 : 16)) < 0.01);
        }
      }
      const body = widget.children[1];
      const grid = body.children[1];
      const bodyBox = items.find(item => item.node === body), gridBox = items.find(item => item.node === grid);
      assert.ok(Math.abs((gridBox.y - bodyBox.y) - (bodyBox.y + bodyBox.height - gridBox.y - gridBox.height)) < 0.01, 'space above and below the grid must balance');
    }
  });
}

test('shared windows appear once; mixed windows retain each card’s meaning', async () => {
  const shared = await render('medium', { subscriptions: exampleAccounts(4) });
  assert.ok(shared.texts.includes('剩余 · 5h'));
  assert.ok(!shared.texts.includes('5h'));
  assert.ok(shared.texts.includes('100%'));
  assert.ok(!shared.texts.some(text => /后重置/.test(text)));
  const mixed = await render('medium', { subscriptions: exampleAccounts(4, true), parameter: 'used' });
  assert.ok(mixed.texts.includes('已用额度'));
  assert.ok(mixed.texts.includes('7d · 12天23时'));
  const dense = await render('medium', { subscriptions: exampleAccounts(6, true) });
  assert.ok(dense.texts.includes('5h') && dense.texts.includes('7d'));
  assert.ok(!dense.texts.some(text => text.includes('12天')));
});

test('short countdowns, unknown resets and elapsed windows have explicit states', async () => {
  const subscriptions = exampleAccounts(4);
  const delays = [49 * 60000, (3 * 60 + 49) * 60000, (2 * 24 + 3) * 3600000];
  delays.forEach((delay, index) => { subscriptions[index].windows[0].resetsAt = new Date(fixed + delay).toISOString(); });
  subscriptions[3].windows[0].resetsAt = null;
  const result = await render('medium', { subscriptions });
  for (const expected of ['49分', '3时49分', '2天3时', '时间未知']) assert.ok(result.texts.includes(expected));
  assert.ok((await render('medium', { subscriptions, expired: true })).texts.includes('待更新'));
  assert.ok((await render('small')).texts.some(text => text.includes('后重置')), 'small keeps the original wording');
});

test('orientation and an unavailable screen API do not break sizing', async () => {
  const portrait = await render('medium', { subscriptions: exampleAccounts(4) });
  const landscape = await render('medium', { subscriptions: exampleAccounts(4), screen: { width: 874, height: 402 } });
  assert.deepEqual(JSON.parse(JSON.stringify(landscape.dimensions)), JSON.parse(JSON.stringify(portrait.dimensions)));
  const unavailable = await render('medium', { screen: null, subscriptions: exampleAccounts(4) });
  assert.equal(unavailable.dimensions.width, 292);
  assert.ok(unavailable.texts.includes('100%'));
});
