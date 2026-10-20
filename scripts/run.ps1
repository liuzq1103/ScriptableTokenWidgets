$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $projectRoot
$nodePath = Join-Path $env:ProgramFiles 'nodejs\node.exe'
if (-not (Test-Path -LiteralPath $nodePath)) { $nodePath = (Get-Command node -ErrorAction Stop).Source }
$serverPath = Join-Path $projectRoot 'backend\server.mjs'
$child = Start-Process -FilePath $nodePath -ArgumentList ('"' + $serverPath + '"') -WorkingDirectory $projectRoot -WindowStyle Hidden -Wait -PassThru -RedirectStandardOutput (Join-Path $projectRoot '.local\service.log') -RedirectStandardError (Join-Path $projectRoot '.local\service-error.log')
exit $child.ExitCode
