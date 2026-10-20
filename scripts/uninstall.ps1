$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$firewallMarker = Join-Path $projectRoot '.local\firewall-rule.json'
. (Join-Path $PSScriptRoot 'firewall.ps1')
$rule = $null
if (Test-Path -LiteralPath $firewallMarker) {
  $identity = [System.Security.Principal.WindowsIdentity]::GetCurrent()
  $principal = New-Object System.Security.Principal.WindowsPrincipal($identity)
  if (-not $principal.IsInRole([System.Security.Principal.WindowsBuiltInRole]::Administrator)) { throw 'Uninstall firewall mode from an elevated PowerShell. No service changes made.' }
  $rule = Get-NetFirewallRule -Name 'ScriptableTokenWidgets-iPhone' -ErrorAction SilentlyContinue
  if ($rule) {
    $config = Get-Content -LiteralPath (Join-Path $projectRoot '.local\config.json') -Raw -Encoding UTF8 | ConvertFrom-Json
    Assert-BridgeFirewallOwned -Rule $rule -MarkerPath $firewallMarker -LegacyConfig $config
  }
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
$nodePath = (Get-Command node -ErrorAction Stop).Source
& $nodePath (Join-Path $PSScriptRoot 'tailnet.mjs') disable
if ($LASTEXITCODE -ne 0) { throw 'The service was stopped, but changed Tailnet forwarding was preserved for inspection.' }
if (Test-Path -LiteralPath $firewallMarker) {
  if ($rule) { $rule | Remove-NetFirewallRule -ErrorAction Stop }
  Remove-Item -LiteralPath $firewallMarker -ErrorAction Stop
}
Write-Output 'Service removed. Local configuration and cache retained in .local; Magpie was not changed.'
