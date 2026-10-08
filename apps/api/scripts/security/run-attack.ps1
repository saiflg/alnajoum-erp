# Rebuild the API, start it with the rate limits lifted, run the cross-tenant attack harness, stop the API.
# LOCAL USE ONLY. Writes the report next to the repo scratch area given by -Out.
param([string]$Out = "$env:TEMP\cross-tenant-report", [switch]$ReadsOnly, [switch]$NoBuild)
$ErrorActionPreference = 'Stop'
Set-Location (Join-Path $PSScriptRoot '..\..')

$port = (Get-NetTCPConnection -LocalPort 4000 -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1).OwningProcess
if ($port) { Stop-Process -Id $port -Force; Start-Sleep -Seconds 2 }

if (-not $NoBuild) { npx nest build | Out-Null }

$env:GLOBAL_THROTTLE_LIMIT = '1000000'; $env:AUTH_THROTTLE_LIMIT = '100000'; $env:WORKFLOW_SCHEDULER_DISABLED = 'true'
$api = Start-Process -FilePath node -ArgumentList 'dist/main.js' -WorkingDirectory (Get-Location) -WindowStyle Hidden -PassThru `
  -RedirectStandardOutput "$Out.api.log" -RedirectStandardError "$Out.api.err"
try {
  for ($i = 0; $i -lt 40; $i++) {
    try { if ((Invoke-WebRequest http://localhost:4000/api/v1/health -UseBasicParsing -TimeoutSec 2).StatusCode -eq 200) { break } } catch { Start-Sleep -Seconds 2 }
  }
  $flags = @('--per-route', '12', '--out', "$Out.json")
  if ($ReadsOnly) { $flags += '--reads-only' }
  node scripts/security/cross-tenant-attack.mjs @flags | Tee-Object -FilePath "$Out.txt"
} finally {
  Stop-Process -Id $api.Id -Force -ErrorAction SilentlyContinue
}
