# Matched weather reference checkpoint

**September 22 deployment update:** the [DigitalOcean deployment guide](DIGITALOCEAN_DEPLOYMENT.md) is authoritative for current operation. The VM now serves the dashboard and runs both collectors; local collectors are stopped. Runtime counts, preview sessions, trial deadlines and hosting gates below describe this earlier checkpoint. Its scientific findings and dated validation results are preserved.

**Subsequent implementation:** the [autonomous continuation](DEVELOPMENT_COMPLETION_STATUS.md) adds cold/heat cases, original-grid cold summaries and bounded weather refresh/retention. The rainfall/wind methods and results below are unchanged; their test counts, cache sizes, PIDs and preview checks are dated evidence. See [current status](PROJECT_STATUS.md) for the four-case catalog and runtime commands.

Completed September 18, 2026. **Weather comparisons** now includes matched reference periods at `http://127.0.0.1:4173/legacy.html?view=comparisons#matched-reference`. The existing password-protected Quick Tunnel serves the updated page with its unchanged **3:06:19 PM CDT** expiry. This completes the next bounded step after the [initial comparison checkpoint](WEATHER_COMPARISON_STATUS.md).

## Selection and matching

`config/weather-reference-policy.json` fixes `matched-weather-reference-v1`. For each 72-hour case, screen the four periods starting 7, 14, 21 and 28 days earlier. Every matched hour must have the same weekday, local clock hour and UTC offset in America/Chicago. Select the nearest eligible period using calendar, capture timestamps and station weather only; outage levels never enter the selection rule.

Each hour contributes the actual outage capture nearest :30, within 15 minutes; an exact tie uses the earlier capture. Corresponding captures must differ by at most ten minutes within their relative hours. Candidate screening requires at least 48 such pairs, at least 90% coverage for both eligible sustained wind and numeric nominal station precipitation, no precipitation report at or above 0.1 mm, no trace reports, and no eligible sustained wind at or above 10 m/s. Missing values are not zero. The retained selection report includes all eight candidates, source hashes and rejection reasons.

June candidates 7, 14 and 21 days earlier fail the station rainfall screen; the 7-day candidate also exceeds the wind cutoff. May 27–30 qualifies with 56 timestamp pairs. September candidates 7, 14 and 28 days earlier fail the rainfall screen; the 14- and 28-day candidates also exceed the wind cutoff. August 22–25 qualifies with 59 timestamp pairs. Both selected references have 72/72 hours of eligible station wind and numeric precipitation coverage.

Final inclusion additionally requires both periods' rainfall and wind for the previous completed weather hour, with the selected 0, 1 or 3 additional lag hours applied to both sides. Reference regional rain must be below 0.1 mm and sustained airport wind below 10 m/s for that exposure hour. Missing or rainy reference hours are excluded without substituting a different capture or choosing another period based on outage results. Exact capture IDs, original timestamps, counts, weather intervals, wind-report times and every exclusion remain in the JSON/CSV exports.

## Results

All windows below use UTC and exclusive end dates. These are **matched snapshot medians**, distinct from the initial page's hourly peaks.

| Measure | June 24–27, 2023 case | September 12–15, 2024 case |
| --- | ---: | ---: |
| Selected reference | May 27–30, 2023 | August 22–25, 2024 |
| Days earlier | 28 | 21 |
| Reference outage observations | 239 | 208 |
| Reference estimated regional rain over 72 hours | 4.513 mm | 0 mm |
| Highest eligible reference sustained wind | 5.7 m/s | 6.7 m/s |
| Reference rainfall / wind coverage | 72/72 hours each | 72/72 hours each |
| Eligible pairs: 0 / 1 / 3 additional lag hours | 50 / 50 / 49 | 59 / 59 / 57 |
| Case / reference median customers, all pairs at lag 0 | 122.5 / 19 | 3,508 / 169 |
| Higher-rain pairs at lag 0 | 0 | 34 |
| Higher-rain case / reference medians at lag 0 | Unavailable | 5,763.5 / 171 |
| Higher-wind pairs at lag 0 | 0 | 4 |
| Higher-wind medians | Unavailable | Too few pairs |

Six paired hours are required for a group median. June has no eligible higher-rain or higher-wind pairs at any supported lag. September has only four higher-wind pairs at each lag. The interface leaves these sparse results unavailable. Groups overlap, and exclusion-reason totals can overlap too. JSON also retains the median of individual paired differences, which is not generally the difference between the two medians.

The June airport's lack of reported precipitation does not establish dry conditions across the region: radar estimates 4.513 mm over its reference window, with eight exposure hours above the reference rain cutoff. Those hours are excluded. The regional estimate covers the existing 4,849.64 km² rectangle, not a utility service boundary; airport wind is one point observation. Low estimates do not prove dry weather everywhere.

The page shows first-capture outage carryover, the matching method, selection audit, all 72 included/excluded pairs and a dedicated CSV. These observations do not control prior storms, maintenance, heat, demand or other differences. Hours within a storm are dependent; two selected cases and one reference each do not estimate a causal weather effect. The original preceding-72-hour outage context remains separate and unmatched. Missing outage geometry, unique-event identity and adequate customer-hour coverage remain explicit.

## Preparation and reproduction

Run from the repository root with the retained legacy and weather originals available:

```powershell
npm run weather:select-references
node scripts/validate-rainfall-window.mjs --config=config/rainfall-reference-june-2023.json
node scripts/validate-rainfall-window.mjs --config=config/rainfall-reference-september-2024.json
npm run weather:comparisons
python scripts/verify-weather-references.py
python scripts/verify-rainfall-window.py --report=reports/rainfall-reference-june-2023-validation.json
python scripts/verify-rainfall-window.py --report=reports/rainfall-reference-september-2024-validation.json
npm run dashboard:build
```

These commands replay saved sources offline. Python uses the existing NumPy/Pillow environment and IANA timezone data. On a fresh checkout, missing originals must be acquired separately through the bounded rainfall workflow; opening the dashboard never retrieves upstream weather. The new preparation requires the selected reference reports. It verifies the selection policy, legacy index, station revision, rainfall originals and derivative hashes before atomically promoting immutable publications. A changed source or policy requires rescreening. The root comparison format stays `weather-comparison-v1`; the additive matched-reference data has its own version.

Read-only routes use the existing authenticated allowlist:

```text
GET /api/legacy/catalog?view=comparisons
GET /api/legacy/series?view=comparison&id=june-2023&lag=0
GET /api/legacy/export.csv?view=comparison&id=june-2023&lag=0&table=reference
```

The other rainfall/wind case ID is `september-2024`; supported lags are 0, 1 and 3. The later temperature catalog adds `cold-2022` and `heat-2023` through the same routes. Omitting `table` preserves the case-hourly CSV. The reference CSV contains all 72 pairs, including excluded rows. Runtime reads are bounded and verify saved publication hashes. Older publications without reference data retain the original page and return an explicit unavailable response for reference CSV.

Acquisition added **144 hourly rainfall originals in six sequential 24-request batches**, totaling **74,656,397 provider bytes**. All batches completed without errors within the existing per-run limits. Cache usage is **286,635,303 bytes (273.36 MiB)** of 1 GiB. `data/comparisons/` totals **2,442,964 bytes**, including retained earlier immutable publications. No automatic acquisition or retention cleanup was added.

## Verification and operating state

- **154 Node tests and 26 legacy Python tests pass**, along with TypeScript and the production build. Added checks cover selection independence from outage counts, timestamp ties/misalignment, calendar/DST rules, station trace/rain/wind/missing coverage, backward-only weather at all lags, sparse medians, exact pairs, source checksums, and CSV/API bounds.
- Independent Python audit at **13:42:10 UTC** verifies all eight candidate windows, 447 reference observations against the legacy SQLite publication, original station QC/precipitation selection, 144 regional hourly rainfall means and all **432 pair records** across both cases and three lags. It also reruns the existing case/preceding-period audit.
- Separate independent GRIB decoding checks pass for both references: **691,200 native cell values** across 144 hourly frames, plus spatial weighting. Both rainfall validations pass their missing-hour and missing-cell fault checks across all 685 Census areas.
- Offline selector/publication replay at **13:43:59 UTC** reproduces identical selection bytes, catalog and output hashes with zero network requests.
- Authenticated public verification at **13:44:15 UTC** passes all ten checks: both cases/all lags agree with local JSON and both CSV formats, low-reference-weather masks hold, and current-feed, legacy geometry, rainfall assets and access protections pass.
- Desktop and 390-pixel phone checks pass. All four matched-summary columns fit without horizontal overflow; the detailed pair table scrolls within its container. Both cases and all lag settings were checked, with no browser console warnings/errors.

Evidence is in ignored `reports/weather-reference-selection.json`, `weather-reference-verification.json`, `weather-reference-replay.json`, `weather-reference-full-tests.log`, `weather-reference-python-tests.log`, `weather-reference-preview-verification.log`, both `rainfall-reference-*-validation.json` / `-independent.json` reports, and `preview-verification.json`.

At **13:44:38 UTC**, the unchanged collector was healthy with **542/542 valid slots**, no gaps over ten minutes and no pending rollups. Only the dashboard was restarted, to PID **29504**, with logs `reports/dashboard.references.stdout.log` and `.stderr.log`. The collector, preview supervisor and tunnel continued running. This checkpoint stopped for user review; the subsequent continuation implemented cold/heat studies and supported native-grid cold summaries. Full seven-day acceptance, additional independent episodes, richer geographic analysis and permanent cloud deployment remain open.
