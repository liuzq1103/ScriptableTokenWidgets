import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('../scriptable/SetupUsageWidget.js', import.meta.url), 'utf8');
const widgetSource = await readFile(new URL('../scriptable/UsageWidget.js', import.meta.url), 'utf8');
const settings = { baseURL: 'http://127.0.0.1:8799', token: 'test-only-token-at-least-32-characters' };

async function setup({ saved = settings, cancel = false, offline = false } = {}) {
  const alerts = [], files = new Map(), writes = [];
  class Alert {
    constructor() { this.fields = []; alerts.push(this); }
    addTextField(label, value) { this.fields.push(value); }
    addSecureTextField(label, value) { this.fields.push(value); }
    addAction() {} addCancelAction() {}
    async presentAlert() { return alerts.indexOf(this) === 0 && !cancel ? 0 : -1; }
    textFieldValue(index) { return this.fields[index]; }
  }
  const fm = {
    documentsDirectory: () => '/', joinPath: (a, b) => a + b,
    fileExists: path => files.has(path), writeString: (path, value) => files.set(path, value),
  };
  await vm.runInNewContext('(async()=>{' + source + '\n})()', {
    Alert, Keychain: { get() { if (!saved) throw new Error('unset'); return JSON.stringify(saved); }, set: (key, value) => writes.push({ key, value }) },
    FileManager: { local: () => fm, iCloud: () => fm },
    Request: class {
      constructor() { this.response = { statusCode: 200 }; }
      async loadJSON() { if (offline) throw new Error('offline'); return { schemaVersion: 1 }; }
      async loadString() { return widgetSource; }
    },
    Script: { complete() {} }, Safari: { open() { throw new Error('unexpected preview'); } },
  }, { timeout: 1000 });
  return { alerts, files, writes };
}

test('updating the widget reuses saved connection settings and downloads the current script', async () => {
  const { alerts, files, writes } = await setup();
  assert.deepEqual(alerts[0].fields, [settings.baseURL, settings.token]);
  assert.equal(files.get('/UsageWidget.js'), widgetSource);
  assert.deepEqual(writes, [{ key: 'usage-bridge-v1', value: JSON.stringify(settings) }]);
  assert.ok(alerts[1].message.includes('page=2|used'));
});

test('a first installation has empty inputs; cancelling or a failed connection preserves settings', async () => {
  const first = await setup({ saved: null, cancel: true });
  assert.deepEqual(first.alerts[0].fields, ['', '']);
  for (const options of [{ cancel: true }, { offline: true }]) {
    const { files, writes } = await setup(options);
    assert.equal(files.size, 0);
    assert.deepEqual(writes, []);
  }
});
