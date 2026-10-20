function Get-BridgeFirewallSpec {
  param($Rule)
  $application = $Rule | Get-NetFirewallApplicationFilter
  $ports = $Rule | Get-NetFirewallPortFilter
  $addresses = $Rule | Get-NetFirewallAddressFilter
  return [pscustomobject]@{
    name = [string]$Rule.Name
    program = [string]$application.Program
    port = [string]$ports.LocalPort
    protocol = if ([string]$ports.Protocol -eq '6') { 'TCP' } else { [string]$ports.Protocol }
    local = (@($addresses.LocalAddress) | Sort-Object) -join ';'
    remote = (@($addresses.RemoteAddress) | Sort-Object) -join ';'
    direction = [string]$Rule.Direction
    action = [string]$Rule.Action
  }
}
function Assert-BridgeFirewallOwned {
  param($Rule, [string]$MarkerPath, $LegacyConfig)
  if (-not (Test-Path -LiteralPath $MarkerPath)) { throw 'Firewall rule has no project ownership record; it was left untouched.' }
  $marker = Get-Content -LiteralPath $MarkerPath -Raw -Encoding UTF8 | ConvertFrom-Json
  $actual = Get-BridgeFirewallSpec -Rule $Rule
  if ($marker.spec) {
    $candidates = @($marker.spec)
    if ($marker.pending -and $marker.previousSpec) { $candidates += $marker.previousSpec }
    foreach ($candidate in $candidates) {
      $matches = $true
      foreach ($field in @('name','program','port','protocol','local','remote','direction','action')) {
        if ($candidate.$field -ne $actual.$field) { $matches = $false; break }
      }
      if ($matches) { return }
    }
    throw 'Firewall rule was changed by another configuration; it was left untouched.'
  } else {
    # Compatibility with the first release's marker: require the full expected rule.
    $expectedProgram = if ($LegacyConfig.nodePath) { $LegacyConfig.nodePath } else { (Get-Command node -ErrorAction Stop).Source }
    $expectedRemote = (@($LegacyConfig.phoneIPs) | Sort-Object) -join ';'
    if (-not $marker.managed -or -not $expectedProgram -or -not $expectedRemote -or
        $actual.program -ne $expectedProgram -or $actual.port -ne [string]$LegacyConfig.port -or
        $actual.local -ne $LegacyConfig.tailnetIP -or $actual.remote -ne $expectedRemote -or
        $actual.protocol -notin @('TCP','6') -or $actual.direction -ne 'Inbound' -or $actual.action -ne 'Allow') {
      throw 'Legacy firewall ownership could not be verified; the rule was left untouched.'
    }
  }
}

function Write-BridgeFirewallMarker {
  param([string]$Path, $Record)
  $temporary = $Path + '.tmp'
  [IO.File]::WriteAllText($temporary, ($Record | ConvertTo-Json -Depth 5))
  if (Test-Path -LiteralPath $Path) { [IO.File]::Replace($temporary, $Path, [NullString]::Value) }
  else { [IO.File]::Move($temporary, $Path) }
}
