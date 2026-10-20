$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $projectRoot
$config = Get-Content -LiteralPath (Join-Path $projectRoot '.local\config.json') -Raw -Encoding UTF8 | ConvertFrom-Json
$nodePath = $config.nodePath
if (-not $nodePath) { $nodePath = (Get-Command node -ErrorAction Stop).Source }
if (-not (Test-Path -LiteralPath $nodePath)) { throw 'The configured Node executable is missing; run the installer again.' }
$serverPath = Join-Path $projectRoot 'backend\server.mjs'
$child = Start-Process -FilePath $nodePath -ArgumentList ('"' + $serverPath + '"') -WorkingDirectory $projectRoot -WindowStyle Hidden -Wait -PassThru -RedirectStandardOutput (Join-Path $projectRoot '.local\service.log') -RedirectStandardError (Join-Path $projectRoot '.local\service-error.log')
exit $child.ExitCode
