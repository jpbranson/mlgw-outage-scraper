# Phase 3A checkpoints: weather sources, cache and dashboard

Validated September 16–17, 2026 (Central/UTC); documentation reconciled September 17. The source/cache step, synchronized single-capture controls, numeric accumulation/spatial weighting and multi-day dashboard controls are implemented locally. The latest [rainfall dashboard checkpoint](RAINFALL_DASHBOARD_STATUS.md) has 99 passing tests, prepared 24/48/72-hour views and expanded coverage for all 685 Census block groups. Broader period/event/quality validation, weather/outage comparisons and automated weather collection remain subsequent work. The outage collector remains separate. The first preview expired; a new explicitly requested Quick Tunnel was subsequently deployed and verified September 17, as recorded in [current status](PROJECT_STATUS.md).

The source and single-capture measurements below preserve their original checkpoints. Their 4,200-cell crop, `weather-display-v2` version and earlier cache sizes are superseded by the rainfall dashboard's 4,800-cell crop, `weather-subset-v2` / `weather-display-v3` assets and expanded extent. Re-running validation now uses the expanded crop and can overwrite the ignored machine-readable reports.

## Dashboard checkpoint — September 17, 2026 UTC

The **One capture** view now offers radar reflectivity or preceding one-hour rainfall, adjustable opacity, source attribution, legends and exact timestamps/intervals. Changing captures clears the old image immediately; only a prior radar frame less than five minutes old or a rainfall endpoint less than 60 minutes old is eligible. Weather is hidden on period heatmaps and per-capita maps. Weather errors leave outage maps and totals usable.

The original native grids remain preserved. Separate 512 × 512 display images are projected into Web Mercator using nearest-neighbor sampling for Leaflet placement; they do not increase measurement resolution. Radar indices follow the [official IEM lookup table](https://mesonet.agron.iastate.edu/GIS/rasters.php?rid=2): zero is missing, and index one is −32 dBZ. Values below 5 dBZ are transparent and cannot prove dry weather. Rainfall zero is transparent and labeled, while missing cells are gray. The outlined rectangle identifies the prepared extent. The renderer is versioned `weather-display-v2`.

The **Memphis airport weather** disclosure provides a 24-hour temperature or wind/gust history. A bounded [IEM ASOS/METAR request](https://mesonet.agron.iastate.edu/cgi-bin/request/asos.py?help=) returned 24 routine/special KMEM reports for September 16 04:00–September 17 04:00 UTC. The latest was **September 17 03:54 UTC (September 16 10:54 PM CDT)**. This is an as-reported source without additional quality control, separate from GHCNh. Missing gusts are not calm wind; trace precipitation is not numeric zero. Reports after the selected capture are excluded, and the current reading expires after 90 minutes. The plot breaks at missing values and gaps longer than 90 minutes. Airport precipitation reports are retained but not summed.

`npm run weather:prepare` publishes saved source data for the preceding 30 minutes; `--download` fetches missing inputs, and paired `--from`/`--to` options permit at most 45 minutes per job. `--samples` publishes previously validated sample imagery. Radar frames for **September 17 04:00 through 04:30 UTC** and the earlier four weather samples are prepared locally. The September 17 04:00 rainfall endpoint was still unavailable during preparation; the page displays that as missing. This retrospective product's nominal publication delay is about one hour. Recent 404s wait five minutes before retry; historical misses wait six hours, without pausing unrelated files. Provider access restrictions/rate limits still stop other requests on that host.

Weather preparation is **manual**, not an ongoing service. New outage captures can therefore lack prepared weather. Opening the page performs no upstream weather downloads. The API reads only the bounded catalog and verified derived assets; it cannot start jobs or accept arbitrary upstream URLs. The existing preview allowlist recognizes these routes behind its unchanged authentication, but no preview was restarted.

Verification at this checkpoint:

- `npm test`: **86 passing tests**. Added API checks cover future/expired timestamps and DST, corrupt weather without outage disruption, approved image-only access, raw station trace/missing/zero values, projection orientation and missing/zero colors, and recent-file retry isolation. Existing preview tests now cover weather authentication and routing.
- `npm run dashboard:build`: TypeScript and bundled client build passed.
- Browser checks at desktop and 390 × 844 phone viewport: synchronized radar, opacity control layout, zero-rainfall versus unavailable states, station wind/gust plot, historical date replay and clearing weather on period maps. Phone document width stayed within its viewport; new controls computed to 16 px. No browser warnings/errors were observed.
- Managed weather cache measured approximately **97.6 MB**, under its 256 MiB cap. This checkpoint downloaded approximately 28.2 MB of additional radar and METAR source data. No new runtime dependency was added.
- At September 17 04:44 UTC, the independent collector had **146 valid captures, 100% observed slot coverage, no gaps over ten minutes**, and a healthy heartbeat. The 24-hour and seven-day trials remain unfinished.

At this checkpoint the loopback dashboard restarted at `http://127.0.0.1:4173`, with output in ignored `reports/dashboard.weather.stdout.log` and `reports/dashboard.weather.stderr.log`. The planned accumulation/spatial-weighting step and subsequent multi-day controls are now completed in the linked rainfall reports. Current log names and remaining work are in [current status](PROJECT_STATUS.md).

## Implemented

- An explicit `npm run weather:validate -- --download` job fetches four fixed sample cases; its default mode replays saved originals offline. `--case=wet|dry|winter|current` selects a sample. The `current` sample is deliberately pinned to September 16, 2026, not a moving live request.
- Source-built URLs only, one writer/request at a time, a five-minute job deadline, 25-second request timeouts, at most two transient retries, 24 requests and 96 MiB received per run. Requests cannot follow redirects. HTTP 401/403 stops requests to that provider; 429 persists provider-wide Retry-After across runs. Missing, failed, uncached and unavailable observations never become weather zeros.
- Separate weather storage with SHA-256-verified original bodies, atomic manifests, processing versions, source timestamps/intervals, georeferencing and raw quality flags. No automatic deletion. A 256 MiB **pilot cache cap**, 32 MiB response cap and 20 GB free-space floor bound local use. The response cap was raised from 24 MiB after measuring the 28.8 MB current station file. This is not a long-term weather retention capacity claim.
- Original indexed radar PNGs and their world files produce small native-grid crops. Numeric rainfall is decoded from GRIB2 template 5.41 PNG packing, with centre/product/time/grid/scan/CRC checks. Unsupported encodings fail validation. Rainfall subsets retain 4,200 native cells, not values inferred from display colors.
- Station subsets preserve all original columns, field-specific quality/measurement/source codes, missing strings, observation times and location. They are **not quality-filtered observations**. Warning geometries retain their times and provenance, and describe warned areas rather than verified damage.

## Source findings

| Source | Result and interpretation |
| --- | --- |
| IEM N0Q radar originals | Four exact timestamped PNG/world-file pairs retrieved and decoded. Native grid spacing is 0.005 degrees; the selected crop is 141 × 121 pixels. Mosaic nominal time and the embedded generation time remain separate. Archive originals lack a definitive local coverage mask; black/transparent/low-reflectivity areas cannot establish dry weather. [Mosaic documentation](https://mesonet.agron.iastate.edu/docs/nexrad_mosaic/) |
| NOAA MRMS `MultiSensor_QPE_01H_Pass2` | Four archived numeric files decoded. Product identity is discipline 209/category 6/parameter 37, native grid spacing 0.01 degrees, units mm, preceding one-hour interval. This retrospective product has nominal one-hour latency; it must not be described as available at its valid time. Missing/no-coverage sentinels remain null. [Product table](https://www.nssl.noaa.gov/projects/mrms/operational/tables.php), [archive and reuse](https://registry.opendata.aws/noaa-mrms-pds/) |
| NOAA NCEI GHCNh, Memphis International Airport `USW00013893` | Selected as the current station product family because NOAA identifies it as ISD's replacement. Historical station/year PSV files retain timestamps and quality metadata. The tested JSON subset API omitted both DATE/STATION and quality columns despite requested attributes, so that path is rejected. The downloaded 2026 file ends **August 26 at 15:00 UTC**, with no observations for September 16; this is exposed as `no-observations`, not zero weather. [Product](https://www.ncei.noaa.gov/products/global-historical-climatology-network-hourly), [format](https://www.ncei.noaa.gov/oa/global-historical-climatology-network/hourly/doc/ghcnh_DOCUMENTATION.pdf) |
| IEM NWS storm-based warnings, MEG forecast area | Exact-time GeoJSON samples returned two polygons in the wet and winter cases and none in the dry/current cases. This source does not cover all county/zone winter/heat products or finalized Storm Events. MEG is broader than Shelby County; geographic filtering belongs to the later comparison work. [API](https://mesonet.agron.iastate.edu/geojson/sbw.py?help=) |

IEM permits lawful reuse and requests attribution; retain attribution when rendering cached products. [IEM terms](https://mesonet.agron.iastate.edu/disclaimer.php). Its raw hourly MRMS ZIP convenience archive is a rolling 30-day cache, so this implementation uses NOAA's timestamped archive for numeric rainfall. [IEM archive notice](https://mesonet.agron.iastate.edu/archive/mrms.php).

## Saved sample results

Bounds: west −90.3°, south 34.9°, east −89.6°, north 35.5°. Dates below are UTC. These are weather validation samples, not newly imported historical outage observations.

| Case | Radar time | Rainfall hour ending | Local cell estimates | Station coverage | MEG warning polygons |
| --- | --- | --- | --- | --- | --- |
| Wet | 2023-06-25 23:00 | 2023-06-26 00:00 | 0–31.7 mm | 68 records across 48/48 requested report-hours, June 25–26 | 2 |
| Dry | 2023-09-01 18:00 | Same | 0 mm | 32 records across 24/24 report-hours | 0 |
| Winter | 2022-02-03 18:00 | Same | 0.6–4.1 mm | 66 records across 24/24 report-hours | 2 |
| Current archive date | 2026-09-16 18:00 | Same | 0 mm | 0/24 report-hours; source file has no records for this date | 0 |

The winter station records explicitly include `-FZRA` in preserved METAR reports. Radar QPE is not an ice-accretion or snow-depth measurement. Report-hours only measure presence of station reports, not complete or accepted coverage for every variable. The wet radar instant precedes its rainfall endpoint by an hour; these are independent source checks and must not be presented as a synchronized pair.

Initial successful weather downloads totaled approximately **65.0 MB** across the initial run and current-station retry. Saved originals plus derived evidence occupy approximately **69 MB** of the 256 MiB managed cache after verification; preliminary discovery evidence adds about 16 MB outside it. No national data is downloaded continuously. An offline replay takes approximately 3–4 seconds on this PC and performs zero network requests. Single decode timings are local diagnostics, not cloud-runtime measurements. Station derivatives currently retain verbose raw metadata and are not intended as browser payloads.

## Verification

- `npm test`: **80 passing tests**, including 13 new weather tests for timestamps/DST, nearest-prior matching, corrupt originals, path allowlisting, concurrent writers, 404/403/429/redirects, timeout/retry/budget behavior, GRIB scaling and missing values, source identity, station trace/quality fields and warning times.
- Offline replay reproduced all available samples from their originals, with no downloads. The pinned current station period remained explicitly unavailable.
- `scripts/verify-weather-pixels.py`, using an independent Pillow/NumPy decoder, matched **68,244 radar pixels and 16,800 rainfall values** against retained originals. This is a pixel/packing cross-check, not external certification of the weather estimates.
- The separate outage collector continued five-minute captures with 100% observed slot coverage and no gaps while this work ran. The full 24-hour and seven-day trials are still pending.

Evidence: ignored `data/weather/cache/{objects,manifests,derived}`, `data/weather/discovery`, `reports/weather-validation.json`, `reports/weather-download.json`, `reports/weather-pixel-verification.json`, and `reports/weather-tests.log`. Source bodies are identified by SHA-256 in each manifest; derived results retain their source digest and processing version.

## Remaining implementation checkpoints

1. The bounded read-only weather routes, synchronized controls and recent METAR feed are completed in the dashboard checkpoint above. Saved station/year cache entries remain pinned snapshots: add explicit revision/refresh handling before using this pilot cache for an ongoing timeline.
2. Numeric accumulation, interruption/missing-cell handling and native spatial weighting are validated; the expanded extent and prepared period controls are completed in [the rainfall dashboard checkpoint](RAINFALL_DASHBOARD_STATUS.md). Broader period preparation, a prolonged-rain case and further capacity checks remain next.
3. Extend finalized event/zone-warning coverage and field-specific station quality interpretation as needed for comparison work. Preserve current-feed versus legacy outage boundaries.

No user preference is blocking the next local implementation. The latest rainfall dashboard report is the requested check-in before broadening weather preparation and validation.
