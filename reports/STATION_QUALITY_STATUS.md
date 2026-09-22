# Station quality checkpoint

**September 22 deployment update:** the [DigitalOcean deployment guide](DIGITALOCEAN_DEPLOYMENT.md) is authoritative for current operation. The VM now serves the dashboard and runs both collectors; local collectors are stopped. Runtime counts, preview sessions, trial deadlines and hosting gates below describe this earlier checkpoint. Its scientific findings and dated validation results are preserved.

Completed September 17, 2026 at approximately 7:02 PM CDT (September 18, 00:02 UTC). This is the next bounded local Phase 3A checkpoint after [storage and pilot validation](STORAGE_AND_PILOT_STATUS.md).

## Implemented

- Added versioned GHCNh interpretation for temperature, dew point, wind speed, gusts and nominal hourly precipitation. Each field retains its original value, source, report type, source station, quality code and measurement code, together with a separate eligibility decision. Original PSV bodies and prior derivatives remain intact.
- Quality rules are source-specific. For example, `5` passes checks for source 343 but denotes removal for source 223. Gross-limit-only checks, suspect/error flags, integrated QC flags, edited/calculated values and unsupported source/code combinations remain excluded from numeric comparisons. This conservative project policy is not independent certification of the measurements.
- Trace precipitation remains qualitative, with a null numeric amount. Missing readings and withheld readings remain separate from measured zero. Units stay degrees Celsius, meters/second and millimeters without extra scaling.
- Intermediate METAR/SPECI precipitation reports are running totals. A nominal report-hour selects the final report, without adding intermediate amounts or falling back to an earlier good value. This implementation additionally requires a final routine FM15 report at/after minute 45; other hours remain incomplete. It publishes no daily/period station precipitation sum and does not claim exact one-hour observation intervals.
- `npm run weather:quality` now verifies five fixed station windows offline and writes content-addressed derivatives plus `reports/station-quality-validation.json`. The existing `weather:validate` command also includes field-quality summaries and a separate quality derivative for each station sample. The live dashboard's separately labeled METAR series is still as reported; these GHCNh derivatives are preparation for later comparisons.

The policy follows NOAA's [GHCNh specification](https://www.ncei.noaa.gov/oa/global-historical-climatology-network/hourly/doc/ghcnh_DOCUMENTATION.pdf), version 1.1.0 dated March 10, 2026, sections IV, V, VI and IX. The retained specification's SHA-256 is `df5694efdc2d498f006a343165bae65701d14809174b9bed660149bd4fe591b7`; its retrieval manifest and PDF are under `data/weather/discovery/ghcnh-format.*`. This document identifies the tested specification rather than assuming all future source codes have the same meaning.

## Results from retained originals

All dates and report-hours in this table are UTC. Accepted report-hours measure the presence of eligible reports, not continuous measurement coverage.

| Sample | Records | Temperature / wind speed accepted report-hours | Nominal precipitation report-hours |
| --- | ---: | --- | --- |
| June 25–26, 2023 wet sample | 68 | 48/48 each | 48 numeric |
| September 1, 2023 dry sample | 32 | 24/24 each | 24 numeric, all measured zero |
| February 3, 2022 winter sample | 66 | 24/24 each | 14 numeric, 10 trace |
| September 7–9, 2026 recently available sample | 475 | 0/72 eligible under this policy | 55 missing amounts, 10 incomplete/unsupported final hours, 7 missing report-hours |
| September 16, 2026 pinned current sample | 0 | 0/24 | 24 missing report-hours |

The winter sample contains 17 individual trace reports; selecting nominal hours reduces these to 10 trace hours. Its accepted temperatures range from −2.2 to 2.2 °C. Liquid-equivalent precipitation, temperature and airport reports do not establish neighborhood ice accretion or an outage cause. Gust coverage is sparse: 8/48 wet hours, 0/24 dry hours and 11/24 winter hours; absent gust reports are not zero gusts.

The recent available sample uses source codes 412/413 with blank QC metadata for the selected present measurements. Their QC semantics are not covered by the tested source-code policy. The data remains retained and explicitly excluded, rather than being labeled erroneous or accepted by default. The station snapshot still ends September 9 at 16:54 UTC; September 16 has no records. Broadening eligibility for newer source families needs documented source-specific evidence.

## Verification and resources

- `npm test`: **123 passing tests**, including eight new tests covering differing source-code meanings, integrated flags, unknown codes, numeric/missing/trace handling, calm wind, overlapping precipitation reports, late unusable reports, UTC/DST boundaries, provenance and identity/location checks.
- Independent stdlib Python verification matched **641 records and 3,205 field-metadata sets** to three SHA-256-verified compressed annual originals. It also verified each derivative hash and the retained specification hash. Reproduce with `python scripts/verify-station-quality.py` after `npm run weather:quality`.
- Full four-case weather replay passed for available products; current station absence remained `no-observations`. Both quality validation and weather replay made **zero network requests**.
- Quality preparation took about **1.75 seconds** locally and added about **0.82 MiB** of derivatives. Managed cache use is **153,656,766 bytes / 146.5 MiB of 1 GiB**. No new runtime dependency, weather source download, retention change or collector restart was needed.
- At **00:01:50 UTC September 18 / 7:01:50 PM CDT September 17**, the collector had **378/378 valid observed slots**, 100% observed coverage, no gaps over ten minutes, no pending rollups and a healthy heartbeat/storage status. Its original seven-day window still ends September 23 at 17:04:02.511 UTC. This health check does not replace final seven-day acceptance.

Evidence is in ignored `reports/station-quality-{validation,provenance-verification,collector-health}.json`, `reports/station-quality-tests.log`, `reports/station-quality-weather-replay.log`, and the derivative keys recorded in the validation report. The application UI was not changed; no new browser validation was needed for this source-processing checkpoint.

## Subsequent work and remaining scope

The [finalized-event and county/zone-warning checkpoint](EVENT_CONTEXT_STATUS.md), legacy audits and [separate legacy dashboard](LEGACY_DASHBOARD_STATUS.md) subsequently completed. Initial rainfall/wind cases and [matched references](WEATHER_REFERENCE_STATUS.md) use this QC policy. The [September 18 continuation](DEVELOPMENT_COMPLETION_STATUS.md) applies it to cold/heat comparisons and adds original-grid cold summaries plus bounded rolling radar/rainfall/METAR refresh/retention. The as-reported METAR display remains separate from QC-controlled comparisons. Unsupported station families, richer exposure analysis and operation beyond the trial remain open. The 24-hour pilot is complete; [current status](PROJECT_STATUS.md) records the ongoing seven-day trial and latest evidence.
