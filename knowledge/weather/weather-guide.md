---
type: Guide
title: "Weather controls, cache and rainfall preparation"
description: "Weather selector behavior, validation and preparation commands, storage limits, station compression, rolling refresh and multi-day rainfall workflows."
tags: [weather, operations, rainfall, storage]
status: stable
generated: { by: "claude-code/claude-opus-5-5", at: 2026-10-05T02:51:38Z }
verified:
  - { by: "process:documentation-review", at: 2026-09-23T04:16:15Z }
  - { by: "claude-code/claude-opus-5-5", at: 2026-10-05T02:45:24Z }
sources:
  - id: knowledge-verification
    resource: "../../reports/knowledge-verification-20261004.json"
    title: "October 4 knowledge verification receipt (local, ignored by Git)"
  - id: weather-config
    resource: "../../config/weather.local.json"
    title: "Weather storage and request limits"
    last_modified: 2026-09-17T21:57:25Z
  - id: ghcnh
    resource: "https://www.ncei.noaa.gov/products/global-historical-climatology-network-hourly"
    title: "NOAA GHCNh product page"
  - id: iem-metar
    resource: "https://mesonet.agron.iastate.edu/request/download.phtml?network=TN_ASOS"
    title: "IEM/NWS METAR feed"
---
# Local weather controls and cache

The local Phase 3A checkpoints validate timestamped radar, numeric one-hour rainfall, Memphis station records and warning samples, and connect prepared weather to the dashboard. See [weather findings and limits](phase-3a-weather-sources.md). Weather data is stored separately under ignored `data/weather/`.

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

`weather:quality` is offline-only and interprets five saved GHCNh station windows, including a recently available sample and the missing September 16 sample. It preserves source-specific quality/measurement codes and separates accepted, trace, missing and excluded values for temperature, dew point, wind/gusts and precipitation. Only documented passing codes qualify; newer unsupported source families remain excluded. Nominal hourly precipitation selects a final routine report without summing interim running totals. `weather:validate` also emits these quality derivatives. This does not change the dashboard's separate as-reported METAR series. See [station quality results and limitations](station-quality.md); `python scripts/verify-station-quality.py` independently checks derivative provenance using only the Python standard library.

`weather:events` replays eight fixed event/warning cases offline. Add `-- --download` to retrieve missing originals or `-- --case=winter` to select a case (`wet`, `dry`, `winter`, `heat`, `francine`, `current`, `march-wind`, `august-storm`). It uses pinned NOAA annual detail releases and exact-time IEM warning snapshots with preserved county/zone boundaries. Shelby county and forecast-zone records remain separate; event periods and warning instants do not imply the same coverage. Missing current archive months are explicit, reported event endpoints are not damage polygons, and warning data includes retrospective updates. This command validates saved event context; the separate comparison publisher includes that context with its original time and coverage limits. See [event context results](event-context.md); `python scripts/verify-event-context.py` independently checks source selection, UTC times and geometry provenance using only the standard library.

`weather:prepare` prepares the last 30 minutes for display, using saved originals by default. Its `--download` option explicitly fetches missing radar frames, hourly rainfall endpoints and a 24-hour airport batch ending at a completed UTC hour. To select a saved interval, supply both `--from=2026-09-17T04:00:00Z --to=2026-09-17T04:30:00Z`; boundaries must be five-minute timestamps and at most 45 minutes apart. `--samples` prepares the earlier validation cases. This command is a bounded manual job. The cloud weather service refreshes recent weather every 30 minutes without a trial deadline; opening the page never fetches upstream weather. Reload the page after preparing data. Read-only `/api/weather?at=...` and content-addressed PNG routes serve only prepared, verified local assets. The historical samples do not create historical outage records.

The manual local weather jobs cap shared storage at **1 GiB**, responses at 32 MiB, downloads at 96 MiB and requests at 24 per run, with a 20 GB free-space floor. The production rolling-weather service overrides the free-space floor to 5 GB and limits its disposable portion to 256 MiB within the same shared cap. It stops on pressure and never automatically expires source evidence. `config/weather.local.json` records these limits. Annual station files stay pinned unless explicitly refreshed with `npm run weather:refresh-station -- --year=2026 --download`. A refresh retains earlier originals and content-addressed manifest revisions; a failed retrieval leaves the prior successful snapshot available and persists provider backoff. Saved analyses retain their original source hashes. Refreshing does not republish the airport timeline or schedule ongoing collection. Saved and rolling weather writers also share `data/weather/budget-writer.lock` to enforce the aggregate 1 GiB limit across concurrent jobs. A stale writer or budget lock after a crash requires checking its PID and process command before removing only the verified stale lock; it must not be removed while another weather job is running. The weather job does not read or alter the outage archive.

Station originals are stored losslessly as `objects/<original-sha256>.raw.gz`. Manifest hashes and byte counts still describe the exact uncompressed provider body. Readers accept both compressed and legacy `.raw` objects, verify the original SHA-256, and bound decompression by the recorded original length and response limit. Other products keep their existing representation. `npm run weather:compress-stations` previews migration of retained station originals; add `-- --apply` to write and verify compressed files before removing only redundant `.raw` copies. The migration uses the writer lock, makes no downloads, preserves all source revisions, and can resume after an interruption. See [storage and pilot validation](storage-and-pilot-revalidation.md).

The new [NOAA GHCNh](https://www.ncei.noaa.gov/products/global-historical-climatology-network-hourly) station files replace the planned ISD path. The explicit September 17 refresh extends the 2026 Memphis snapshot from August 26 through **September 9 at 16:54 UTC**, so that source's September 16 sample is still missing. A separately labeled [IEM/NWS METAR feed](https://mesonet.agron.iastate.edu/request/download.phtml?network=TN_ASOS) provides recent airport observations, as reported without additional quality control. These are separate series; trace, zero, missing values and raw reports are preserved, and overlapping hourly precipitation reports are not summed.

Select **Rainfall** above the map for prepared 24/48/72-hour totals, ending times, opacity and native-cell details. Coverage and exact intervals remain visible. The outage chart and its CSV use the same interval. Prepared dates now include June 2023, the September 2024 Francine case, the March 3–6, 2023 high-wind case and the August 30–September 2, 2024 storm case, each covering all 685 Census block groups, plus the rolling 24-hour totals described below. The current-feed chart explicitly shows missing captures for these dates; the separate legacy archive and Weather comparisons page use verified historical regional totals. Changing duration preserves the ending date when available. The newest period opens first. The rainfall map is paired with a second map of reported current-feed outage density for exactly the same interval; **Link map movement** keeps their pan and zoom together. Periods before current-format collection show that outage history is unknown there and point to Weather comparisons for legacy totals. Shared locations on the two maps are not evidence of cause. A fixed accumulated-depth legend distinguishes totals through 150 mm and above across all periods. See the [broader weather checkpoint](weather-periods.md).

The separate **Weather comparisons** page adds regional cases and matched reference periods. See [historical weather comparisons](comparisons-guide.md) for the current preparation order, prerequisites, routes and interpretation limits.

## Automatic weather refresh

**October 4 review:** production has not published any rolling 24-hour total since the release that enabled them. Each run requests only the three most recent completed rainfall hours, so a frame missed for longer is never retried and no 24-hour window can span it. Downloads are refused once the 256 MiB rolling cache holds about 235 MB, because each download first reserves a 32 MiB response allowance; on October 4 that lasted from 06:42 to 09:45 UTC and cost the 04:00 and 05:00 frames. See [remaining work](../project-status.md#remaining-work).

The cloud `mlgw-weather` service refreshes recent radar, hourly rainfall and KMEM METAR display data every 30 minutes without the local trial's end date. Use the [cloud operating commands](../operations/digitalocean-deployment.md) for current status and stopping. Local `weather:status` / `weather:stop` address only the stopped PC runner. Neither runner refreshes annual GHCNh files or saved case studies.

Disposable weather lives in `data/weather/live-cache/`, capped at 256 MiB within the shared 1 GiB weather budget. Radar expires after four hours; METAR after 24 hours; hourly rainfall after 28 hours. Each run also publishes **rolling 24-hour rainfall totals** (listed as "rolling" in the Rainfall selector) for up to three newly complete windows. A total is published only when all 24 hourly MRMS Pass 2 frames are present, using the same accumulation, native grid, block-group area weighting and display scale as prepared periods; it is tied to its final hour and expires with it after about a day. New hourly frames keep their small native numeric subset; frames derived before this change are upgraded once from their retained, hash-checked originals. Rolling totals are display aids, not saved study evidence. A failed total is recorded in the runner state and marks weather degraded without affecting the hourly frames or outage collection. Saved study evidence in `data/weather/cache/` never expires through this runner. The dashboard merges both prepared catalogs; opening a view never starts acquisition. Recent weather can still be unavailable because of source latency and matching tolerances.

For a separate manual local refresh, first check that no maintenance runner owns its lock. `npm run weather:maintain -- --download` performs one bounded refresh when due. Its `--run` option belongs to the former local trial, which must not be resumed while cloud collection is active. The PC stop marker is `data/weather/maintenance/stop`; production uses different paths listed in the deployment guide. Verify a lock owner's process has exited before recovering a stale lock. See [maintenance bounds and recovery](autonomous-continuation.md#bounded-ongoing-weather-maintenance).

## Prepared multi-day rainfall

Run `npm run weather:validate-window` to replay the default June 24–26, 2023 originals offline, then `npm run weather:prepare-periods` to publish its verified assets. Both accept `-- --config=config/rainfall-francine-2024.json` to select the prolonged-rain case. Neither fetches upstream data. Publication updates the selected periods together and preserves other dates and single-capture layers.

To acquire or resume a selected sample, run `npm run weather:collect-window -- --config=config/rainfall-francine-2024.json --batch=1 --download`, followed by batches `2` and `3`. Omitting `--download` verifies saved hours only. Progress is checkpointed after each hour; rerunning a batch verifies and reuses completed originals. SIGINT/SIGTERM stops between hours and releases the writer lock. A hard process termination still requires the stale-lock check above. Custom JSON configurations use hourly UTC `from`/`to` boundaries spanning 24, 48 or 72 hours, `hoursPerBatch` from 1 to 24, optional supported `periodHours`, and a unique `reportId` such as `rainfall-my-case` so reports do not overwrite another case. All jobs share the existing global cache limit.

Optional independent verification is `python scripts/verify-rainfall-window.py --report=reports/rainfall-francine-2024-validation.json` with Pillow/NumPy. The [weather-period checkpoint](weather-periods.md) records prolonged-rain, interruption, missing-data and resource checks. Cache use was **189.9 MiB** at the event/warning checkpoint and **273.36 MiB of 1 GiB** after matched-reference preparation. The separate bounded rolling refresh/retention runner is now implemented; saved study evidence never expires through that runner. Additional station source families remain future validation work. Verified legacy history and initial rainfall/wind comparisons are available on their separate pages.
