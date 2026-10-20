import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from '../backend/http.mjs';
import { makeDemo } from '../fixtures/demo.mjs';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
test('read-only API authenticates headers; static routing cannot expose local state', async t => {
  const token = 'test-only-token-with-at-least-32-characters';
  const server = createServer({ root, token, collector: { overview: () => makeDemo() } });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const base = 'http://127.0.0.1:' + server.address().port;
  assert.equal((await fetch(base + '/api/v1/overview')).status, 401);
  assert.equal((await fetch(base + '/api/v1/overview?token=' + token)).status, 401);
  assert.equal((await fetch(base + '/api/v1/overview', { headers: { Authorization: 'Bearer wrong' } })).status, 401);
  const response = await fetch(base + '/api/v1/overview', { headers: { Authorization: 'Bearer ' + token } });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.equal(response.headers.get('access-control-allow-origin'), null);
  assert.equal((await response.json()).subscriptions.length, 3);
  assert.equal((await fetch(base + '/api/v1/overview', { method: 'POST' })).status, 405);
  for (const route of ['/.local/config.json', '/.git/config', '/constructor', '/toString', '/scriptable/../backend/server.mjs']) {
    assert.equal((await fetch(base + route)).status, 404, route);
  }
  assert.equal((await fetch(base + '/health')).status, 200);
  const html = await fetch(base + '/');
  assert.equal(html.status, 200);
  assert.match(html.headers.get('content-security-policy'), /frame-ancestors 'none'/);
  assert.equal((await fetch(base + '/scriptable/UsageWidget.js')).status, 200);
});
