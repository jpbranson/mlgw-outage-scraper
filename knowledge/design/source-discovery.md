---
type: Design Section
title: "Source discovery: what is already verified"
description: "Verified MLGW feed fields, legacy scraper measurements and documented historical weather sources with their limits."
tags: [design, sources, legacy, weather]
status: stable
generated: { by: "codex/unknown", at: 2026-09-22T16:41:52Z }
verified: { by: "process:documentation-review", at: 2026-09-23T04:16:15Z }
sources:
  - id: mlgw-feed
    resource: "https://outagemap.mlgw.org/geojson.php"
    title: "MLGW outage GeoJSON feed"
  - id: mlgw-map
    resource: "https://outagemap.mlgw.org/OutageSummary.php"
    title: "MLGW outage map page"
  - id: mlgw-map-description
    resource: "https://www.mlgw.com/outagemap/"
    title: "MLGW outage map description"
  - id: legacy-repo-3
    resource: "https://github.com/jpbranson/mlgw.outage.3/tree/ea0c8309337171b398ffadd5d6105d997f9b354b"
    title: "mlgw.outage.3 at ea0c830"
  - id: iem-mosaic
    resource: "https://mesonet.agron.iastate.edu/docs/nexrad_mosaic/"
    title: "IEM NEXRAD mosaic documentation"
  - id: mrms-service
    resource: "https://mapservices.weather.noaa.gov/raster/rest/services/obs/mrms_qpe/ImageServer"
    title: "NOAA MRMS QPE image service"
  - id: mrms-archive
    resource: "https://registry.opendata.aws/noaa-mrms-pds/"
    title: "NOAA MRMS open-data archive"
  - id: ghcnh
    resource: "https://www.ncei.noaa.gov/products/global-historical-climatology-network-hourly"
    title: "NOAA GHCNh product page"
  - id: storm-events-guide
    resource: "https://www.ncei.noaa.gov/access/storm-events-database/assets/pdf/Storm_Events_Database_User_Guide.pdf"
    title: "NOAA Storm Events user guide"
---
# 2. Source discovery: what is already verified

Direct requests to the live map and its feed succeeded during this planning session. The map itself points to the GeoJSON URL; no login, browser automation, or map-tile extraction was needed.

| Source | Verified observation |
| --- | --- |
| [MLGW outage-map page](https://outagemap.mlgw.org/OutageSummary.php) | Loads `geojson.php` into an ArcGIS GeoJSON layer. Its JavaScript sets a 900-second page-refresh timer. It renders individual features and clusters them in the browser. |
| [MLGW GeoJSON feed](https://outagemap.mlgw.org/geojson.php) | Returns a JSON `FeatureCollection` with point coordinates and outage properties. The inspected response contained 15 features totaling 290 affected customers. This is one observation, not a sizing forecast. |
| [MLGW map description](https://www.mlgw.com/outagemap/) | Describes general outage information across Shelby County, based on reported and known outages; exact address details are deliberately unavailable. |

Observed field mapping:

| Source field | Proposed interpretation |
| --- | --- |
| `OUTAGE_NO` | Source outage identifier; store as a string |
| `CUR_CUST_AFF` | Currently affected customer count |
| `TIME_STAMP` | Reported start time, as labeled by the map popup |
| `EST_REPAIR_TIME` | Estimated restoration time; sometimes empty |
| `DURATION` | Source duration text; preserve, but calculate analytic durations from timestamps |
| `STATUS`, `IMPACT` | Source status and qualitative affected-area description |
| `geometry.coordinates` | Longitude, latitude; preserve the original GeoJSON |
| Feature `id` | Small sequential numbers in the sample; do not use for cross-snapshot identity |
| `OUT_CAUSE` | Present, often blank, and omitted from the map's visible popup; exclude from the initial dashboard |

The sample had no top-level feed update timestamp and no `ETag` or `Last-Modified` response header. The HTML page's “current as of” text must not automatically be treated as the GeoJSON's publication time. The outage host's `robots.txt` returned 404; that does not establish a reuse license.

Before production, check applicable source terms and any published collection guidance, and document the endpoint contract. Use a contactable application User-Agent, low request volume, and backoff. If access becomes restricted, stop and reassess the supported source. No customer-account access is needed.

**Unverified for the current feed:** publication cadence, outage-ID stability/reuse, coordinate precision, and completeness during storms. New-feed history starts with collection. The earlier scraper provides a separate historical source, described below; missing observations cannot be reconstructed.

## Historical evidence from the earlier scraper

Inspected [jpbranson/mlgw.outage.3 at revision `ea0c830`](https://github.com/jpbranson/mlgw.outage.3/tree/ea0c8309337171b398ffadd5d6105d997f9b354b). Analysis used its consolidated R data and the complete current file tree, plus one saved page/event pair. It did not scan every historical Git commit or establish all-time MLGW storm maxima.

| Measurement | Result | Design implication |
| --- | --- | --- |
| Consolidated event records | 1,997,747 rows; 53,274 distinct observation timestamps across 806 dates, February 8, 2022–February 20, 2025 | Existing history can seed storm comparisons; these are repeated event observations, not two million unique outages. |
| Largest recorded affected-customer total | **117,861**, June 26, 2023; 601 reported outages in that observation | Charts and anomaly rules must handle large changes in customer count independently of feature count. |
| Largest recorded outage total | **3,998**, February 8, 2022; 45,382 affected customers | Use about 4,000 current-format features as an observed-scale stress case, plus 10,000 for headroom. |
| Event rows at the largest outage total | 4,094 rows, but 3,998 distinct extracted event identifiers | Legacy imports must deduplicate within a capture and must not use raw row count as the outage total. |
| Recent saved snapshot files | 20,934 files forming 10,467 timestamp pairs, September 11, 2024–February 20, 2025; **38.86 MB combined** | Compressed historical storage is encouraging, but covers a different format and a limited date range. |
| Bytes per recent compressed pair | Mean 3.71 KB; median 3.49 KB; 95th percentile 5.13 KB; maximum 17.95 KB | Compression should be measured early in the new design. These are not new GeoJSON payload estimates. |
| Largest saved page in that recent tree | September 12, 2024: 114,121 bytes of extracted page text, stored as a 12,948-byte RDS; associated page summary: 20,793 customers / 293 outages | A concrete storm fixture for legacy parsing, separate from the larger storms in consolidated history. |
| Filename-based capture spacing in that recent tree | Median 17.2 minutes; 95th percentile 41.1 minutes; about 64% of intervals exceeded 15 minutes | The recorded archive does not deliver consistent 15-minute sampling. This is an observation of stored files, not proof that scheduler delay alone caused every gap. |

Method: extract one unique `(time, outage_num, cust_affected)` summary per timestamp from [`total_outages.rds`](https://github.com/jpbranson/mlgw.outage.3/blob/ea0c8309337171b398ffadd5d6105d997f9b354b/total_outages.rds); never sum its repeated customer totals. For file sizes, pair `.RData` and `_txt.rds` by filename timestamp in the [saved data directory](https://github.com/jpbranson/mlgw.outage.3/tree/ea0c8309337171b398ffadd5d6105d997f9b354b/data). File gaps use local filename times and are approximate around DST. Dates above follow the stored timestamp date; timezone reconciliation is part of import.

The [`total_parsed_polygons.rds`](https://github.com/jpbranson/mlgw.outage.3/blob/ea0c8309337171b398ffadd5d6105d997f9b354b/total_parsed_polygons.rds) file contains 18,906 snapshots with finite spatial coordinates, 127 distinct grid-cell IDs, and coverage dated March 8, 2022–April 27, 2024. Its 154,933 valid snapshot/cell records expand to 774,665 vertex rows. Other rows include missing-coordinate placeholders; those are not extra outages. The latest [scraper source](https://github.com/jpbranson/mlgw.outage.3/blob/ea0c8309337171b398ffadd5d6105d997f9b354b/R/job.R) has polygon processing commented out, so spatial coverage must be audited separately from total-count coverage.

Import this history with `source_format=legacy_html` and preserve its geographic grid polygons. Use `source_format=current_geojson` for new point features. Legacy cell IDs are geographic-area IDs, not current outage IDs; do not turn grid centroids into precise outage locations or distribute grid customer totals among individual events. Show a source-format boundary on charts and do not use old-map observations to train the new-feed anomaly baseline without a comparability check.

The owner's three-repository [September 17 overlap audit](../legacy/repository-audit.md) confirms that all consolidated total observations and valid spatial records from `mlgw.outage` and `mlgw.outage.2` are contained in `mlgw.outage.3` at the pinned branch tips. Separate compressed staging retains all provenance for the 53,274 total observations and 18,906 grid captures, with no matching-identity conflicts. Subsequent [timezone recovery](../legacy/timezone-recovery.md) resolves 53,273 totals and all grid snapshots, leaving one total explicitly unresolved. The [coverage audit](../legacy/coverage-audit.md) inventories 53,679 captures across selected revisions, classifies empty/failed captures and retains one extra nonempty original for reconciliation. These completed audits preserve original staging. The [separate dashboard publication](../legacy/legacy-dashboard.md) is complete for verified totals and grid snapshots; an exhaustive raw-page/Git-history import is outside that completed scope.

## Historical weather sources: documented candidates

Source documentation was reviewed September 16, 2026. The September 16–17 [weather checkpoints](../weather/phase-3a-weather-sources.md) subsequently verified bounded radar, numeric rainfall, station and warning samples, followed by dashboard controls, airport observations, 24/48/72-hour rainfall validation/display, source-specific station quality interpretation and finalized event/county-zone warning checks. The supported sample checkpoints and separate legacy import are complete. September 18 adds four verified case/reference comparisons and bounded rolling refresh/retention; additional station source families remain excluded until validated. Further historical comparisons must meet the same explicit coverage and alignment checks.

| Source | Planned use | Resolution, history and limits |
| --- | --- | --- |
| [Iowa Environmental Mesonet NEXRAD mosaics](https://mesonet.agron.iastate.edu/docs/nexrad_mosaic/) and [timestamped map services](https://mesonet.agron.iastate.edu/ogc/) | Historical radar reflectivity overlay synchronized with outage replay | Five-minute mosaics; the higher-detail N0Q archive is documented from November 2010. Reflectivity is a signal in dBZ, not rainfall depth or confirmed surface precipitation. Check actual frame availability; transparent pixels alone cannot prove dry conditions. |
| [NOAA MRMS precipitation products](https://mapservices.weather.noaa.gov/raster/rest/services/obs/mrms_qpe/ImageServer), [IEM archived layers](https://mesonet.agron.iastate.edu/ogc/) and [NOAA open-data archive](https://registry.opendata.aws/noaa-mrms-pds/) | Rainfall-rate/accumulation display and quantitative spatial rainfall summaries | Approximately 1 km products. IEM documents archived 1/24/48/72-hour accumulation layers at hourly endpoints since early 2015. NOAA's open archive starts in October 2020. Use numeric grids for analysis, not colors sampled from display tiles. Product variants, gauge adjustment, version changes, coverage and units must remain explicit. |
| [NOAA GHCNh](https://www.ncei.noaa.gov/products/global-historical-climatology-network-hourly), replacing Global Hourly / ISD | Historical temperature, dew point/humidity, wind/gusts, precipitation and available present-weather/snow observations | Validated station/year PSV samples preserve quality fields; the tested JSON subset path omitted essential metadata. The refreshed Memphis snapshot ends September 9, 2026 at 16:54 UTC; the prior August 26 snapshot is retained and the September 16 sample remains unavailable. Station readings remain regional, with source-specific quality, reporting interval and location. |
| [NOAA Storm Events](https://www.ncei.noaa.gov/access/storm-events-database/assets/pdf/Storm_Events_Database_User_Guide.pdf), with [IEM NWS warning archives](https://mesonet.agron.iastate.edu/ogc/) where supported | Context for flash floods, thunderstorm winds, snow/ice, heat and other documented episodes | Event records can be county/forecast-zone based and are published with a delay. Warning polygons describe warned areas, not confirmed damage footprints. Missing reports do not establish that a hazard was absent. Audit archive completeness and geometry before spatial use. |

The later [event-context checkpoint](../weather/event-context.md) validates six selected cases using pinned 2022/2023/2024/2026 NOAA detail files and IEM county/zone warning snapshots. Thirteen selected event records and eight administrative alerts independently verify. The current NOAA release only has events beginning through May 2026, so September stays outside observed coverage. Warning boundary vintage is not independently certified, and archived later updates prevent treating these records as exact issuance-time replays.

IEM's [MRMS archive notice](https://mesonet.agron.iastate.edu/archive/mrms.php) now describes a rolling 30-day cache for hourly raw ZIP files. Do not treat that convenience cache as permanent storage; use the documented long-term archives and preserve the inputs needed for each saved analysis. NOAA's MRMS open-data archive does not require an AWS account. Access methods and caching conditions must be checked during implementation; public data availability is not an uptime guarantee.

The current-feed outage archive starts September 16, 2026, but the already identified legacy observations can support older weather comparisons in the separate legacy archive. Spatial comparisons are limited by the separate legacy geometry coverage and gaps described above. Total-only observations support regional time-series comparisons, not invented neighborhood maps.

**Legacy timezone recovery update:** the separate [verified recovery catalog](../legacy/timezone-recovery.md) resolves 53,273 historical total observations and all 18,906 grid snapshots. One total's timezone remains unresolved. Full original-epoch checks, source-version/commit rules and independent R verification replace the earlier blanket unresolved-time status for supported records. The subsequent [capture-coverage checkpoint](../legacy/coverage-audit.md) inventories 53,679 captures, classifies empty/failed records and preserves one extra nonempty original for reconciliation. The [legacy dashboard](../legacy/legacy-dashboard.md) now exposes those gaps and exclusions in a separate archive view. Original staging is preserved.
