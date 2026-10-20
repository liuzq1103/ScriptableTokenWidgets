import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, copyFile, writeFile, readFile, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const windows = { skip: process.platform !== 'win32' };
const quote = value => "'" + value.replaceAll("'", "''") + "'";
const psFile = (file, text) => writeFile(file, '\uFEFF' + text);
const powershell = file => spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', file], { encoding: 'utf8', timeout: 30000 });
async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(), 'token-widget-test-'));
  await mkdir(path.join(root, 'scripts'));
  await mkdir(path.join(root, '.local'));
  for (const name of ['install.ps1', 'firewall.ps1']) await copyFile(new URL('../scripts/' + name, import.meta.url), path.join(root, 'scripts', name));
  return root;
}
async function installer(root, { ready = true } = {}) {
  const scripts = path.join(root, 'scripts');
  await writeFile(path.join(scripts, 'configure.mjs'), "import fs from 'node:fs';fs.writeFileSync(new URL('../.local/config.json',import.meta.url),JSON.stringify({nodePath:process.execPath,port:8799,token:'test-token'}));");
  await writeFile(path.join(scripts, 'tailnet.mjs'), "import fs from 'node:fs';fs.writeFileSync(new URL('../.local/forwarded',import.meta.url),'yes');");
  await psFile(path.join(scripts, 'restart.ps1'), "[IO.File]::WriteAllText((Join-Path $PSScriptRoot '../.local/restarted'), 'yes')");
  const harness = path.join(root, 'test.ps1');
  await psFile(harness, [
    "$ErrorActionPreference = 'Stop'",
    "$expectedRunner = Join-Path " + quote(scripts) + " 'run.ps1'",
    "$expectedArguments = '-NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -File \"' + $expectedRunner + '\"'",
    "function Get-ScheduledTask { [pscustomobject]@{ State='Running'; Actions=@([pscustomobject]@{ Arguments=$expectedArguments }) } }",
    "function New-ScheduledTaskAction { [pscustomobject]@{} }",
    "function New-ScheduledTaskTrigger { [pscustomobject]@{} }",
    "function New-ScheduledTaskPrincipal { [pscustomobject]@{} }",
    "function New-ScheduledTaskSettingsSet { [pscustomobject]@{} }",
    "function Register-ScheduledTask {}",
    "function Start-ScheduledTask { throw 'Existing service must use restart.' }",
    "function icacls.exe { $global:LASTEXITCODE = 0 }",
    "function Invoke-RestMethod { " + (ready ? '[pscustomobject]@{schemaVersion=1}' : "throw 'not ready'") + " }",
    "& " + quote(path.join(scripts, 'install.ps1')) + " -StartupTimeoutSeconds 1",
  ].join('\n'));
  return powershell(harness);
}

test('Windows reinstall restarts an existing running service before forwarding', windows, async () => {
  const root = await fixture();
  const result = await installer(root);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.equal(await readFile(path.join(root, '.local/restarted'), 'utf8'), 'yes');
  assert.equal(await readFile(path.join(root, '.local/forwarded'), 'utf8'), 'yes');
  const config = JSON.parse(await readFile(path.join(root, '.local/config.json'), 'utf8'));
  assert.equal(config.nodePath, process.execPath);
});

test('Windows failed startup never creates a new forwarding entry', windows, async () => {
  const root = await fixture();
  const result = await installer(root, { ready: false });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /No new forwarding was created/);
  await assert.rejects(access(path.join(root, '.local/forwarded')));
});

test('Windows mode switches stop before configuration or task changes', windows, async () => {
  for (const [marker, flag] of [['tailnet-forward.json', '-Firewall'], ['firewall-rule.json', '']]) {
    const root = await fixture();
    await writeFile(path.join(root, '.local', marker), '{}');
    const harness = path.join(root, 'test.ps1');
    await psFile(harness, '& ' + quote(path.join(root, 'scripts/install.ps1')) + ' ' + flag);
    const result = powershell(harness);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /Uninstall the existing network mode/);
    await assert.rejects(access(path.join(root, '.local/config.json')));
  }
});

test('Windows runner uses the persisted Node executable', windows, async () => {
  const root = await fixture();
  const runtime = path.join(root, 'chosen-node.exe');
  await writeFile(runtime, '');
  await writeFile(path.join(root, '.local/config.json'), JSON.stringify({ nodePath: runtime }));
  await copyFile(new URL('../scripts/run.ps1', import.meta.url), path.join(root, 'scripts/run.ps1'));
  const harness = path.join(root, 'test.ps1');
  await psFile(harness, [
    "function Start-Process {",
    "  param($FilePath)",
    "  [IO.File]::WriteAllText(" + quote(path.join(root, '.local/runtime')) + ", $FilePath)",
    "  return [pscustomobject]@{ ExitCode=0 }",
    "}",
    "& " + quote(path.join(root, 'scripts/run.ps1')),
  ].join('\n'));
  const result = powershell(harness);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(await readFile(path.join(root, '.local/runtime'), 'utf8'), runtime);
});

test('Windows firewall ownership rejects edited and unrecorded rules', windows, async () => {
  const root = await fixture();
  const marker = path.join(root, '.local/firewall-rule.json');
  const harness = path.join(root, 'test.ps1');
  await psFile(harness, [
    "$ErrorActionPreference = 'Stop'",
    ". " + quote(path.join(root, 'scripts/firewall.ps1')),
    "$rule = [pscustomobject]@{ Name='ScriptableTokenWidgets-iPhone'; Direction='Inbound'; Action='Allow' }",
    "$script:program = 'C:\\Node\\node.exe'",
    "function Get-NetFirewallApplicationFilter { [pscustomobject]@{ Program=$script:program } }",
    "function Get-NetFirewallPortFilter { [pscustomobject]@{ LocalPort='8799'; Protocol='TCP' } }",
    "function Get-NetFirewallAddressFilter { [pscustomobject]@{ LocalAddress='127.0.0.1'; RemoteAddress=@('127.0.0.2') } }",
    "$marker = " + quote(marker),
    "@{version=1;managed=$true;spec=(Get-BridgeFirewallSpec -Rule $rule)} | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath $marker -Encoding UTF8",
    "Assert-BridgeFirewallOwned -Rule $rule -MarkerPath $marker",
    "$script:program = 'C:\\Other\\node.exe'",
    "$rejected = $false",
    "try { Assert-BridgeFirewallOwned -Rule $rule -MarkerPath $marker } catch { $rejected = $true }",
    "if (-not $rejected) { throw 'An edited program rule was accepted.' }",
    "$rejected = $false",
    "try { Assert-BridgeFirewallOwned -Rule $rule -MarkerPath ($marker + '.absent') } catch { $rejected = $true }",
    "if (-not $rejected) { throw 'An unrecorded rule was accepted.' }",
  ].join('\n'));
  const result = powershell(harness);
  assert.equal(result.status, 0, result.stdout + result.stderr);
});
