# Autonomous development checkpoint — September 18, 2026

**September 22 deployment update:** the [DigitalOcean deployment guide](DIGITALOCEAN_DEPLOYMENT.md) is authoritative for current operation. The VM now serves the dashboard and runs both collectors; local collectors are stopped. Runtime counts, preview sessions, trial deadlines and hosting gates below describe this earlier checkpoint. Its scientific findings and dated validation results are preserved.

The owner's request to implement the remaining plan authorized this continuation beyond the earlier bounded checkpoints. The local weather/analysis and transfer preparation work below is implemented. Production cloud collection, cloud deletion and Windows task installation have not been enabled.

This is a dated implementation checkpoint. The subsequent [documentation review and current status](PROJECT_STATUS.md) reconcile operating commands and all phase reports; runtime counts and process IDs below remain the values measured during implementation.

## Weather cases and geographic scope

The Weather comparisons page now offers four 72-hour cases: the unchanged June 2023 and September 2024 rainfall/wind studies, plus December 22–24, 2022 cold and June 29–July 1, 2023 heat. Open `http://127.0.0.1:4173/legacy.html?view=comparisons` and select a case.

An outcome-blind coverage screen was recorded in `config/weather-candidates.json` before adding cases. The three additional rainfall/wind candidates were selected from documented weather dates: [March 31–April 1](https://www.weather.gov/meg/march31april1tornadooutbreak), [March 24](https://www.weather.gov/meg/march242023severe), and the [May 26 MEG warning](https://mesonet.agron.iastate.edu/wx/afos/p.php?e=202405270332&pil=SVSMEG). All three fail the unchanged 7/14/21/28-day reference rules because of reported rain, wind, insufficient weather coverage or calendar/DST differences. No outage magnitude entered selection, and the thresholds were not relaxed to obtain an additional storm case.

| Candidate | Coverage result |
| --- | --- |
| December 2022 cold | 233 total observations, 65 hourly anchors, 232 grid captures, 72 temperature hours; eligible |
| January 2023 ice | 35 anchors; fails the 48-anchor minimum |
| January 2024 snow | No verified outage observations; falls in the archive gap |
| June 2023 heat | 215 total observations, 61 anchors, 72 temperature hours; eligible |
| August 2023 heat | No verified outage observations; falls in the archive gap |

Temperature comparisons use supported passing GHCNh source QC, the preceding completed weather hour, fixed additional lags of 0/1/3 hours, and thresholds below 0°C or at least 32°C. These are analytical thresholds, not official hazard definitions. Snow, ice accumulation or heat-wave duration is not inferred from temperature alone. Finalized NOAA Storm Events remain separate county/zone context.

Each reference is selected by calendar, capture timing, dry/low-wind station weather and at least 90% temperature coverage, without inspecting outage values. Each final pair additionally requires known low reference wind and nominal report-hour precipitation and a reference temperature outside the case threshold. The paired temperature extremes are report minima/maxima, not continuous measurements. Counts are **55/55/54 cold pairs** and **51/51/53 heat pairs** at the three lags. Six pairs are required for a median. All anchors, excluded pairs, source hashes, candidate references and hourly values are downloadable as JSON/CSV.

The cold case includes a map and downloadable summaries of **103 original legacy grid cells** at zero lag, using **41 paired below-freezing hours with geometry**. An absent polygon is unknown, not zero. Every cell retains its original polygon, capture IDs and observed counts; changing geometry is suppressed. Color shows each reported cell's observed peak and is not a population rate or vulnerability ranking. Airport temperature remains regional context, not an interpolated neighborhood surface. The heat case has no verified outage geometry.

The heat study follows the June 25 storm and begins with 24,679 customers already affected. Its contrast cannot separate heat from storm recovery. Both temperature cases lack sufficient short-gap coverage for a full customer-hour estimate. Unique/new incident frequencies, population-normalized legacy rates, stable geographic rankings and uncertainty intervals across independent temperature episodes remain unsupported.

Publication is offline and deterministic under `data/comparisons/conditions/`; the two existing rainfall publication files remain unchanged. The bounded comparison service merges the catalogs at read time and verifies content hashes. Browser/API reads never acquire upstream weather.

```powershell
npm run weather:screen
npm run weather:temperature-cases
python -B scripts/verify-temperature-comparisons.py
npm run dashboard:build
```

Use Python 3.11+ with IANA time-zone data. This machine's bundled runtime is `C:\Users\jpbra\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe`; `python` is not currently on the sandbox PATH. The source originals, verified legacy index and earlier publication catalogs are local prerequisites.

## Bounded ongoing weather maintenance

An isolated local runner now refreshes radar, hourly rainfall and the existing KMEM METAR display source every 30 minutes. It checks its heartbeat/stop control every 30 seconds and stops at the existing collector trial end, **September 23 at 12:04:02 PM CDT**. It installs no scheduled task or service. At this checkpoint its PID is **25608**; use the status command for current state.

The first online batch published seven radar frames, three rainfall endpoints and one rolling 24-hour METAR batch with **18 requests / 21,105,790 downloaded bytes**. The resumed runner completed its next batch at 19:03 UTC with **14 requests / 17,991,123 bytes**, no error and the shared budget lock active. At that cutoff, saved evidence occupied 288,256,490 bytes and the rolling cache 39,238,829 bytes, within the 1 GiB aggregate limit. Missing, restricted and late sources retain unavailable/backoff states. Radar is acquired with a five-minute delay and Pass 2 rainfall is retrospective; the nearest-time eligibility rules remain unchanged, so some current captures still have no eligible weather. This is bounded historical refresh, not a guarantee of live-weather availability.

`data/weather/live-cache/` is disposable and separate from saved study evidence in `data/weather/cache/`. The rolling budget is at most **256 MiB**, reduced if necessary to keep both weather roots within the existing **1 GiB** cap. The 20 GB disk floor, 24-request/96 MiB per-run limits, timeouts, source allowlist and provider backoff remain active. Radar originals/derivatives expire after **4 hours**, rainfall and METAR after **24 hours**. This choice follows the measured approximately 2.8 MB per national radar original. Saved study originals, revisions, derivatives and the outage archive are never pruned by this runner. For new saved studies, acquire/retain sources in the evidence cache before the rolling copy expires.

Saved and rolling writers share a budget lock and aggregate byte accounting, so concurrent manual preparation cannot exceed the combined cap. Pruning requires the rolling cache's exclusive lock, validates its fixed file formats and content identities, updates the serving catalog first, preserves objects shared by retained frames, and is safe to repeat after interruption. Unsupported evidence products in that root stop cleanup. The live dashboard merges eligible rolling entries with saved weather; failure of the rolling catalog does not disable saved studies or outage capture.

```powershell
npm run weather:status
npm run weather:stop
# Manual bounded refresh, respecting the saved next-due time:
npm run weather:maintain -- --download
# Foreground runner through the existing trial end:
npm run weather:maintain -- --download --run
```

A deliberate stop creates `data/weather/maintenance/stop`; remove that file only when intentionally resuming the same unexpired trial. An existing writer/runner lock is not automatically discarded: verify the recorded process has exited before recovery. Logs are `reports/weather-maintenance.stdout.log` and `reports/weather-maintenance.stderr.log`.

The saved GHCNh quality policy remains conservative. Unsupported source/QC codes are excluded; unqualified METAR reports remain a separate display source and are not silently substituted into quality-controlled historical comparisons.

## Desktop-transfer core and rehearsal

`src/durable/transfer.mjs` implements immutable, checksummed, bounded gzip parts with an observation-to-file index; strict part and file validation; resumable exact-range downloads; a 20 GB destination floor; a local SQLite verification catalog; portable restore; and HMAC-authenticated verification receipts. It includes an HTTPS range transport with no redirects. No credential is saved to source, logs or a public route.

The actual September 16 capture partition was bundled and downloaded to an isolated temporary desktop folder: **89 captures, 356 files, one 501,124-byte compressed part**. Original payloads, capture metadata, parser source and normalized replay results are retained. All 89 captures restored into a new SQLite index and replayed to identical normalized data and totals. Repeating the download made no extra source requests.

The pure cleanup-eligibility calculation requires authenticated independent receipts, a seven-day trusted receipt-receive grace period, a verified restore, every observation strictly older than one calendar year, and a complete inventory of keys still referenced by protected observations. Leap-day boundaries are tested. Shared protected payloads are excluded. It returns a **non-executable plan**, keeps metadata, and deletes no source files. The forecast includes storm growth, 30 offline days, seven grace days, staging and other account usage; it reports when the newest year cannot fit.

```powershell
npm run archive:verify-transfer
```

This completes local protocol preparation and a real-data restore rehearsal, **not Phase 4B deployment**. Provider-backed manifest generation/transactions, durable receipt receiving and cleanup journals, Windows-protected machine credentials, destination installation and a scheduled downloader still depend on a validated cloud archive and account setup. The provisional archive destination remains unchanged. No live source detail was removed.

## Verification and remaining dependencies

- All **172 Node tests** and **26 legacy Python tests** pass. New tests cover temperature eligibility, sparse and missing reference data, lag causality, absent/changing polygons, publication integrity, weather retention, range resume, full disk, corruption, receipts, shared protected keys and calendar-year boundaries.
- Independent Python verification checks original station PSV, finalized event identities, SQLite observations, every candidate reference, every lag pair/median and every published grid polygon. Offline publication replay produces the same catalog hash.
- TypeScript/build, local dashboard API/stress checks, desktop/390-pixel phone layouts, case/lag switching and browser console checks pass. All interface text checked in the new view is at least 16 px. The current-feed collector continued without restart. At 2026-09-18T19:01:18.284Z, it had **606/606 valid slots**, 0 gaps over ten minutes, 0 pending rollups and runner status ok. The dashboard runs as PID 15584.
- A fresh full archive restore at the 18:40 UTC capture cutoff replayed **602/602 captures**, with no pending rollups. Current runtime counts continue to grow; use the status command.
- The existing password-protected Quick Tunnel serves all four cases, all lags, exact JSON/CSV and cold geometry with its original **3:06 PM CDT** expiry. Authentication and archive/admin/write denials remain intact. It was not extended or replaced.
- `npm run collector:accept-trial` now checks the original trial completion marker, whole-window/slot coverage, final capture, long gaps, failures, storage, rollups and a fresh complete restore. It currently reports **awaiting-trial-end**, not acceptance. Run it after September 23 at 12:04:02 PM CDT; this checkpoint does not create a scheduled Codex follow-up.

The read-only Cloudflare dashboard check reached **Sign in to Cloudflare**; no authenticated account session was available. The current process also had no configured Cloudflare API token/account ID, and the checked local Wrangler config path was absent. Provider compute/quota/free-plan benchmarks and production adapters/deployments remain gated by that setup. The newest-year cloud retention constraint cannot be verified with a local test. The two legacy reconciliation exceptions still lack the required independent source/time evidence; the long archive gap remains missing. Additional independent storm comparisons, snow/ice analysis and local exposure/population rankings are constrained by the failed coverage/reference screens rather than by a missing UI.

The design's automatic replay play/pause, arbitrary episode selection and synchronized side-by-side rainfall/outage heatmaps remain unimplemented interface extensions. The current interface uses manual slider/arrow replay and four prepared cases. This checkpoint also does not install operation beyond the original trial, a Windows startup task or automated notifications; those remain distinct from the bounded runner and analysis work completed here.

Machine-readable evidence is under ignored `reports/`: `weather-candidate-screen.json`, `temperature-comparison-{preparation,verification,replay}.json`, `archive-transfer-verification.json`, `collector-trial-acceptance.json`, `development-tests.log`, `development-python-tests.log`, `durable-verification.json`, and `preview-verification.json`. These files may be refreshed by subsequent commands; the measurements above are this dated checkpoint.
