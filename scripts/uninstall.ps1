$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$firewallMarker = Join-Path $projectRoot '.local\firewall-rule.json'
. (Join-Path $PSScriptRoot 'firewall.ps1')
$config = $null
$configPath = Join-Path $projectRoot '.local\config.json'
if (Test-Path -LiteralPath $configPath) { $config = Get-Content -LiteralPath $configPath -Raw -Encoding UTF8 | ConvertFrom-Json }
$rule = $null
if (Test-Path -LiteralPath $firewallMarker) {
  $identity = [System.Security.Principal.WindowsIdentity]::GetCurrent()
  $principal = New-Object System.Security.Principal.WindowsPrincipal($identity)
  if (-not $principal.IsInRole([System.Security.Principal.WindowsBuiltInRole]::Administrator)) { throw 'Uninstall firewall mode from an elevated PowerShell. No service changes made.' }
  $rule = Get-NetFirewallRule -Name 'ScriptableTokenWidgets-iPhone' -ErrorAction SilentlyContinue
  if ($rule) { Assert-BridgeFirewallOwned -Rule $rule -MarkerPath $firewallMarker -LegacyConfig $config }
}
$task = Get-ScheduledTask -TaskName ScriptableTokenWidgets -ErrorAction SilentlyContinue
$runner = Join-Path $PSScriptRoot 'run.ps1'
if ($task) {
  if (-not ($task.Actions.Arguments | Where-Object { $_.Contains('"' + $runner + '"') })) { throw 'Task belongs to another installation.' }
  Stop-ScheduledTask -TaskName ScriptableTokenWidgets
  Unregister-ScheduledTask -TaskName ScriptableTokenWidgets -Confirm:$false
}
$serverPath = Join-Path $projectRoot 'backend\server.mjs'
Get-CimInstance Win32_Process -Filter "Name = 'node.exe'" | Where-Object {
  $_.CommandLine -and ($_.CommandLine.Contains('"' + $serverPath + '"') -or $_.CommandLine.EndsWith(' ' + $serverPath))
} | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
$nodePath = if ($config -and $config.nodePath) { $config.nodePath } else { (Get-Command node -ErrorAction Stop).Source }
if (-not (Test-Path -LiteralPath $nodePath)) { throw 'The configured Node executable is missing. Run the installer again.' }
$tailnetError = $null
$global:LASTEXITCODE = 0
try { & $nodePath (Join-Path $PSScriptRoot 'tailnet.mjs') disable } catch { $tailnetError = $_.Exception.Message }
if (-not $tailnetError -and $LASTEXITCODE -ne 0) { $tailnetError = 'changed Tailnet forwarding was preserved for inspection' }
# This project's own firewall rule is removed even when the forwarding step could not finish.
if (Test-Path -LiteralPath $firewallMarker) {
  if ($rule) { $rule | Remove-NetFirewallRule -ErrorAction Stop }
  Remove-Item -LiteralPath $firewallMarker -ErrorAction Stop
}
if ($tailnetError) { throw ('The service was stopped, but ' + $tailnetError + '.') }
Write-Output 'Service removed. Local configuration and cache retained in .local; Magpie was not changed.'
