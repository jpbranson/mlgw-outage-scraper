# Broader rainfall periods and station refresh

**September 22 deployment update:** the [DigitalOcean deployment guide](DIGITALOCEAN_DEPLOYMENT.md) is authoritative for current operation. The VM now serves the dashboard and runs both collectors; local collectors are stopped. Runtime counts, preview sessions, trial deadlines and hosting gates below describe this earlier checkpoint. Its scientific findings and dated validation results are preserved.

**Subsequent storage update:** the user later authorized a 1 GiB cap and lossless station compression. The [storage checkpoint](STORAGE_AND_PILOT_STATUS.md) recovered 78.0 MiB, verified every retained weather original and revalidated the completed pilot. Cache figures and the 256 MiB limit below describe this earlier weather-period checkpoint.

Completed locally September 17, 2026. This is the requested next weather checkpoint; it does not perform the 24-hour source-pilot review or start legacy import, automatic weather collection or cloud deployment.

## Implemented behavior

- Collection, offline validation and publication accept an explicit `--config` file. Windows span 24, 48 or 72 hours with hourly UTC boundaries. Batches contain at most 24 hours, share the existing cache/bandwidth/deadline limits and have separate per-case reports.
- Each completed hour is checkpointed. An interrupted run reuses checksum-verified originals; a failed/partial transfer remains unavailable. SIGINT/SIGTERM requests stop between hours. Hard crashes retain the existing manual PID/lock check requirement. Rate limits, restrictions and resource exhaustion stop further work without deleting evidence.
- Publication writes immutable assets before one catalog replacement. Invalid input leaves the existing catalog intact. Other prepared dates and single-capture layers remain available. Both June 2023 and September 2024 now offer 24/48/72-hour choices.
- Switching duration preserves the selected ending date when available. Accumulated rainfall uses a fixed 0/5/25/50/100/150 mm scale with a final ≥150 mm class and separate missing color, shared across periods. One-hour rainfall keeps its original scale. Rendering version: `rainfall-period-display-v2`.
- Explicit station/year refresh preserves earlier original bodies and manifest revisions. Failed retrievals leave the previous successful snapshot available, and provider backoff survives restart. No automatic refresh or dashboard timeline republication is implied.

## Prolonged-rain evidence

The [NWS Memphis Francine report](https://www.weather.gov/meg/hurricanefrancinerainwindevent) identifies the September 2024 event. The selected window is **September 12 00:00 UTC through September 15 00:00 UTC**. NWS station totals cover different intervals and locations; they are context, not exact targets for these gridded estimates.

All **72 NOAA MRMS Pass 2 hourly originals** were retrieved in three bounded batches, with **47,316,816 downloaded bytes** in total. Each successful batch used 24 requests, 13.4–18.5 seconds and at most approximately 276 MiB peak process RSS. The initial sandbox network failure received no data, was recorded and backed off before the permitted network retry. No provider restriction was bypassed.

| Period ending September 15 00:00 UTC | Outlined-area mean | Largest native-cell total | Complete block groups |
| --- | ---: | ---: | ---: |
| 24 hours | 2.6250 mm | 17.4 mm | 685/685 |
| 48 hours | 26.8278 mm | 66.6 mm | 685/685 |
| 72 hours | 117.0372 mm | 179.0 mm | 685/685 |

Means cover the preserved 80 × 60-cell rectangle, not just Shelby County. All periods have complete hourly, cell and spatial coverage. There are **42 wet hours across three UTC days**, defining a wet hour here as a rectangle-area mean of at least 0.1 mm: 15 on September 12, 20 on September 13 and seven on September 14. Daily rectangle means are 90.2094, 24.2028 and 2.6250 mm. This is a descriptive validation threshold, not an official event classification.

Independent Pillow/NumPy decoding matched **345,600 hourly native values** and **14,400 accumulated values**, plus the analytic rectangle means. Independent polygon rasterization passed for four representative block groups, including the western boundary. Offline production replay took 20.8 seconds, about 265.5 MiB peak RSS and zero requests. These are local resource measurements, not cloud runtime claims.

Omitting the wettest hour in memory made every full-period total unknown. Masking ten otherwise complete cells made exactly those totals unknown and suppressed the full-target mean. The original files and normal published assets were unchanged by these faults. No 2024 outage history was inferred: the dashboard retains its missing-outage message and 0% outage coverage.

## Station revision and storage

The explicit 2026 Memphis GHCNh refresh on September 17 retrieved a revised **33,255,582-byte** file. Its last source observation is **September 9 at 16:54 UTC**, compared with August 26 in the preserved prior snapshot. September 16 therefore still has no observations in this source. The recent KMEM METAR series remains separately labeled.

The former original (`cb671abe2d506aed1b9266afc864e71c82200502166ac847ef757fa3b2965c03`) and revised original (`805d9ede0bc5fa0e3a9c0cf7db77e5047a013b88c858d574065204bb00f76147`) remain hash-addressed in the cache. Manifests in `revisions/` preserve source metadata; already saved derivatives retain their source hashes.

Final prepared cache use is approximately **234.3 MB / 223.5 MiB**, below the unchanged **256 MiB** cap. The 32 MiB response limit, 96 MiB per-run download budget, 24-request limit, five-minute deadline and 20 GB free-space floor remain unchanged. Acquisition reserves a maximum response plus manifest space before fetching, so the remaining roughly 32.5 MiB is not freely usable download capacity. Further large source refreshes/periods need a deliberate capacity or retention decision. No originals were deleted.

## Verification and scope

- Full offline suite: **109 passing Node test entries**. New cases exercise interrupted/restarted batches, mid-stream failures, provider pauses, request/time budgets, configuration bounds, multiple-period publication and preservation on verification failure, heavy-rain rendering and station revisions/failure recovery.
- TypeScript and production frontend build pass. Browser checks cover all six prepared period selections, preserving the ending date when changing duration, matching chart/CSV intervals and explicit missing outage history. Desktop and 390 × 844 phone layouts remain readable; controls use 16 px text with no horizontal overflow. No browser warnings/errors were observed.
- The independent numerical and spatial cross-check passed. `git diff --check` found no whitespace errors.
- At **14:00:07 UTC**, the separate collector had **258 valid captures**, 100% observed slot coverage, no gaps over ten minutes and a healthy heartbeat. Its PID and original seven-day end time were unchanged. No collector or pilot process was stopped or restarted, and no 24-hour review was performed.

Ignored evidence: `reports/rainfall-francine-2024-batch-*-download.json`, `reports/rainfall-francine-2024-validation.json`, `reports/rainfall-francine-2024-independent.json`, `reports/rainfall-francine-2024-period-preparation.json`, `reports/weather-station-2026-refresh.json`, `reports/weather-checkpoint-tests.log` and `reports/weather-checkpoint-collector-health.json`.

The later [station-quality checkpoint](STATION_QUALITY_STATUS.md), [event/zone-warning checkpoint](EVENT_CONTEXT_STATUS.md), legacy audits and [separate legacy dashboard](LEGACY_DASHBOARD_STATUS.md) complete the proposed validations/publication. Initial rainfall/wind cases and [matched references](WEATHER_REFERENCE_STATUS.md) are complete. The [September 18 continuation](DEVELOPMENT_COMPLETION_STATUS.md) adds cold/heat cases, original-grid cold summaries and bounded automatic radar/rainfall/METAR refresh with disposable retention through the collector trial end. Saved studies never expire through that runner. Additional source families, richer supported comparisons and operation beyond the trial remain open; this earlier checkpoint does not establish worst-case long-term capacity.
