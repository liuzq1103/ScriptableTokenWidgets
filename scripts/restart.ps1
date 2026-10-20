$ErrorActionPreference = 'Stop'
$task = Get-ScheduledTask -TaskName ScriptableTokenWidgets -ErrorAction Stop
$runner = Join-Path $PSScriptRoot 'run.ps1'
if (-not ($task.Actions.Arguments | Where-Object { $_.Contains('"' + $runner + '"') })) { throw 'Task belongs to another installation.' }
Stop-ScheduledTask -TaskName ScriptableTokenWidgets
Start-Sleep -Seconds 2
$projectRoot = Split-Path -Parent $PSScriptRoot
$serverPath = Join-Path $projectRoot 'backend\server.mjs'
Get-CimInstance Win32_Process -Filter "Name = 'node.exe'" | Where-Object {
  $_.CommandLine -and ($_.CommandLine.Contains('"' + $serverPath + '"') -or $_.CommandLine.EndsWith(' ' + $serverPath))
} | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
Start-ScheduledTask -TaskName ScriptableTokenWidgets
Write-Output 'Service restarted.'
