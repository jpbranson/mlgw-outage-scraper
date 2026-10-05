---
type: Checkpoint Report
title: "Finalized events and county/zone warning checkpoint"
description: "September 17, 2026 pinned NOAA Storm Events, exact-time IEM alerts, preserved administrative geometry, archive coverage limits and independent verification."
tags: [weather, events, warnings]
status: stable
generated: { by: "codex/unknown", at: 2026-09-22T16:41:52Z }
verified: { by: "process:documentation-review", at: 2026-09-23T04:16:15Z }
sources:
  - id: event-validation
    resource: "../../reports/event-context-validation.json"
    title: "Event context validation (local, ignored by Git)"
    last_modified: 2026-09-23T07:29:34Z
  - id: event-provenance
    resource: "../../reports/event-context-provenance-verification.json"
    title: "Independent event provenance check (local, ignored by Git)"
    last_modified: 2026-09-23T07:29:44Z
  - id: event-offline
    resource: "../../reports/event-context-offline-verification.json"
    title: "Offline event replay (local, ignored by Git)"
    last_modified: 2026-09-18T00:59:20Z
  - id: storm-events-format
    resource: "https://www.ncei.noaa.gov/pub/data/swdi/stormevents/csvfiles/Storm-Data-Bulk-csv-Format.pdf"
    title: "NOAA Storm Events bulk CSV format"
  - id: storm-events-archive
    resource: "https://www.ncei.noaa.gov/pub/data/swdi/stormevents/csvfiles/"
    title: "NOAA Storm Events archive"
  - id: iem-watchwarn
    resource: "https://mesonet.agron.iastate.edu/cgi-bin/request/gis/watchwarn.py?help="
    title: "IEM warning snapshot service"
---
# Finalized events and county/zone warning checkpoint

**September 22 deployment update:** the [DigitalOcean deployment guide](../operations/digitalocean-deployment.md) is authoritative for current operation. The VM now serves the dashboard and runs both collectors; local collectors are stopped. Runtime counts, preview sessions, trial deadlines and hosting gates below describe this earlier checkpoint. Its scientific findings and dated validation results are preserved.

Completed September 17, 2026 around 8:00 PM CDT (September 18, 01:00 UTC), following [station quality validation](station-quality.md).

## Implemented

`npm run weather:events` now replays six fixed cases from the isolated local weather cache. Add `-- --download` to retrieve missing pinned originals, or `-- --case=winter` to select one case (`wet`, `dry`, `winter`, `heat`, `francine`, `current`). The default is offline. Source URLs are constructed and allowlisted; the existing single-writer, request, response, cache, timeout and provider-backoff limits apply. This command prepares source evidence and derivatives; it does not import outages or add dashboard controls.

The new processor distinguishes:

- **Published NOAA Storm Events:** bounded decompression and CSV parsing of four pinned annual detail archives, filtered to Tennessee Shelby County (`TNC157`) or the Shelby public forecast zone (`TNZ088`). Event/episode IDs, all source columns, narratives, reported endpoints and source time fields survive. County and zone references stay distinct. Reported endpoints are not converted into damage polygons.
- **NWS watches, warnings and advisories via IEM:** exact-time snapshots for the MEG office, filtered to the two Shelby administrative codes, plus each selected event's original county/zone GeoJSON. The existing storm-polygon source remains separate. These snapshots do not claim to enumerate every warning during an entire multi-day period.
- **Different missing-data states:** a successfully queried empty historical selection is `no-matching-records`; a date beyond the archive's observed event months is `outside-observed-archive-months`. Unavailable, malformed or uncached sources fail validation instead of becoming zero hazards.

NOAA local event times use the explicit `CST-6` field, including in summer, rather than applying Central daylight-saving time. For example, June 25 at 17:36 source time converts to 23:36 UTC. IEM's documented UTC fields remain UTC. Selected warning intervals use `[begin, end)`; later archive cancellation, expiry and extension statuses are retained but are not treated as the status of the original message at the selected instant.

Sources: NOAA's [bulk format specification](https://www.ncei.noaa.gov/pub/data/swdi/stormevents/csvfiles/Storm-Data-Bulk-csv-Format.pdf), [archive directory](https://www.ncei.noaa.gov/pub/data/swdi/stormevents/csvfiles/) and [revision convention](https://www.ncei.noaa.gov/pub/data/swdi/stormevents/csvfiles/README); IEM's [warning snapshot service](https://mesonet.agron.iastate.edu/cgi-bin/request/gis/watchwarn.py?help=), [event geometry service](https://mesonet.agron.iastate.edu/geojson/vtec_event.py?help=) and [UGC listing](https://mesonet.agron.iastate.edu/json/state_ugc.py?help=). Documentation/index originals and retrieval hashes are retained under `data/weather/discovery/`. NOAA format SHA-256: `3bd18968d34da43e192f8a7fb8e5548c4fa7d24ede016d2d068d849ee1392df6`.

## Validated cases

Periods and warning instants below are UTC. Warning counts describe administrative alerts at the chosen instant, not verified damage or continuous period coverage.

| Case | Finalized event period | Selected NOAA records | Warning snapshot and selected alerts |
| --- | --- | --- | --- |
| Wet | June 25–26, 2023 | 10 thunderstorm-wind events and 1 excessive-heat event | June 25 at 23:00: severe thunderstorm watch and heat advisory |
| Dry | September 1, 2023 | No matching records | September 1 at 18:00: no matching warnings |
| Winter | February 3, 2022 | 1 ice-storm event | February 3 at 18:00: ice-storm warning |
| Heat | June 29, 2023 | 1 excessive-heat event overlapping the selected day | June 29 at 18:00: excessive-heat warning |
| Francine | September 12–14, 2024 | No matching Shelby records in the pinned archive | September 12 at 18:00: flood watch, flood advisory and wind advisory |
| Pinned current case | September 16, 2026 | Outside observed archive months | September 16 at 18:00: heat advisory |

The Francine difference is material: rainfall estimates and warning records exist even though no finalized Shelby record matches the selected period. Absence in the event database does not establish absence of a hazard. Likewise, the current archive contains records beginning only in **January–May 2026**, so it cannot support a September event-absence claim.

Pinned NOAA detail releases and measured national row counts:

| Data year | Creation revision | CSV rows | Shelby county/zone records across that year |
| --- | --- | ---: | ---: |
| 2022 | 20260625 | 69,887 | 36 |
| 2023 | 20260323 | 75,593 | 104 |
| 2024 | 20260728 | 69,801 | 41 |
| 2026 | 20260910 | 28,841 | 18 |

Historical archives have entries beginning in all twelve months; that observation is not a completeness guarantee. NOAA can revise prior-year records. Changing a pinned release requires an explicit source update, while retained manifests and originals preserve the evidence used here.

All eight selected warning records have a preserved administrative polygon with 205 vertices. Identity, coordinate bounds and ring closure pass validation; an independent check reproduces the feature, vertex counts and bounds. The source's historical boundary vintage is not independently certified, and these polygons do not show where damage or hazardous conditions occurred within the county/zone. The archive can include later changes to warning end times; it is retrospective context, not a reconstruction of exactly what a forecaster knew earlier.

## Verification and resources

- **134 tests passed**, including 11 new tests for pinned/allowlisted requests, bounded quoted CSV parsing, explicit standard-time/DST behavior, county-versus-zone identity, event overlap, duplicate records, archive cutoffs, prior-issued warnings, later cancellations, invalid geometry and missing-source distinctions.
- Independent Python CSV/date/gzip checks verified **244,122 annual source rows**, the **13 selected events**, **8 warning records**, **1,640 geometry vertices**, and all **18 referenced original-body hashes**. Event UTC times independently matched the textual source date columns. Run `python scripts/verify-event-context.py` after `npm run weather:events`; it needs only Python's standard library.
- A complete offline replay made **zero requests**, took **5.54 seconds** locally, and reproduced all **12 derivative hashes** exactly. These timings are local diagnostics.
- Managed acquisition retrieved **45,365,770 bytes (43.3 MiB)** across **18 successful source requests**. The separate documentation/discovery probes added about 0.4 MB outside the managed cache. The largest expanded annual CSV was 72,909,648 bytes, below the new decoder's 128 MiB expansion limit; parsing retains only local event records rather than the full national table.
- Weather cache use is **199,142,236 bytes / 189.9 MiB of 1 GiB**. Existing storage limits and retention behavior are unchanged. No additional runtime dependency or background weather job was installed.
- At **00:57:59 UTC September 18 / 7:57:59 PM CDT September 17**, the collector had **389/389 valid observed slots**, 100% observed coverage, no gaps over ten minutes, no pending rollups and healthy heartbeat/storage status. The seven-day window remains scheduled to end September 23 at 17:04:02.511 UTC. Its final acceptance remains pending actual end-of-run evidence.

Evidence: ignored `reports/event-context-validation.json`, `event-context-download-validation.json`, `event-context-provenance-verification.json`, `event-context-offline-verification.json`, `event-context-collector-health.json`, associated logs, and the original/derivative hashes referenced by the reports. The existing UI and outage archive were not modified by this processing checkpoint.

## Next checkpoint

The subsequent Phase 4A [overlap/staging](../legacy/repository-audit.md), [timezone recovery](../legacy/timezone-recovery.md) and [capture-coverage](../legacy/coverage-audit.md) audits are complete for their stated scope. The [legacy dashboard](../legacy/legacy-dashboard.md) publishes verified history with visible gaps, source boundaries and retained exceptions. Initial rainfall/wind cases and [matched references](matched-references.md) subsequently completed. The [September 18 continuation](autonomous-continuation.md) adds cold/heat cases, original-grid cold summaries, bounded rolling weather refresh/retention and a local desktop-transfer rehearsal. Weather does not fill outage gaps. Additional source families, richer exposure analysis, operation beyond the trial and provider-backed deployment/transfer installation remain open.
