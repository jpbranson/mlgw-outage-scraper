# MLGW outage collection

Local implementation of [the design plan](DESIGN_PLAN.md): the Phase 1 source pilot, Phase 2 durable collector and Phase 3 dashboard. Source findings are in [reports/PHASE1_STATUS.md](reports/PHASE1_STATUS.md), collection progress in [reports/PHASE2_STATUS.md](reports/PHASE2_STATUS.md), and the dashboard checkpoint in [reports/PHASE3_STATUS.md](reports/PHASE3_STATUS.md). Cloud deployment remains deferred.

The user confirmed **local validation only for now** on September 16, 2026, then authorized a temporary password-protected remote preview for phone access. Collection, archives and the dashboard remain on this PC; the preview routes read-only web traffic through Cloudflare. Cloud account setup, production deployment and provider-runtime testing remain deferred; the prepared cloud probe below is reference material for later work.

## Run locally

Requires Node.js 24 or later, including its built-in SQLite module. No packages need to be installed for the local pilot, collector or tests. Run from this directory:

```powershell
npm test
npm run benchmark
npm run storage
npm run pilot
npm run analyze
```

`pilot` captures the public GeoJSON and HTML summary every five minutes for a 24-hour window, then stops after a final observation at/after the end. It records each request's own UTC timestamps. `pilot:once` captures one observation while respecting any existing next-due/backoff time. The process must remain running and the PC must stay awake and connected. It does not change Windows power settings, install a service, or start at boot. Network access may need sandbox approval.

The current pilot was launched as a hidden Node process on September 16, 2026 at 11:37:51 AM Central and resumed with atomic checkpoint saving during setup. `data/pilot/state.json` records the pilot window, current PID, last attempt and next due time; verify the command line before stopping any process because PIDs can be reused. `reports/pilot*.stdout.log` and `reports/pilot*.stderr.log` contain background output. A one-time follow-up in this conversation is scheduled for September 17 at 12:15 PM Central; the PC and Codex app must be running for the local review.

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

The seven-day run is already active. It mirrors the Phase 1 pilot's completed files during that pilot's window, then continues five-minute source capture itself. It does not require cloud credentials. Its heartbeat, PID and original end time are recorded in `data/collector/run-state.json`; the local process requires this PC to remain awake and online.

```powershell
npm run collector:status
npm run collector:import
npm run collector:recover
npm run collector:replay -- <capture-id>
npm run collector:verify
```

`status` checks current freshness, runner heartbeat, observed slot coverage and storage pressure. `import` indexes completed source-pilot captures without another network request. `recover` verifies archived bodies/parsers and indexes any manifests left pending by a failed transaction. `replay` reconstructs a capture from its compressed original with the saved parser. `verify` runs isolated 4,000/10,000-feature archive/replay checks and restores the real archive into a separate temporary database; it never adds synthetic data to the live index.

To resume an interrupted run, use `npm run collector:run`. It preserves the window in `run-state.json` and skips missed observation slots. The one-time run ends after seven elapsed days; that alone does not prove successful coverage. Source restrictions or urgent storage pressure stop it with a recorded reason. Inspect that reason before resuming; do not erase the state or archived history to hide gaps.

Paths:

- `config/collector.local.json`: cadence, seven-day duration, storage budget and pressure thresholds; automatic deletion is disabled.
- `data/collector/archive/objects/`: immutable gzip bodies addressed by the original-body SHA-256.
- `data/collector/archive/manifests/`: one immutable observation record per attempt, including failure evidence and parser provenance.
- `data/collector/archive/parsers/`: the source parser version used for historical replay.
- `data/collector/index.sqlite`: compact capture index, totals, recent comparison cache, leases and queued rollups. SQLite WAL/SHM files may be present while running; do not copy only the database file as a live backup. The separate immutable archive can rebuild the index.
- `data/collector/inbox/`: diagnostic source captures made after handoff. These are retained alongside the archive for this local trial, so local storage exceeds the projected cloud archive alone.
- `reports/collector*.log`, `reports/collector-health.json`, `reports/durable-verification.json`: runtime logs, health and restore evidence.

Only one publication per actual five-minute slot is accepted. Failed/suspect captures do not advance the latest trustworthy snapshot. A failed database transaction leaves raw evidence available for retry. Original and HTML request times remain separate. Rollups store coverage alongside customer-minutes and never fill collection gaps with zero outages.

The status command is an independent on-demand heartbeat check. A separate notification monitor and Windows startup service are not installed. This backend validates filesystem/SQLite behavior; cloud-specific object storage, database and runtime guarantees still need separate testing.

## Phase 3 local dashboard

The local dashboard is available at **http://127.0.0.1:4173** while its Node process is running. It reads the collector archive without changing captures. Start or rebuild it with:

```powershell
npm ci
npm run dashboard:build
npm run dashboard
```

The page links historical maps, totals and charts; offers 24h/7d/30d chart views; explains gaps, freshness and anomaly rules; and exports bounded CSV or the selected GeoJSON. Daily peaks and archive date groups are labeled UTC; other displayed times use Central. See [Phase 3 status](reports/PHASE3_STATUS.md) for checks and limits.

Select **Heatmap** above the map to see reported outage activity across the available archive or the last 6h/24h/7d/30d. The heatmap smooths distinct provisional source ID/start pairs in a fixed, roughly 1 km grid. Repeated polls count once. A 750 m Gaussian bandwidth, truncated at 2.25 km, shows nearby activity together; a square-root color scale keeps isolated locations visible. The density scale uses the whole selected period and does not change when panning or zooming. Tapping an underlying area shows its first/last observations, peak simultaneous customer count and uncertain identities. These are reported activity near a location, not service areas or confirmed unique incidents/households. Moving events can appear in several cells. Only locally collected current-format captures are included; older legacy history is not imported. **One capture** restores the map, totals and arrow replay controls for a single observation.

Select **Per capita** for a Census block-group choropleth. **Measure** switches between provisional outage events and peak simultaneous customers affected, each per 1,000 estimated residents. Original outage points are assigned to the full Census polygons, not to heatmap cell centers. The denominator is the latest available block-group population release as checked September 16, 2026: [2020–2024 ACS five-year estimates](https://www.census.gov/programs-surveys/acs/news/data-releases/2024/release-schedule.html), table [B01003](https://data.census.gov/table/ACSDT5Y2024.B01003), with matching 2024 TIGERweb boundaries. Popups retain the estimate and its 90% margin of error. Block-level population is older decennial data; newer boundary vintages alone do not make population estimates newer.

Per-capita rates are location-based proxies: utility customers are accounts, not people, and an outage point can represent customers across multiple block groups. These maps do not estimate the share of residents without power. Outside-county and boundary-ambiguous points are excluded and counted. Gray means no rate because population is zero/missing or there are no verified captures; white means no assigned events in verified captures, not proof of uninterrupted power. A large or unavailable population margin of error is flagged in the popup. Coverage gaps remain unknown. Fixed legend intervals make rate colors consistent across map movements and selected periods; event rates still depend on the selected period's length and coverage.

The compressed public reference file and provenance are described in [reference/README.md](reference/README.md). It contains 685 Shelby County block groups, reconciling to 919,173 estimated residents, and is about 574 KiB. Regenerate from cached sources with `node scripts/prepare-census.mjs`, or explicitly refresh the pinned official sources with `node scripts/prepare-census.mjs --download`. It never accesses outage captures. The dashboard uses the local reference; population is not fetched on each view.

Historical maps replay hash-verified originals through the read-only `/api/series?view=spatial&from=...&to=...` route. Add `geography=block-group` for per-capita results; `/api/config?view=census` provides the static public geometry and provenance. Missing detail and coverage remain explicit. Requests are limited to 31 days, one million feature observations, 50,000 provisional events and ten seconds of replay; a limit failure asks for a shorter period rather than returning a partial map. Only one historical replay runs at a time. The existing authenticated preview permits these reads without changing its credentials or lifetime.

Dashboard design: a plain utility outage monitor, with the Memphis/Shelby County map dominant, compact inline totals, and a smaller history chart. Use ggplot2 [`theme_minimal`](https://ggplot2.tidyverse.org/reference/ggtheme.html) aesthetics: a white plotting surface, faint gray major/minor gridlines, black marks, no panel border or axis tick marks, and plain sans-serif type. The interactive chart remains in Chart.js; `web/ggplot-theme.ts` supplies its thinner minor gridlines. Sharp rises use larger black triangles, and the selected capture uses a dashed black line. The geographic basemap is grayscale with black outage points. Do not use emojis or decorative glyphs. Previous/next capture controls use simple drawn SVG arrows with accessible labels; exports use text. Retain only functional data symbols. Avoid rounded cards, shadows, gradients, badges, KPI tiles, decorative marks, forced symmetry, elaborate typography hierarchies and unnecessary motion or explanations. Keep detail in expandable Data notes. All interface text, chart labels/tooltips and map controls use at least 16 CSS pixels (12 pt), including on phones, overriding ggplot's smaller text defaults. OpenStreetMap's raster basemap has its own embedded place labels. The subject should determine the layout; avoid generic reusable dashboard styling.

`npm run dashboard:verify` checks 4,000/10,000-feature API replay in separate temporary archives. `npm test` remains offline and does not require the frontend packages. The frontend build uses the pinned packages in `package-lock.json`.

The server binds only to `127.0.0.1`, defaults to port 4173, and has no collector/admin mutation routes. Set `DASHBOARD_PORT` to change the local port. Set `DASHBOARD_TILES` to an HTTPS `{z}/{x}/{y}` tile template, with `DASHBOARD_TILE_ATTRIBUTION` and `DASHBOARD_TILE_ATTRIBUTION_URL` matching its provider. An explicitly empty `DASHBOARD_TILES` disables basemap requests. By default, the browser downloads visible OpenStreetMap tiles with attribution; application assets and outage data are served locally. No Windows startup task is installed. The separately authorized temporary phone preview is described below.

Client source is in `web/`; the read-only API is in `src/dashboard/`. Generated `dist/dashboard/` files are ignored. Server output is in `reports/dashboard.stdout.log` and `reports/dashboard.stderr.log` when launched in the background. Verify the PID/command line before stopping a background server; keep the separate pilot/collector processes running.

## Temporary phone preview

On September 16 the user explicitly authorized option 1: a temporary password-protected HTTPS link through Cloudflare Quick Tunnel. `scripts/preview.mjs` runs a separate gateway on loopback port 4174 and a standalone, signed `cloudflared` process; it installs no Windows service and changes no router/firewall settings. The gateway forwards only authenticated, allowlisted read routes to the local dashboard on port 4173. Its metrics listener is loopback-only on port 4175 and is not routed publicly.

The first run started at 1:40 PM Central on September 16 and expires automatically at **9:40 PM Central that evening**. The link requires the PC, dashboard, gateway and tunnel processes to keep running; it is not a production hosting service or uptime guarantee. Cloudflare carries the web traffic, while capture and archive storage remain on the PC.

```powershell
npm run preview:status
npm run preview:stop
```

`stop` signals the preview supervisor to stop its own tunnel child and gateway. It leaves the collector, pilot and local dashboard running. `preview:start` is an explicit new run with a fresh random password, new temporary link and eight-hour expiry; do not start a replacement automatically after the user’s review window ends.

The preview uses a generated 144-bit password, in-memory sessions, Secure/HttpOnly cookies, HTTPS enforcement, same-origin login, bounded login attempts/bodies and no-store responses. Root requests without a session see only the password form; assets, API reads and exports require authentication. Archives, admin paths and mutation methods are denied. The password is supplied to the owner in chat, not checked into source or written to application logs. Its local credential file and runtime state are under ignored `data/remote-preview/`; keep those files private. The downloaded executable is under ignored `data/tools/`.

Cloudflared 2026.9.1 was downloaded from Cloudflare’s official GitHub release and verified against its published SHA-256 (`2837888cc0f5d58f15b6dc478376de90b4d3ba5241c7947455d1e0a0df429712`) and valid Cloudflare Authenticode signature. Password/authentication tests are in `test/preview-gateway.test.mjs`. `node scripts/verify-preview.mjs` checks the active external link without printing the password or cookies; its report is `reports/preview-verification.json`. Browser sign-in and live data were also verified at a phone-sized viewport. Runtime output is in `reports/preview.*.log`.

## Cloud runtime probe (deferred; prepared, not deployed)

`wrangler.benchmark.jsonc` defines an authenticated benchmark Worker with a SQLite-backed Durable Object alternative. It has no cron or production storage and performs no external source fetching. Account authentication and a verified free plan are needed before deploying this Phase 1 test. R2 is not provisioned automatically.

1. With Cloudflare connected, deploy the probe using the benchmark config and set `BENCHMARK_TOKEN` as a Worker secret. Never put credentials in tracked files or chat.
2. Send the generated ordinary, 4,000-feature and 10,000-feature fixture bodies via authenticated POST to `/worker` and `/durable-object`, both with and without `?compression=gzip`.
3. Collect platform invocation CPU metrics, cold and warm runs, p50/p95/max, failures and memory pressure. Worker elapsed timers must not be used as CPU measurements. Use at least 20 invocations per case/path/mode. Record both the forwarding Worker and Durable Object metrics.
4. For archive-cost validation, add a private temporary R2 binding named `BENCHMARK_ARCHIVE` only after the account's R2/free-budget status is known. The probe records raw bodies before parsing and writes normalized results. It deliberately preserves both uncompressed and compressed raw bodies during compression tests; that extra diagnostic copy is not included in the production storage model. Inventory the `phase1/` objects and record their bytes and request counts.
5. For a standard free Worker, require p95 CPU below 7 ms, no invocation over 10 ms, and no resource failures on all supported inputs. For the Durable Object candidate, use a conservative initial p95 target below 1 second, zero resource failures, forwarding Worker p95 below 7 ms, and measured total daily active duration below 70% of the available allowance. Include network/archive time in Durable Object duration budgeting.
6. Remove the temporary benchmark deployment/storage only after retaining the measurements. Do not start the Phase 2 collector at this checkpoint.

The probe's Node smoke tests exercise transforms, authentication and archive ordering. They do not emulate Cloudflare resource limits or establish that its deployment config is accepted by Wrangler. Those checks remain pending account/runtime access.
