$ErrorActionPreference = 'Stop'
$task = Get-ScheduledTask -TaskName ScriptableTokenWidgets -ErrorAction SilentlyContinue
$runner = Join-Path $PSScriptRoot 'run.ps1'
if ($task) {
  if (-not ($task.Actions.Arguments | Where-Object { $_.Contains('"' + $runner + '"') })) { throw 'Task belongs to another installation.' }
  Stop-ScheduledTask -TaskName ScriptableTokenWidgets
  Unregister-ScheduledTask -TaskName ScriptableTokenWidgets -Confirm:$false
}
$projectRoot = Split-Path -Parent $PSScriptRoot
$serverPath = Join-Path $projectRoot 'backend\server.mjs'
Get-CimInstance Win32_Process -Filter "Name = 'node.exe'" | Where-Object {
  $_.CommandLine -and ($_.CommandLine.Contains('"' + $serverPath + '"') -or $_.CommandLine.EndsWith(' ' + $serverPath))
} | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
$nodePath = (Get-Command node -ErrorAction Stop).Source
& $nodePath (Join-Path $PSScriptRoot 'tailnet.mjs') disable
if ($LASTEXITCODE -ne 0) { Write-Warning 'The Tailnet forward could not be removed; inspect it before changing any existing Serve configuration.' }
if (Test-Path -LiteralPath (Join-Path $projectRoot '.local\firewall-rule.json')) {
  $rule = Get-NetFirewallRule -Name 'ScriptableTokenWidgets-iPhone' -ErrorAction SilentlyContinue
  if ($rule) { $rule | Remove-NetFirewallRule -ErrorAction Stop }
}
Write-Output 'Service removed. Local configuration and cache retained in .local; Magpie was not changed.'
