# Initial weather comparison checkpoint

**September 22 deployment update:** the [DigitalOcean deployment guide](DIGITALOCEAN_DEPLOYMENT.md) is authoritative for current operation. The VM now serves the dashboard and runs both collectors; local collectors are stopped. Runtime counts, preview sessions, trial deadlines and hosting gates below describe this earlier checkpoint. Its scientific findings and dated validation results are preserved.

This is the initial dated checkpoint. The subsequent [matched reference checkpoint](WEATHER_REFERENCE_STATUS.md) completes the rainfall/wind reference-period step. The later [autonomous continuation](DEVELOPMENT_COMPLETION_STATUS.md) adds cold/heat comparisons, original-grid cold summaries, bounded weather refresh/retention and the 172-test result. Counts, sizes, process IDs and access statements below describe this original checkpoint; see [current status](PROJECT_STATUS.md) for operation.

Completed September 18, 2026. The dashboard now includes **Weather comparisons** at `http://127.0.0.1:4173/legacy.html?view=comparisons`. The existing password-protected Quick Tunnel serves the same page and data, with its original September 18 **3:06:19 PM CDT** expiry. The tunnel and credentials were not replaced.

This first bounded Phase 5 checkpoint covered regional rainfall/wind comparisons for two prepared 72-hour periods. Matched references and cold/heat studies subsequently completed in the linked reports. These two rainfall/wind periods still lack geometry and cannot support geographic attribution or inferential conclusions.

## Results and coverage

All dates and hour boundaries below are UTC, with exclusive window ends.

| Measure | June 24–27, 2023 | September 12–15, 2024 |
| --- | ---: | ---: |
| Verified outage observations | 228 | 201 |
| Hours containing outage observations | 67 / 72 | 69 / 72 |
| Observed customer peak | 117,861 | 24,582 |
| Customer peak capture | June 26 03:54:02.943589 | September 12 23:25:35.388248 |
| Observed reported-outage peak | 668 | 293 |
| Native-grid, area-weighted rainfall estimate | 8.553 mm | 117.037 mm |
| Available hourly rainfall estimates | 72 / 72 | 72 / 72 |
| Hours with accepted sustained-wind reports | 72 / 72 | 72 / 72 |
| Highest accepted sustained-wind report | 9.8 m/s | 12.4 m/s |
| Hours with accepted gust reports | 8 / 72 | 23 / 72 |
| Minutes eligible for interruption burden | 34.3615 / 4,320 | 0 / 4,320 |
| Full-period customer-hours | Unavailable | Unavailable |
| Verified outage grid snapshots | 0 | 0 |

Rainfall is NOAA MRMS MultiSensor QPE 01H Pass 2 on its retained 80 × 60 native grid. The area-weighted mean covers the 4,849.64 km² rectangle from 34.9–35.5°N and 90.4–89.6°W; it is not a utility service boundary or population-weighted exposure. The airport source is NOAA GHCNh station USW00013893, with the previously validated source-specific QC policy. Airport conditions do not describe every neighborhood or the strongest storm wind.

Customer and reported-outage peaks are selected separately and retain their exact capture timestamps and IDs. Neither counts unique customers or unique events. Customer-hours follow left steps only between observations at most 7.5 minutes apart, with no boundary extrapolation or gap filling; the period metric requires at least 90% coverage. Partial contributions remain labeled in the JSON data. Total-only periods cannot support outage-location maps or spatial attribution.

## Comparison rules and interface

- Case selector, three aligned charts, condition matrix, joint coverage, preceding-period context, archived event/advisory labels, accessible hourly table, CSV and source-bearing JSON downloads.
- Each outcome hour pairs with the **previous completed weather hour**, followed by 0, 1 or 3 additional lag hours. No later rainfall interval or station report enters an earlier outcome hour. Charts retain actual observation hours instead of shifting the weather traces.
- Conditions use estimated rain ≥0.1 mm and reported sustained wind ≥10 m/s. These are analytical cutoffs, not official storm classifications. Overlapping groups are not additive.
- Group medians require six hours with both weather and outage observations. At zero additional lag, June has only **one** matched higher-rain hour and no higher-wind hours; those medians stay unavailable. September has 40 higher-rain hours and six higher-wind hours. Hourly measurements within a storm are dependent; this remains two selected cases, not an estimated weather effect.
- The preceding 72 hours show outage observations only: June has 240 captures across 69 hours; September has 67 across 24 hours. Rainfall is not prepared for those preceding windows, so they are explicitly not matched dry controls. Existing-outage carryover is shown using the first observed count, without assigning event onset.
- NOAA Storm Events context retains its actual selection interval, which begins June 25 for the June example. IEM warning context is an exact archived instant, not complete period coverage. No matching Storm Events records in the September selection does not imply no severe weather. Labels and county/zone outlines do not establish outage causes or damage footprints.
- Legacy and current-format data remain separate. Unique/new-event counts and per-capita weather rates stay unavailable because these consolidated totals do not supply stable event identity or an appropriate denominator.

## Reproduction and verification

`config/weather-comparisons.json` fixes the case IDs, source report paths, time bounds and metric rules. Run:

```powershell
npm run weather:comparisons
python scripts/verify-weather-comparisons.py
npm run dashboard:build
```

Preparation is offline and bounded. It verifies the legacy index, rainfall derivatives and originals, station originals, and event/warning context. It writes immutable hash-named data/input bundles beneath ignored `data/comparisons/`, then atomically promotes the catalog. Repeating preparation produced identical catalog and output hashes. The HTTP service only reads prepared cases, validates IDs/lags and checks publication hashes; browser requests cannot trigger upstream weather retrieval.

The only new acquisition was the missing 2024 station annual original: one successful request, 12,052,997 provider bytes, stored losslessly compressed. The weather cache uses **200,519,811 bytes (191.2 MiB)** of its 1 GiB cap. The active comparison catalog, publications and input bundles total **660,432 bytes**; earlier immutable outputs remain retained, bringing this directory to **1,136,738 bytes**. No weather schedule or retention cleanup was added.

Validation passed:

- **148 Node tests and 26 legacy Python tests**, plus TypeScript and production build.
- Independent Python audit of all **429 case observations**, **307 preceding-period observations**, all **144 hourly native-cell rainfall means**, original PSV-derived wind/gust maxima, burden intervals, exact peak anchors, missing values and all three lag/group selections. Rainfall GRIB decoding retains its earlier independent checkpoint; this audit rechecks original hashes and independently weights verified native cells.
- Seven new tests cover hour-boundary burden splitting, long gaps, empty versus observed zero, count-peak anchors, unsupported/duplicate timestamps, source QC exclusions, no future weather, sparse groups, checksums, request bounds, CSV and read-only HTTP behavior.
- Public tunnel check at **13:06:09 UTC**: both cases and all lags match local JSON and CSV exactly; anonymous data/assets remain blocked, archive/admin/write routes remain inaccessible, HTTPS/session protections hold, and current-feed, legacy-grid and six rainfall-period checks still pass.
- Desktop and 390-pixel phone checks: cases and all lag controls work, 72-row table and download links agree, no page overflow, no console warnings/errors. Outage, rainfall and wind charts use separate scales and a common plot alignment.

Evidence is saved in ignored `reports/weather-comparison-preparation.json`, `reports/weather-comparison-verification.json`, `reports/weather-comparison-full-tests.log`, `reports/weather-comparison-python-tests.log`, `reports/weather-comparison-preview-verification.log` and `reports/weather-comparison-collector-status.json`.

At **12:59:42 UTC**, the unchanged collector remained healthy with **533/533 valid slots**, no gaps over ten minutes and no pending rollups. Only the local dashboard process was restarted (PID 19000); logs are `reports/dashboard.comparisons.stdout.log` and `.stderr.log`. Seven-day trial acceptance and permanent cloud deployment remain separate.
