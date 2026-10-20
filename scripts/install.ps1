param([switch]$Firewall)
$ErrorActionPreference = 'Stop'
if ($Firewall) {
  $windowsIdentity = [System.Security.Principal.WindowsIdentity]::GetCurrent()
  $windowsPrincipal = New-Object System.Security.Principal.WindowsPrincipal($windowsIdentity)
  if (-not $windowsPrincipal.IsInRole([System.Security.Principal.WindowsBuiltInRole]::Administrator)) { throw 'Firewall mode requires an elevated PowerShell. The default Tailnet forwarding mode does not.' }
}
$projectRoot = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $projectRoot
$nodePath = (Get-Command node -ErrorAction Stop).Source
& $nodePath (Join-Path $PSScriptRoot 'configure.mjs')
if ($LASTEXITCODE -ne 0) { throw 'Configuration failed.' }
$localDirectory = Join-Path $projectRoot '.local'
$identity = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name
& icacls.exe $localDirectory /grant:r ("$($identity):(OI)(CI)F") '*S-1-5-18:(OI)(CI)F' '*S-1-5-32-544:(OI)(CI)F' /inheritance:r | Out-Null
if ($LASTEXITCODE -ne 0) { throw 'Could not restrict local configuration permissions.' }
$taskName = 'ScriptableTokenWidgets'
$runner = Join-Path $PSScriptRoot 'run.ps1'
$powerShellPath = Join-Path $env:WINDIR 'System32\WindowsPowerShell\v1.0\powershell.exe'
$arguments = '-NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -File "' + $runner + '"'
$existing = Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
if ($existing -and $existing.Actions.Arguments -notcontains $arguments) {
  throw 'A task with this name belongs to another installation. No changes made to that task.'
}
$action = New-ScheduledTaskAction -Execute $powerShellPath -Argument $arguments -WorkingDirectory $projectRoot
$trigger = New-ScheduledTaskTrigger -AtLogOn -User $identity
$principal = New-ScheduledTaskPrincipal -UserId $identity -LogonType Interactive -RunLevel Limited
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1) -ExecutionTimeLimit ([TimeSpan]::Zero) -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -MultipleInstances IgnoreNew
Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Principal $principal -Settings $settings -Description 'Read-only Magpie usage bridge for iPhone over Tailscale' -Force | Out-Null
if ($Firewall) {
  $config = Get-Content -LiteralPath (Join-Path $localDirectory 'config.json') -Raw | ConvertFrom-Json
  $phoneIPs = @($config.phoneIPs)
  if ($phoneIPs.Count -eq 0) { throw 'No iOS Tailscale peer found. Refusing a broad firewall rule.' }
  $ruleName = 'ScriptableTokenWidgets-iPhone'
  $previous = Get-NetFirewallRule -Name $ruleName -ErrorAction SilentlyContinue
  if ($previous) {
    $filter = $previous | Get-NetFirewallApplicationFilter
    if ($filter.Program -ne $nodePath) { throw 'Existing firewall rule belongs to another program.' }
    $previous | Remove-NetFirewallRule
  }
  New-NetFirewallRule -Name $ruleName -DisplayName 'ScriptableTokenWidgets: iPhone over Tailscale' -Direction Inbound -Action Allow -Protocol TCP -LocalPort $config.port -LocalAddress $config.tailnetIP -RemoteAddress $phoneIPs -Program $nodePath -Profile Any -ErrorAction Stop | Out-Null
  [System.IO.File]::WriteAllText((Join-Path $localDirectory 'firewall-rule.json'), '{"managed":true}')
} else {
  & $nodePath (Join-Path $PSScriptRoot 'tailnet.mjs') enable
  if ($LASTEXITCODE -ne 0) { throw 'Tailnet forwarding setup failed.' }
}
if ((Get-ScheduledTask -TaskName $taskName).State -ne 'Running') { Start-ScheduledTask -TaskName $taskName }
Write-Output 'Installed and started. Private iPhone connection details are in .local\iphone-setup.txt.'
