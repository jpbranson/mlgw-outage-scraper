$ErrorActionPreference = 'Stop'
$workspace = (Resolve-Path '.').Path
if ($workspace -ne 'C:\Developer\mlgw-outage-scraper') { throw 'Run from the scraper workspace' }
$statePath = Join-Path $workspace 'data\collector\run-state.json'
$weatherPath = Join-Path $workspace 'data\weather\maintenance\state.json'
$collectorState = Get-Content -LiteralPath $statePath -Raw | ConvertFrom-Json
$weatherState = Get-Content -LiteralPath $weatherPath -Raw | ConvertFrom-Json
$now = [DateTime]::UtcNow
if ($collectorState.stopReason) { throw 'Collector already has a stop reason; inspect before cutover' }
if (($now - [DateTime]::Parse($collectorState.heartbeatAt).ToUniversalTime()).TotalSeconds -gt 40) { throw 'Collector heartbeat is stale' }
if (([DateTime]::Parse($collectorState.nextDueAt).ToUniversalTime() - $now).TotalSeconds -lt 60) { throw 'Wait until the current capture finishes before cutover' }
$collectorProcess = Get-CimInstance Win32_Process -Filter "ProcessId = $($collectorState.pid)"
if (!$collectorProcess -or $collectorProcess.Name -ne 'node.exe' -or $collectorProcess.CommandLine -notmatch 'scripts[/\\]collector\.mjs\s+run\s*$') { throw 'Collector process identity does not match' }
if (Get-Process -Id $weatherState.pid -ErrorAction SilentlyContinue) { throw 'Weather runner has not stopped yet' }
if ((Test-Path -LiteralPath 'data/weather/maintenance/runner.lock') -or $weatherState.stopReason -ne 'owner-requested') { throw 'Weather has not stopped cleanly' }
$backup = Join-Path $workspace 'data\deployment\local-cutover-before.json'
if (Test-Path -LiteralPath $backup) { throw 'Cutover backup already exists; inspect it before continuing' }
$before = [pscustomobject]@{ at=$now.ToString('o'); collector=$collectorState; weather=$weatherState }
[IO.File]::WriteAllText($backup, ($before | ConvertTo-Json -Depth 20), (New-Object Text.UTF8Encoding $false))
$nativeProcess = Get-Process -Id $collectorState.pid
Stop-Process -InputObject $nativeProcess
if (!$nativeProcess.WaitForExit(15000)) { throw 'Local collector did not stop' }
$collectorState | Add-Member -NotePropertyName stopReason -NotePropertyValue 'cloud_cutover' -Force
$collectorState | Add-Member -NotePropertyName stoppedAt -NotePropertyValue ([DateTime]::UtcNow.ToString('o')) -Force
$collectorState | Add-Member -NotePropertyName cloudOrigin -NotePropertyValue 'https://64.225.60.118' -Force
[IO.File]::WriteAllText($statePath, ($collectorState | ConvertTo-Json -Depth 20), (New-Object Text.UTF8Encoding $false))
[pscustomobject]@{ stoppedAt=$collectorState.stoppedAt; collectorPid=$collectorState.pid; weatherPid=$weatherState.pid; lastCaptureAt=$collectorState.lastCaptureAt; origin=$collectorState.cloudOrigin } | ConvertTo-Json -Compress
