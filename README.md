# MLGW outage collection

**Technical audit implementation:** deterministic archive recovery, schema-2 rebuilds, durable publication, isolated request quotas, clearer data-quality warnings, Linux deployment rollback, CI/browser checks and daily verified PC backups are described in [the implementation record](reports/TECHNICAL_AUDIT_IMPLEMENTATION.md). Cloud monitoring is prepared but remains unconfigured by choice. Current operational results and recovery commands are in [the deployment runbook](reports/DIGITALOCEAN_DEPLOYMENT.md).

**September 22 cloud deployment:** the dashboard is live at **https://64.225.60.118** on the selected $12/month DigitalOcean VM. Five-minute outage collection and 30-minute rolling weather refresh now run under Linux services. The local collectors are stopped after a verified handoff of all 1,722 archived attempts, saved weather evidence, legacy history and four comparison cases. The PC can be offline while cloud collection continues. See [deployment, SSH, health checks and backup instructions](reports/DIGITALOCEAN_DEPLOYMENT.md).

Use `npm.cmd run deploy:verify` to check public access and `npm.cmd run deploy:backup` to download a verified cloud backup. Local `collector:status` and `weather:status` commands describe the stopped PC runners. Do not start a second local collector while cloud collection is active. The local trial ended by cloud handoff; it is not recorded as passing its original seven-day acceptance gate.

Implementation of [the design plan](DESIGN_PLAN.md): the source pilot, durable collector, historical outage dashboard and prepared weather/rainfall views. Start with [current project status and the documentation index](reports/PROJECT_STATUS.md), updated September 22, 2026. Phase reports retain dated implementation evidence; their old counts, PIDs, timings and preview sessions are historical checkpoints.

DigitalOcean now hosts collection, archives and the public read-only dashboard. Existing local evidence remains intact. The September 18 Quick Tunnel and earlier local operating measurements below are historical. The Cloudflare runtime probe remains an unused alternative. All 187 Node tests passed in Linux with a 1 CPU / 2 GB limit before deployment; saved history was restored and checked again on the VM.

## Run locally

Requires Node.js 24 or later, including its built-in SQLite module. No packages need to be installed for the local pilot, collector or tests; building the frontend requires `npm ci`. Run commands from this directory. In Windows PowerShell, use `npm.cmd` if execution policy prevents `npm.ps1` from running. Captures, weather originals, credentials and generated builds are ignored by Git, so a fresh checkout does not contain the existing history or prepared weather. The commands below support local development and replay; collection now runs on the VM.

```powershell
npm test
npm run benchmark
npm run storage
npm run analyze
```

`pilot` captures the public GeoJSON and HTML summary every five minutes for a 24-hour window, then stops after a final observation at/after the end. It records each request's own UTC timestamps. `pilot:once` captures one observation while respecting any existing next-due/backoff time. The process must remain running and the PC must stay awake and connected. It does not change Windows power settings, install a service, or start at boot. Network access may need sandbox approval.

The pilot window began September 16, 2026 at 11:37:51 AM CDT and **completed September 17 at 11:40 AM CDT** with its final observation after the 24-hour boundary. The scheduled 12:15 PM CDT review verified **290/290 observed slots**, matching HTML totals and exact archive replay; see [the completed source review](reports/PHASE1_STATUS.md). The seven-day collector then continued directly at the 11:45 AM CDT slot. `data/pilot/state.json` preserves the completed window and historical PID; do not restart it as a new pilot. `reports/pilot*.stdout.log` and `reports/pilot*.stderr.log` contain its background output. Verify a PID's identity before stopping any process because PIDs can be reused.

If interrupted before the end of its window, `npm run pilot` resumes from its state, skipping missed slots. It does not fabricate past observations. An expired/completed window must be reviewed before beginning a new one; preserve its directory and reports rather than deleting evidence. A stale process lock is reclaimed only if its owner PID no longer exists. A restriction response (401/403) stops collection and requires source-access review. A 429 pauses both source requests until at least `Retry-After`; transient failures back off. All accepted HTTP bodies are saved before parsing; oversized/time-out responses are recorded as failures.

## Files

- `src/contract.mjs`: portable parser, explicit Central-time assumption with DST ambiguity handling, and meaningful-change comparison.
- `src/pilot-io.mjs`: bounded HTTP capture, selected response headers, hashes, gzip measurements and immutable per-attempt evidence.
- `scripts/analyze.mjs`: observed span/coverage, gaps, byte versus meaningful changes, totals comparisons, ID changes and size distributions.
- `scripts/benchmark.mjs`: ordinary/4,000/10,000-feature tests and reproducible storage scenarios. Windows process CPU is a local diagnostic; it does not establish a Cloudflare CPU pass.
- `scripts/storage-alternative.mjs`: byte-exact gzip/replay verification for all fixture sizes and a capacity model for compressed originals plus a 48-hour normalized cache.
- `test/fixtures/`: a saved public source fixture and its provenance. Tests run without network access.
- `data/discovery/`: initial page, feed and robots responses with retrieval metadata.
- `data/pilot/`: private local capture evidence, attempt records, normalized diagnostic output and state.
- `data/fixtures/`: generated synthetic storm fixtures. They must not be imported as observed outages.
- `reports/benchmark.json`, `reports/pilot-summary.json`: regenerated machine-readable measurements, excluded from version control along with raw pilot data.

The parser emits null totals on invalid IDs/counts or duplicate IDs. It flags invalid/out-of-area geometry without discarding counts. Unknown fields and raw timestamps survive in the original archive. The normalized representation excludes cause text from the future public display. It is a diagnostic shape, not a finalized production schema.

## Phase 2 local collector

The local run stopped for cloud handoff on September 22 at 13:56:33 UTC, after its 13:55 capture. Its preserved state records `stopReason=cloud_cutover`. The following commands inspect or replay local evidence; production uses separate state and Linux services described in the [deployment guide](reports/DIGITALOCEAN_DEPLOYMENT.md). The original local run mirrored the source pilot and then collected directly.

```powershell
npm run collector:status
npm run collector:import
npm run collector:recover
npm run collector:replay -- 'REPLACE_WITH_CAPTURE_ID'
npm run collector:verify
```

`status` checks current freshness, runner heartbeat, observed slot coverage and storage pressure. `import` indexes completed source-pilot captures without another network request. `recover` verifies archived bodies/parsers and indexes any manifests left pending by a failed transaction. `replay` reconstructs a capture from its compressed original with the saved parser. `verify` runs isolated 4,000/10,000-feature archive/replay checks and restores the real archive into a separate temporary database; it never adds synthetic data to the live index.

For an interrupted local trial that has not stopped or completed, `npm run collector:run` preserves its recorded window and skips missed observation slots. The existing PC trial is stopped for cloud handoff and must remain stopped while the VM collects. Its latest pre-handoff end time was September 22 at 17:00 UTC; the original September 23 deadline is historical. Source restrictions or urgent storage pressure retain a recorded reason. Do not erase state or archived history to hide gaps.

Paths:

- `config/collector.local.json`: cadence, seven-day duration, storage budget and pressure thresholds; automatic deletion is disabled.
- `data/collector/archive/objects/`: immutable gzip bodies addressed by the original-body SHA-256.
- `data/collector/archive/manifests/`: one immutable observation record per attempt, including failure evidence and parser provenance.
- `data/collector/archive/parsers/`: the source parser version used for historical replay.
- `data/collector/index.sqlite`: compact capture index, totals, recent comparison cache, leases and queued rollups. SQLite WAL/SHM files may be present while running; do not copy only the database file as a live backup. The separate immutable archive can rebuild the index.
- `data/collector/inbox/`: local diagnostic captures made after the pilot-to-collector handoff and before cloud cutover. These remain alongside the canonical archive on this PC. Production uses separate temporary staging.
- `reports/collector*.log`, `reports/collector-health.json`, `reports/durable-verification.json`: runtime logs, health and restore evidence.

Only one publication per actual five-minute slot is accepted. Failed/suspect captures do not advance the latest trustworthy snapshot. A failed database transaction leaves raw evidence available for retry. Original and HTML request times remain separate. Rollups store coverage alongside customer-minutes and never fill collection gaps with zero outages.

The local status command is an on-demand check of the saved PC state. Production has a separate two-minute systemd health timer; external notifications and Windows startup tasks are not installed. Filesystem/SQLite restore and runtime behavior were verified on the DigitalOcean deployment. Cloudflare-specific tests remain an unused alternative.

`npm run collector:accept-trial` remains a local trial evaluator. It requires recorded completion and checks coverage, failures, storage, rollups and restore behavior; it never restarts or extends a trial. The existing run ended by cloud handoff, so reaching the former September 23 deadline cannot make it an accepted seven-day trial. Production verification uses the deployment guide and `deploy:verify`.

The local desktop-transfer core can be rehearsed with `npm run archive:verify-transfer`. It creates bounded, checksummed bundles from real captures, resumes downloads into an isolated temporary folder and restores/replays them. The [transfer checkpoint](reports/DEVELOPMENT_COMPLETION_STATUS.md#desktop-transfer-core-and-rehearsal) documents the verified 89-capture rehearsal. The deployed `deploy:backup` command separately downloads verified full backups over SSH. Recurring scheduling, cloud receipt transactions, cleanup journals and automatic history offload remain uninstalled; the API token and SSH key stay local and ignored by Git.

## Phase 3 local dashboard

The deployed dashboard is **https://64.225.60.118**. A development copy can run at **http://127.0.0.1:4173**, reading the stopped PC archive without changing captures. Rebuilding or restarting a local copy does not update the VM. Start or rebuild it with:

```powershell
npm ci
npm run dashboard:build
npm run dashboard
```

The page links historical maps, totals and charts; offers 24h/7d/30d chart views; explains gaps, freshness and anomaly rules; and exports bounded CSV or the selected GeoJSON. Daily peaks and archive date groups are labeled UTC; other displayed times use Central. See [Phase 3 status](reports/PHASE3_STATUS.md) for checks and limits.

Select **Heatmap** above the map to see reported outage activity across the available archive or the last 6h/24h/7d/30d. The heatmap smooths distinct provisional source ID/start pairs in a fixed, roughly 1 km grid. Repeated polls count once. A 750 m Gaussian bandwidth, truncated at 2.25 km, shows nearby activity together; a square-root color scale keeps isolated locations visible. The density scale uses the whole selected period and does not change when panning or zooming. Tapping an underlying area shows its first/last observations, peak simultaneous customer count and uncertain identities. These are reported activity near a location, not service areas or confirmed unique incidents/households. Moving events can appear in several cells. Only current-format captures collected locally before cutover or subsequently on the VM are included here; older history has its own **Legacy archive** page. **One capture** restores the map, totals and arrow replay controls for a single observation.

Select **Per capita** for a Census block-group choropleth. **Measure** switches between provisional outage events and peak simultaneous customers affected, each per 1,000 estimated residents. Original outage points are assigned to the full Census polygons, not to heatmap cell centers. The denominator is the latest available block-group population release as checked September 16, 2026: [2020–2024 ACS five-year estimates](https://www.census.gov/programs-surveys/acs/news/data-releases/2024/release-schedule.html), table [B01003](https://data.census.gov/table/ACSDT5Y2024.B01003), with matching 2024 TIGERweb boundaries. Popups retain the estimate and its 90% margin of error. Block-level population is older decennial data; newer boundary vintages alone do not make population estimates newer.

Per-capita rates are location-based proxies: utility customers are accounts, not people, and an outage point can represent customers across multiple block groups. These maps do not estimate the share of residents without power. Outside-county and boundary-ambiguous points are excluded and counted. Gray means no rate because population is zero/missing or there are no verified captures; white means no assigned events in verified captures, not proof of uninterrupted power. A large or unavailable population margin of error is flagged in the popup. Coverage gaps remain unknown. Fixed legend intervals make rate colors consistent across map movements and selected periods; event rates still depend on the selected period's length and coverage.

The compressed public reference file and provenance are described in [reference/README.md](reference/README.md). It contains 685 Shelby County block groups, reconciling to 919,173 estimated residents, and is about 574 KiB. Regenerate from cached sources with `node scripts/prepare-census.mjs`, or explicitly refresh the pinned official sources with `node scripts/prepare-census.mjs --download`. It never accesses outage captures. The dashboard uses the local reference; population is not fetched on each view.

Historical maps replay hash-verified originals through the read-only `/api/series?view=spatial&from=...&to=...` route. Add `geography=block-group` for per-capita results; `/api/config?view=census` provides the static public geometry and provenance. Missing detail and coverage remain explicit. Requests are limited to 31 days, one million feature observations, 50,000 provisional events and ten seconds of replay; a limit failure asks for a shorter period rather than returning a partial map. Only one historical replay runs at a time. The deployed public dashboard serves these reads; historical password-preview checks are recorded separately.

Dashboard design: a plain utility outage monitor, with the Memphis/Shelby County map dominant, compact inline totals, and a smaller history chart. Use ggplot2 [`theme_minimal`](https://ggplot2.tidyverse.org/reference/ggtheme.html) aesthetics: a white plotting surface, faint gray major/minor gridlines, black marks, no panel border or axis tick marks, and plain sans-serif type. The interactive chart remains in Chart.js; `web/ggplot-theme.ts` supplies its thinner minor gridlines. Sharp rises use larger black triangles, and the selected capture uses a dashed black line. The geographic basemap is grayscale with black outage points. Do not use emojis or decorative glyphs. Previous/next capture controls use simple drawn SVG arrows with accessible labels; exports use text. Retain only functional data symbols. Avoid rounded cards, shadows, gradients, badges, KPI tiles, decorative marks, forced symmetry, elaborate typography hierarchies and unnecessary motion or explanations. Keep detail in expandable Data notes. All interface text, chart labels/tooltips and map controls use at least 16 CSS pixels (12 pt), including on phones, overriding ggplot's smaller text defaults. OpenStreetMap's raster basemap has its own embedded place labels. The subject should determine the layout; avoid generic reusable dashboard styling.

`npm run dashboard:verify` checks 4,000/10,000-feature API replay in separate temporary archives. `npm test` remains offline and does not require the frontend packages. The frontend build uses the pinned packages in `package-lock.json`.

The server binds only to `127.0.0.1`, defaults to port 4173, and has no collector/admin mutation routes. Set `DASHBOARD_PORT` to change the local port. Set `DASHBOARD_TILES` to an HTTPS `{z}/{x}/{y}` tile template, with `DASHBOARD_TILE_ATTRIBUTION` and `DASHBOARD_TILE_ATTRIBUTION_URL` matching its provider. An explicitly empty `DASHBOARD_TILES` disables basemap requests. By default, the browser downloads visible OpenStreetMap tiles with attribution; application assets and outage data are served by the chosen dashboard host. The production Node server also binds to loopback, with Caddy providing public HTTPS through the configured `PUBLIC_ORIGIN`. No Windows startup task is installed; production starts through systemd. The historical temporary preview is described below.

Client source is in `web/`; the read-only API is in `src/dashboard/`. Generated `dist/dashboard/` files are ignored. Rebuild after client changes and restart only the dashboard after server-code changes. Local log names depend on the launch command; the September 18 checkpoint used `reports/dashboard.legacy.stdout.log` and `reports/dashboard.legacy.stderr.log`. Production logs use `journalctl -u mlgw-dashboard`. Verify a local PID/command line before stopping it, and use the deployment guide for VM operations.

## Local weather controls and cache

The local Phase 3A checkpoints validate timestamped radar, numeric one-hour rainfall, Memphis station records and warning samples, and connect prepared weather to the dashboard. See [weather findings and limits](reports/PHASE3A_STATUS.md). Weather data is stored separately under ignored `data/weather/`.

In **One capture**, the **Weather** selector offers radar reflectivity and preceding one-hour rainfall, with opacity, legends, attribution and exact matched times. Radar must be less than five minutes before the capture; a rainfall endpoint must be less than 60 minutes before it. No future or arbitrarily old image is substituted. **Memphis airport weather** expands a regional 24-hour temperature or wind/gust plot from routine/special KMEM METAR reports. Missing weather remains explicit. Heatmaps and per-capita period maps hide these capture-specific controls.

```powershell
npm run weather:validate
npm run weather:quality
npm run weather:events
npm run weather:validate -- --download
npm run weather:validate -- --download --case=wet
npm run weather:prepare
npm run weather:prepare -- --download
npm run weather:prepare -- --samples
```

`weather:validate` defaults to offline replay of saved originals. Its `--download` option requests the four fixed sample cases (wet, dry, winter and September 16, 2026), or only the case selected with `--case`, reusing verified cached bodies. The `current` case is pinned to September 16, not a moving live query. `weather:prepare` has different download behavior, described below. Node 24 is sufficient; no new runtime packages are required. The optional `python scripts/verify-weather-pixels.py` cross-check requires Python, Pillow and NumPy and reads the preceding validation report.

`weather:quality` is offline-only and interprets five saved GHCNh station windows, including a recently available sample and the missing September 16 sample. It preserves source-specific quality/measurement codes and separates accepted, trace, missing and excluded values for temperature, dew point, wind/gusts and precipitation. Only documented passing codes qualify; newer unsupported source families remain excluded. Nominal hourly precipitation selects a final routine report without summing interim running totals. `weather:validate` also emits these quality derivatives. This does not change the dashboard's separate as-reported METAR series. See [station quality results and limitations](reports/STATION_QUALITY_STATUS.md); `python scripts/verify-station-quality.py` independently checks derivative provenance using only the Python standard library.

`weather:events` replays six fixed event/warning cases offline. Add `-- --download` to retrieve missing originals or `-- --case=winter` to select a case (`wet`, `dry`, `winter`, `heat`, `francine`, `current`). It uses pinned NOAA annual detail releases and exact-time IEM warning snapshots with preserved county/zone boundaries. Shelby county and forecast-zone records remain separate; event periods and warning instants do not imply the same coverage. Missing current archive months are explicit, reported event endpoints are not damage polygons, and warning data includes retrospective updates. This command validates saved event context; the separate comparison publisher includes that context with its original time and coverage limits. See [event context results](reports/EVENT_CONTEXT_STATUS.md); `python scripts/verify-event-context.py` independently checks source selection, UTC times and geometry provenance using only the standard library.

`weather:prepare` prepares the last 30 minutes for display, using saved originals by default. Its `--download` option explicitly fetches missing radar frames, hourly rainfall endpoints and a 24-hour airport batch ending at a completed UTC hour. To select a saved interval, supply both `--from=2026-09-17T04:00:00Z --to=2026-09-17T04:30:00Z`; boundaries must be five-minute timestamps and at most 45 minutes apart. `--samples` prepares the earlier validation cases. This command is a bounded manual job. The cloud weather service refreshes recent weather every 30 minutes without a trial deadline; opening the page never fetches upstream weather. Reload the page after preparing data. Read-only `/api/weather?at=...` and content-addressed PNG routes serve only prepared, verified local assets. The historical samples do not create historical outage records.

The manual local weather jobs cap shared storage at **1 GiB**, responses at 32 MiB, downloads at 96 MiB and requests at 24 per run, with a 20 GB free-space floor. The production rolling-weather service overrides the free-space floor to 5 GB and limits its disposable portion to 256 MiB within the same shared cap. It stops on pressure and never automatically expires source evidence. `config/weather.local.json` records these limits. Annual station files stay pinned unless explicitly refreshed with `npm run weather:refresh-station -- --year=2026 --download`. A refresh retains earlier originals and content-addressed manifest revisions; a failed retrieval leaves the prior successful snapshot available and persists provider backoff. Saved analyses retain their original source hashes. Refreshing does not republish the airport timeline or schedule ongoing collection. Saved and rolling weather writers also share `data/weather/budget-writer.lock` to enforce the aggregate 1 GiB limit across concurrent jobs. A stale writer or budget lock after a crash requires checking its PID and process command before removing only the verified stale lock; it must not be removed while another weather job is running. The weather job does not read or alter the outage archive.

Station originals are stored losslessly as `objects/<original-sha256>.raw.gz`. Manifest hashes and byte counts still describe the exact uncompressed provider body. Readers accept both compressed and legacy `.raw` objects, verify the original SHA-256, and bound decompression by the recorded original length and response limit. Other products keep their existing representation. `npm run weather:compress-stations` previews migration of retained station originals; add `-- --apply` to write and verify compressed files before removing only redundant `.raw` copies. The migration uses the writer lock, makes no downloads, preserves all source revisions, and can resume after an interruption. See [storage and pilot validation](reports/STORAGE_AND_PILOT_STATUS.md).

The new [NOAA GHCNh](https://www.ncei.noaa.gov/products/global-historical-climatology-network-hourly) station files replace the planned ISD path. The explicit September 17 refresh extends the 2026 Memphis snapshot from August 26 through **September 9 at 16:54 UTC**, so that source's September 16 sample is still missing. A separately labeled [IEM/NWS METAR feed](https://mesonet.agron.iastate.edu/request/download.phtml?network=TN_ASOS) provides recent airport observations, as reported without additional quality control. These are separate series; trace, zero, missing values and raw reports are preserved, and overlapping hourly precipitation reports are not summed.

Select **Rainfall** above the map for prepared 24/48/72-hour totals, ending times, opacity and native-cell details. Coverage and exact intervals remain visible. The outage chart and its CSV use the same interval. Prepared dates now include June 2023 and the September 2024 Francine case, each covering all 685 Census block groups. The current-feed chart explicitly shows missing captures for these dates; the separate legacy archive and Weather comparisons page use verified historical regional totals. Changing duration preserves the ending date when available. A fixed accumulated-depth legend distinguishes totals through 150 mm and above across all periods. See the [broader weather checkpoint](reports/WEATHER_PERIODS_STATUS.md).

The separate **Weather comparisons** page adds regional cases and matched reference periods. See [historical weather comparisons](#historical-weather-comparisons) below for the current preparation order, prerequisites, routes and interpretation limits.

### Automatic weather refresh

The cloud `mlgw-weather` service refreshes recent radar, hourly rainfall and KMEM METAR display data every 30 minutes without the local trial's end date. Use the [cloud operating commands](reports/DIGITALOCEAN_DEPLOYMENT.md) for current status and stopping. Local `weather:status` / `weather:stop` address only the stopped PC runner. Neither runner refreshes annual GHCNh files or saved case studies.

Disposable weather lives in `data/weather/live-cache/`, capped at 256 MiB within the shared 1 GiB weather budget. Radar expires after four hours; rainfall and METAR expire after 24 hours. Saved study evidence in `data/weather/cache/` never expires through this runner. The dashboard merges both prepared catalogs; opening a view never starts acquisition. Recent weather can still be unavailable because of source latency and matching tolerances.

For a separate manual local refresh, first check that no maintenance runner owns its lock. `npm run weather:maintain -- --download` performs one bounded refresh when due. Its `--run` option belongs to the former local trial, which must not be resumed while cloud collection is active. The PC stop marker is `data/weather/maintenance/stop`; production uses different paths listed in the deployment guide. Verify a lock owner's process has exited before recovering a stale lock. See [maintenance bounds and recovery](reports/DEVELOPMENT_COMPLETION_STATUS.md#bounded-ongoing-weather-maintenance).

### Prepared multi-day rainfall

Run `npm run weather:validate-window` to replay the default June 24–26, 2023 originals offline, then `npm run weather:prepare-periods` to publish its verified assets. Both accept `-- --config=config/rainfall-francine-2024.json` to select the prolonged-rain case. Neither fetches upstream data. Publication updates the selected periods together and preserves other dates and single-capture layers.

To acquire or resume a selected sample, run `npm run weather:collect-window -- --config=config/rainfall-francine-2024.json --batch=1 --download`, followed by batches `2` and `3`. Omitting `--download` verifies saved hours only. Progress is checkpointed after each hour; rerunning a batch verifies and reuses completed originals. SIGINT/SIGTERM stops between hours and releases the writer lock. A hard process termination still requires the stale-lock check above. Custom JSON configurations use hourly UTC `from`/`to` boundaries spanning 24, 48 or 72 hours, `hoursPerBatch` from 1 to 24, optional supported `periodHours`, and a unique `reportId` such as `rainfall-my-case` so reports do not overwrite another case. All jobs share the existing global cache limit.

Optional independent verification is `python scripts/verify-rainfall-window.py --report=reports/rainfall-francine-2024-validation.json` with Pillow/NumPy. The [weather-period checkpoint](reports/WEATHER_PERIODS_STATUS.md) records prolonged-rain, interruption, missing-data and resource checks. Cache use was **189.9 MiB** at the event/warning checkpoint and **273.36 MiB of 1 GiB** after matched-reference preparation. The separate bounded rolling refresh/retention runner is now implemented; saved study evidence never expires through that runner. Additional station source families remain future validation work. Verified legacy history and initial rainfall/wind comparisons are available on their separate pages.

## Historical weather comparisons

Open **Weather comparisons** at [the deployed dashboard](https://64.225.60.118/legacy.html?view=comparisons), or the corresponding route on a local development copy. Four 72-hour cases pair verified legacy regional totals with eligible weather and matched references. Aligned charts, 0/1/3-hour additional weather lags, condition groups, coverage, archived context and CSV/JSON downloads retain missing values and source provenance.

| Case ID | UTC case window, end exclusive | Weather and geographic scope | Eligible pairs at lag 0 / 1 / 3 |
| --- | --- | --- | --- |
| `june-2023` | June 24–27, 2023 | Rainfall/wind; regional totals only | 50 / 50 / 49 |
| `september-2024` | September 12–15, 2024 | Rainfall/wind; regional totals only | 59 / 59 / 57 |
| `cold-2022` | December 22–25, 2022 | Below-freezing airport temperature; original legacy-grid summaries | 55 / 55 / 54 |
| `heat-2023` | June 29–July 2, 2023 | Airport temperature at least 32°C; regional totals only | 51 / 51 / 53 |

The cold case maps 103 original grid cells from 41 paired below-freezing hours with geometry at zero additional lag. Missing polygons remain unknown; changing geometry is suppressed. These are observed cell peaks, not population rates or local temperature estimates. The heat case begins during recovery from the June 25 storm, with 24,679 customers already affected. None of the four cases supports a complete customer-hour estimate, unique/new incident counts or causal attribution.

Matched references compare the same weekday and local clock hours using one actual capture near each half hour. References are selected using calendar, capture availability and station weather, without ranking outage counts. Rainfall/wind pairs require low reference regional rainfall and airport wind for the preceding weather hour. Temperature pairs require known low reference nominal station precipitation/wind and temperature outside the case threshold. Six eligible pairs are required for a median; sparse groups remain unavailable. See the [rainfall/wind matching rules](reports/WEATHER_REFERENCE_STATUS.md), [initial case methods](reports/WEATHER_COMPARISON_STATUS.md) and [temperature methods](reports/DEVELOPMENT_COMPLETION_STATUS.md#weather-cases-and-geographic-scope).

```powershell
npm run weather:select-references
npm run weather:comparisons
python scripts/verify-weather-references.py
npm run weather:screen
npm run weather:temperature-cases
python -B scripts/verify-temperature-comparisons.py
npm run dashboard:build
```

These are offline preparation/replay commands and require the retained legacy index, originals and validated rainfall reports. The reference checkpoint documents rainfall validation commands. Restart only the dashboard after publication; keep the collector running. Preparation verifies source hashes and atomically promotes immutable data under ignored `data/comparisons/`. Browser reads never acquire weather. Weather cache use was 273.36 MiB at the matched-reference checkpoint; use the cloud service state in the deployment guide for current rolling/evidence measurements. Local weather status describes the stopped PC runner.

Read-only JSON is `/api/legacy/series?view=comparison&id=june-2023&lag=0`; CSV is `/api/legacy/export.csv?view=comparison&id=june-2023&lag=0`. Substitute any of the four case IDs above; supported lags are 0, 1 and 3. Add `&table=reference` for all 72 paired rows, including exclusions. The combined catalog is `/api/legacy/catalog?view=comparisons`. Rainfall/wind publications use `data/comparisons/catalog.json`; temperature publications use `data/comparisons/conditions/catalog.json`. The cold-grid summaries and polygons are included in its JSON download. The password-protected preview serves these routes while its session remains active.

The [autonomous continuation](reports/DEVELOPMENT_COMPLETION_STATUS.md) completed the additional-candidate screen. None of the three rainfall/wind candidates qualified under the unchanged reference policy. Two eligible cold/heat cases are published through a separate immutable catalog, with original-grid cold summaries. The local trial later stopped for the September 22 cloud handoff; production continues on its independent schedule.

## Legacy history audit and staging

Open **Legacy archive · 2022–2025** at [the deployed dashboard](https://64.225.60.118/legacy.html), or the corresponding route on a local development copy. The separate view offers UTC month/date navigation, Central-time capture replay, observed daily peaks, detailed day charts, original grid polygons and bounded CSV/GeoJSON exports. Totals without geometry display an explicit unavailable map. Empty months, the 291-day gap, unresolved time and unreconciled original remain visible; empty event tables never become zero totals. Current-feed heatmaps, per-capita maps, anomalies and rainfall charts keep their existing source scope.

Prepare the separate local read model from the verified recovery/coverage inputs with `npm run legacy:prepare`, then independently verify it with `python -B scripts/verify-legacy-dashboard.py`. Build the client and restart only the dashboard after publication; keep the collector running. The ignored `data/legacy/dashboard/catalog.json` points to a hash-verified, read-only SQLite index (77.1 MiB). Preparation is offline and reproducible; original catalogs and archives remain unchanged. See [integration checks, routes and limitations](reports/LEGACY_DASHBOARD_STATUS.md). A fresh checkout needs the retained audited inputs before preparation can succeed.

The [three-repository audit](reports/LEGACY_HISTORY_AUDIT.md) found that the first two repositories' consolidated totals and valid grid records are already contained in repository 3. Staging preserves 53,274 distinct total observations and 18,906 grid snapshots with all repository/commit provenance. The separate [verified timezone recovery catalog](reports/LEGACY_TIMEZONE_RECOVERY.md) resolves 53,273 total observations and all grid snapshots, preserving one unresolved total and every original value. The subsequent [capture-coverage audit](reports/LEGACY_COVERAGE_AUDIT.md) inventories 53,679 captures, including repository 1's deleted directory in Git history, and distinguishes 2,211 empty event tables from zero outages. It records timeline gaps and one additional nonempty original for reconciliation. The reports document offline replay. The [legacy dashboard integration](reports/LEGACY_DASHBOARD_STATUS.md) now serves the resolved observations in a separate read-only view with explicit gaps and exclusions.

Overlap replay requires Node 24+, base R (`Rscript`) and Python 3.11+. The separate [timestamp evidence checks](reports/LEGACY_TIMESTAMP_FINDINGS.md) also need IANA timezone data, supplied by Python's `tzdata` package in this Windows runtime. Run from this repository root. The commands read only the supported legacy schemas and never execute old scraper jobs.

```powershell
npm run legacy:inventory
# Initial acquisition only, if pinned inputs are missing:
# npm run legacy:inventory -- --download

$legacyInventory = Get-Content data/legacy/inventory.json -Raw | ConvertFrom-Json
foreach ($legacyOriginal in ($legacyInventory.originals | Sort-Object blob -Unique)) {
  $legacyKind = if ($legacyOriginal.path -eq 'total_outages.rds') { 'totals' } else { 'polygons' }
  Rscript --vanilla scripts/export-legacy-rds.R $legacyKind $legacyOriginal.local "data/legacy/export/$($legacyOriginal.blob)"
  if ($LASTEXITCODE -ne 0) { throw 'Legacy export failed' }
}
python -B scripts/audit-legacy-data.py
python -B scripts/verify-legacy-stage.py
Rscript --vanilla scripts/verify-legacy-stage.R
python -B -m unittest discover -s test -p 'legacy*_test.py'
```

The inventory uses saved pins and defaults to offline operation. Explicit acquisition is limited to the three supplied public repositories, 55 requests, 128 MiB per consolidated file and 256 MiB per invocation. It downloads pinned consolidated originals and tree metadata, without cloning full Git histories or fetching credential/config files. `data/legacy/` holds the source originals, compressed exports, staged JSONL and independent verification projections. Check each command's successful exit before proceeding; the audit report's source/catalog hashes must match before staged records are used. Repeated source times merge provenance; different capture times remain separate even when their payloads match. Unqualified timestamps remain unresolved rather than receiving an assumed UTC offset.

## Outage-location analysis

The September 21 [point-location audit](reports/POINT_LOCATION_AUDIT.md) measured exact recurrence and coordinate/count changes from hash-verified originals. The [location dataset prototype](reports/LOCATION_DATASET_FEASIBILITY.md) provides queryable SQLite and GeoJSON with provenance, and preserves stable identities when extended to later captures. It describes reporting locations and source records; physical service groups and footprints remain unverified. Generated datasets stay local under ignored `data/derived/`; automatic refresh and public dashboard integration are not implemented.

## Temporary phone preview

**Historical preview procedure:** current public access is https://64.225.60.118 and does not use the old preview password. The September 18 Quick Tunnel ran from **7:06:19 AM CDT / 12:06:19 UTC** with an automatic expiry at **3:06:19 PM CDT / 20:06:19 UTC**. Its checks and the procedures below are retained for a separately requested future local preview; old session links and passwords are not current access instructions.

The user authorized temporary password-protected HTTPS access through Cloudflare Quick Tunnels on September 16 and explicitly requested new deployments on September 17 and September 18. `scripts/preview.mjs` runs a separate gateway on loopback port 4174 and a standalone, signed `cloudflared` process; it installs no Windows service and changes no router/firewall settings. The gateway forwards only authenticated, allowlisted read routes to the local dashboard on port 4173. Its metrics listener is loopback-only on port 4175 and is not routed publicly. These three ports are fixed in the preview supervisor; a dashboard launched with another `DASHBOARD_PORT` is not compatible with this preview configuration.

The first run expired automatically at 9:40 PM CDT on September 16. The replacement requested September 17 started at **5:57:53 AM CDT**, with a scheduled expiry of **1:57:53 PM CDT that day** (`2026-09-17T18:57:53.318Z`), and was closed early at **7:29:59 AM CDT**. These are dated session records. Use `preview:status` for the current session state. Any future active preview requires the PC, dashboard, gateway and tunnel processes to keep running; it is not a production hosting service or uptime guarantee. During a preview, Cloudflare carries web traffic while capture and archive storage remain on the PC.

```powershell
npm run preview:status
node scripts/verify-preview.mjs
npm run preview:stop
```

`stop` signals the preview supervisor to stop its own tunnel child and gateway. It leaves the collector, pilot and local dashboard running. For an explicitly requested new session, first build/start the dashboard at port 4173 and ensure the verified executable exists at `data/tools/cloudflared.exe`, then run `npm run preview:start` in a separate terminal and leave it running. It creates a fresh random password, new temporary link and eight-hour expiry; do not start a replacement automatically after the user’s review window ends. The executable and saved weather/captures are local prerequisites, not included in a fresh checkout. No Cloudflare account login or permanent deployment is part of this script.

The preview uses a generated 144-bit password, in-memory sessions, Secure/HttpOnly cookies, HTTPS enforcement, same-origin login, bounded login attempts/bodies and no-store responses. Root requests without a session see only the password form; assets, API reads and exports require authentication. Archives, admin paths and mutation methods are denied. The password is supplied to the owner in chat, not checked into source or written to application logs. Its local credential file and runtime state are under ignored `data/remote-preview/`; keep those files private. The downloaded executable is under ignored `data/tools/`.

Cloudflared 2026.9.1 was downloaded from Cloudflare’s official GitHub release and verified against its published SHA-256 (`2837888cc0f5d58f15b6dc478376de90b4d3ba5241c7947455d1e0a0df429712`) and valid Cloudflare Authenticode signature. These identify the installed binary, not an automatically updated version. Password/authentication tests are in `test/preview-gateway.test.mjs`. `node scripts/verify-preview.mjs` checks the active external link without printing the password or cookies; its report is `reports/preview-verification.json`. It verifies login, anonymous denial, outage totals/geometry, blocked archive/admin/write routes, HTTPS, all prepared rainfall periods and PNGs, and legacy catalogs/charts/replay/CSV/exact polygons. The rainfall check requires the 24/48/72-hour sample assets. Browser sign-in, live data and legacy grid replay were verified September 18 without console warnings/errors. The initial matched-reference checkpoint passed 154 Node tests. The autonomous continuation passes 172; all four cases, all lags, cold geometry and matched-reference CSV/masks pass the public verifier. Current-session output is in `reports/preview-20260918.stdout.log` and `reports/preview-20260918.stderr.log`; earlier runs used `reports/preview.stdout.log` and `reports/preview.stderr.log`.

If sign-in fails, use the URL from `preview:status` and the password from that same session. Copy the entire case-sensitive password, including any leading underscore. The gateway ignores surrounding whitespace and zero-width spaces introduced by copying; letter case and characters within the password still must match exactly. The password field disables mobile capitalization, autocorrection and spellcheck. An expired preview needs an explicitly requested new session; the previous URL/password cannot be reused. Successful script verification alone does not prove a particular device signed in: inspect the exact browser error if the issue persists.

## Cloud runtime probe (deferred; prepared, not deployed)

`wrangler.benchmark.jsonc` defines an authenticated benchmark Worker with a SQLite-backed Durable Object alternative. It has no cron or production storage and performs no external source fetching. Account authentication and a verified free plan are needed before deploying this Phase 1 test. R2 is not provisioned automatically.

1. With Cloudflare connected, deploy the probe using the benchmark config and set `BENCHMARK_TOKEN` as a Worker secret. Never put credentials in tracked files or chat.
2. Send the generated ordinary, 4,000-feature and 10,000-feature fixture bodies via authenticated POST to `/worker` and `/durable-object`, both with and without `?compression=gzip`.
3. Collect platform invocation CPU metrics, cold and warm runs, p50/p95/max, failures and memory pressure. Worker elapsed timers must not be used as CPU measurements. Use at least 20 invocations per case/path/mode. Record both the forwarding Worker and Durable Object metrics.
4. For archive-cost validation, add a private temporary R2 binding named `BENCHMARK_ARCHIVE` only after the account's R2/free-budget status is known. The probe records raw bodies before parsing and writes normalized results. It deliberately preserves both uncompressed and compressed raw bodies during compression tests; that extra diagnostic copy is not included in the production storage model. Inventory the `phase1/` objects and record their bytes and request counts.
5. For a standard free Worker, require p95 CPU below 7 ms, no invocation over 10 ms, and no resource failures on all supported inputs. For the Durable Object candidate, use a conservative initial p95 target below 1 second, zero resource failures, forwarding Worker p95 below 7 ms, and measured total daily active duration below 70% of the available allowance. Include network/archive time in Durable Object duration budgeting.
6. Remove the temporary benchmark deployment/storage only after retaining the measurements. Do not launch a production cloud collector from this probe; the separately authorized local Phase 2 trial can continue.

The probe's Node smoke tests exercise transforms, authentication and archive ordering. They do not emulate Cloudflare resource limits or establish that its deployment config is accepted by Wrangler. Those checks remain pending account/runtime access.
