param([switch]$Firewall, [ValidateRange(1,60)][int]$StartupTimeoutSeconds = 20)
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$localDirectory = Join-Path $projectRoot '.local'
$firewallMarker = Join-Path $localDirectory 'firewall-rule.json'
$forwardMarker = Join-Path $localDirectory 'tailnet-forward.json'
if (($Firewall -and (Test-Path -LiteralPath $forwardMarker)) -or
    (-not $Firewall -and (Test-Path -LiteralPath $firewallMarker))) {
  throw 'Uninstall the existing network mode before switching modes. Use an elevated PowerShell when uninstalling firewall mode.'
}
if ($Firewall) {
  $windowsIdentity = [System.Security.Principal.WindowsIdentity]::GetCurrent()
  $windowsPrincipal = New-Object System.Security.Principal.WindowsPrincipal($windowsIdentity)
  if (-not $windowsPrincipal.IsInRole([System.Security.Principal.WindowsBuiltInRole]::Administrator)) { throw 'Firewall mode requires an elevated PowerShell. The default Tailnet forwarding mode does not.' }
}
Set-Location -LiteralPath $projectRoot
. (Join-Path $PSScriptRoot 'firewall.ps1')
$taskName = 'ScriptableTokenWidgets'
$runner = Join-Path $PSScriptRoot 'run.ps1'
$powerShellPath = Join-Path $env:WINDIR 'System32\WindowsPowerShell\v1.0\powershell.exe'
$arguments = '-NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -File "' + $runner + '"'
$existing = Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
if ($existing -and $existing.Actions.Arguments -notcontains $arguments) {
  throw 'A task with this name belongs to another installation. No changes made to that task.'
}
$bootstrapNode = (Get-Command node -ErrorAction Stop).Source
& $bootstrapNode (Join-Path $PSScriptRoot 'configure.mjs')
if ($LASTEXITCODE -ne 0) { throw 'Configuration failed.' }
$config = Get-Content -LiteralPath (Join-Path $localDirectory 'config.json') -Raw -Encoding UTF8 | ConvertFrom-Json
$nodePath = $config.nodePath
if (-not $nodePath -or -not (Test-Path -LiteralPath $nodePath)) { throw 'The configured Node executable is missing. Reinstall Node and run the installer again.' }
$identity = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name
& icacls.exe $localDirectory /grant:r ("$($identity):(OI)(CI)F") '*S-1-5-18:(OI)(CI)F' '*S-1-5-32-544:(OI)(CI)F' /inheritance:r | Out-Null
if ($LASTEXITCODE -ne 0) { throw 'Could not restrict local configuration permissions.' }
$action = New-ScheduledTaskAction -Execute $powerShellPath -Argument $arguments -WorkingDirectory $projectRoot
$trigger = New-ScheduledTaskTrigger -AtLogOn -User $identity
$principal = New-ScheduledTaskPrincipal -UserId $identity -LogonType Interactive -RunLevel Limited
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1) -ExecutionTimeLimit ([TimeSpan]::Zero) -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -MultipleInstances IgnoreNew
Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Principal $principal -Settings $settings -Description 'Read-only Magpie usage bridge for iPhone over Tailscale' -Force | Out-Null
if ($existing) { & (Join-Path $PSScriptRoot 'restart.ps1') }
else { Start-ScheduledTask -TaskName $taskName }
$ready = $false
$deadline = (Get-Date).AddSeconds($StartupTimeoutSeconds)
do {
  try {
    $probe = Invoke-RestMethod -Uri ("http://127.0.0.1:{0}/api/v1/overview" -f $config.port) -Headers @{Authorization="Bearer $($config.token)"} -TimeoutSec 2
    $ready = $probe.schemaVersion -eq 1
  } catch { $ready = $false }
  if (-not $ready) { Start-Sleep -Milliseconds 250 }
} until ($ready -or (Get-Date) -ge $deadline)
if (-not $ready) { throw 'The configured service did not start. No new forwarding was created; check the service log and port availability.' }
if ($Firewall) {
  $phoneIPs = @($config.phoneIPs)
  if ($phoneIPs.Count -eq 0) { throw 'No iOS Tailscale peer found. Refusing a broad firewall rule.' }
  $ruleName = 'ScriptableTokenWidgets-iPhone'
  $previous = Get-NetFirewallRule -Name $ruleName -ErrorAction SilentlyContinue
  $previousSpec = $null
  if ($previous) {
    Assert-BridgeFirewallOwned -Rule $previous -MarkerPath $firewallMarker -LegacyConfig $config
    $previousSpec = Get-BridgeFirewallSpec -Rule $previous
  }
  $expected = [pscustomobject]@{
    name=$ruleName; program=$nodePath; port=[string]$config.port; protocol='TCP'
    local=[string]$config.tailnetIP; remote=(@($phoneIPs) | Sort-Object) -join ';'
    direction='Inbound'; action='Allow'
  }
  Write-BridgeFirewallMarker -Path $firewallMarker -Record @{version=2;managed=$true;pending=$true;spec=$expected;previousSpec=$previousSpec}
  if ($previous) { $previous | Remove-NetFirewallRule -ErrorAction Stop }
  $rule = New-NetFirewallRule -Name $ruleName -DisplayName 'ScriptableTokenWidgets: iPhone over Tailscale' -Direction Inbound -Action Allow -Protocol TCP -LocalPort $config.port -LocalAddress $config.tailnetIP -RemoteAddress $phoneIPs -Program $nodePath -Profile Any -ErrorAction Stop
  Write-BridgeFirewallMarker -Path $firewallMarker -Record @{version=1;managed=$true;spec=(Get-BridgeFirewallSpec -Rule $rule)}
} else {
  & $nodePath (Join-Path $PSScriptRoot 'tailnet.mjs') enable
  if ($LASTEXITCODE -ne 0) { throw 'Tailnet forwarding setup failed.' }
}
Write-Output 'Installed and started. Private iPhone connection details are in .local\iphone-setup.txt.'
