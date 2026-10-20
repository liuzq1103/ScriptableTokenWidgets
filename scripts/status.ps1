$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$task = Get-ScheduledTask -TaskName ScriptableTokenWidgets -ErrorAction SilentlyContinue
if ($task) {
  $info = Get-ScheduledTaskInfo -TaskName ScriptableTokenWidgets
  if ($task.State -eq 'Running') { Write-Output 'Task: Running' }
  else { Write-Output ("Task: {0}; last result: {1}" -f $task.State, $info.LastTaskResult) }
} else { Write-Output 'Task is not installed.' }
try {
  $config = Get-Content -LiteralPath (Join-Path $projectRoot '.local\config.json') -Raw -Encoding UTF8 | ConvertFrom-Json
  $data = Invoke-RestMethod -Uri ("http://127.0.0.1:{0}/api/v1/overview" -f $config.port) -Headers @{Authorization="Bearer $($config.token)"} -TimeoutSec 5
  Write-Output ("Local API: OK; quota cards: {0}" -f $data.subscriptions.Count)
  foreach ($name in @('quotas','today','week')) {
    $source = $data.sources.$name
    Write-Output ("{0}: {1}; observed: {2}" -f $name, $source.state, $source.observedAt)
  }
} catch { Write-Output 'Local API unavailable. Check .local\service.log.'; exit 1 }
$nodePath = $config.nodePath
if (-not $nodePath) { $nodePath = (Get-Command node -ErrorAction Stop).Source }
if (-not (Test-Path -LiteralPath $nodePath)) { throw 'The configured Node executable is missing. Run the installer again.' }
& $nodePath (Join-Path $PSScriptRoot 'tailnet.mjs') status
