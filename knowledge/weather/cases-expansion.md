---
type: Checkpoint Report
title: "Weather case expansion checkpoint"
description: "September 23, 2026 four additional screened cases, the 8-bit MRMS decoding fix, downloads, storage, verification and the VM data files."
tags: [weather, comparisons, rainfall]
status: stable
generated: { by: "claude-code/claude-opus-5-5", at: 2026-09-23T07:41:28Z }
sources:
  - id: expansion-reports
    resource: "../../reports/weather-cases-expansion-*.json"
    title: "Case expansion reports (local, ignored by Git)"
  - id: candidates
    resource: "../../config/weather-candidates.json"
    title: "Outcome-blind candidate screen"
    last_modified: 2026-09-23T07:17:07Z
  - id: reference-policy
    resource: "../../config/weather-reference-policy.json"
    title: "Policy matched-weather-reference-v1"
    last_modified: 2026-09-18T13:30:24Z
---
# Weather case expansion checkpoint

Completed September 23, 2026. The Weather comparisons catalog now has **eight** 72-hour cases: the four earlier cases plus two heat cases and two rainfall/wind cases. Selection, thresholds and reference policy are unchanged (`matched-weather-reference-v1`). No outage value entered date or reference selection. Outcome values below were read only after publication.

All windows use UTC with exclusive ends.

## Screen

`config/weather-candidates.json` now records four more fixed event dates from pinned NOAA Storm Events archives (Shelby County / TNZ088). `npm run weather:screen` made zero requests and reproduced the earlier eight candidate results exactly. The earlier failures (March 2023, March 24 2023, May 2024, January 2023 ice, January 2024 snow, August 2023 heat) are retained unchanged.

| Candidate | Window | Anchors | Grid captures | Finalized context | Result |
| --- | --- | ---: | ---: | --- | --- |
| `heat-june-2022` | June 13–16, 2022 | 61 | 187 | Excessive Heat, Heat | Eligible; 28-day reference |
| `heat-august-2024` | August 15–18, 2024 | 69 | 0 | Excessive Heat ×2 | Eligible; 7-day reference |
| `wind-march-2023` | March 3–6, 2023 | 64 | 0 | High Wind | Eligible; 14-day reference |
| `storm-aug30-2024` | August 30–September 2, 2024 | 67 | 0 | Thunderstorm Wind | Eligible; 7-day reference |

Rejected nearer references: June 2022 at 7/14/21 days (station rain/trace, coverage, wind); March 2023 at 7 days (rain/trace, coverage). Both August cases use their nearest, 7-day reference. The rain/wind references were selected by `npm run weather:select-references`. That run reproduced the existing June 2023 and September 2024 selections byte-for-byte.

## Results

Pairs are included matched pairs at 0 / 1 / 3 additional lag hours. Medians are lag-0 case / reference customers.

| Case | Reference | Pairs | Threshold pairs | All-pair medians | Threshold medians |
| --- | --- | ---: | ---: | ---: | ---: |
| June 13–15, 2022 · Heat | May 16–19, 2022 | 48 / 48 / 49 | ≥32°C: 20 / 17 / 14 | 105.5 / 155.5 | 210.5 / 255.5 |
| August 15–17, 2024 · Heat | August 8–11, 2024 | 65 / 64 / 62 | ≥32°C: 24 / 23 / 21 | 230 / 40 | 404 / 78 |
| March 3–5, 2023 · High wind | February 17–20, 2023 | 55 / 55 / 55 | rain 11 / 12 / 14; wind 8 / 8 / 8 | 2,306 / 42 | rain 2,721 / 23; wind 10,275 / 17 |
| August 30–September 1, 2024 · Storms | August 23–26, 2024 | 65 / 64 / 62 | rain 14 / 13 / 14; wind 0 / 1 / 2 | 438 / 185 | rain 439 / 251.5; wind too few pairs |

- **June 2022 heat is the first heat case with geometry:** 52 original legacy grid cells from 20 paired ≥32°C hours at lag 0 (51 and 47 cells at lags 1 and 3). The June 2022 reference is lower than the case at the median. This is a descriptive contrast, not an effect estimate.
- August 2024 heat has no verified grid geometry.
- March 2023 is the first rainfall/wind case with enough higher-wind pairs (8) for a median. It has 50.275 mm estimated regional rain, concentrated on March 3, and a 16 m/s peak airport sustained wind. Its rain-and-wind group has only 4 pairs and stays unavailable.
- August 30, 2024 has 19.138 mm and a 14.4 m/s peak, but at most two higher-wind pairs. Both new references have 0 mm estimated regional rain across 72/72 hours.

The existing four publications have identical results. Only their text and provenance hashes changed:

- Temperature text now uses the configured case name and per-case notes. The June 25 storm-recovery caveat applies only to `heat-2023`. The line “One independent case per temperature category” now says cases are single, unpooled episodes.
- Rainfall/wind text now reads “Selected case studies” and “A 7- to 28-day separation”.

Earlier immutable files remain in place.

## Code changes

- `prepare-weather-comparisons.mjs` accepts 1–8 validated episodes through `validateComparisonPlan` (unique IDs, 72 UTC hours, bounded report paths).
- `EVENT_SAMPLES` adds `march-wind` and `august-storm`.
- The MRMS decoder now accepts 8-bit as well as 16-bit PNG values in GRIB template 5.41, with identical scaling. The first March 2023 attempt rejected 24 of 72 retrieved originals as “Unsupported MRMS packing/bitmap”. Those reports are kept as `reports/rainfall-wind-march-2023-batch-*-download-attempt1-8bit-rejected.json`. Across both 2023 windows, 68 of 144 frames are 8-bit. All existing windows are 16-bit and decode unchanged. In both depths, the CONUS field uses reference 0 with no negative sentinel values, so missing-versus-zero behavior is unchanged.
- `verify-preview.mjs` and `verify-cloud.mjs` now compare deployed case IDs with the local prepared catalogs instead of a fixed four.

## Acquisition and storage

- Rainfall: 216 requests (nine 24-request batches) and **111,004,614 bytes** downloaded. 48 August 23–25 reference hours were reused from cache. Event context: 5 requests, 419,648 bytes.
- No batch reached a limit. The per-run, 1 GiB and free-space limits are unchanged.
- The evidence cache grew from 288,256,490 to **422,547,882 bytes**. Rolling cache: 157,015,757 bytes. Combined: 579,563,639 of 1,073,741,824 bytes.
- Nothing was deleted.
- Six rainfall periods were published (24/48/72 hours for each new case). The weather catalog now lists 12 periods.

## Verification

```powershell
npm run weather:screen; npm run weather:temperature-cases
npm run weather:select-references
node scripts/validate-rainfall-window.mjs --config=config/rainfall-<id>.json   # four windows
node scripts/prepare-rainfall-periods.mjs --config=config/rainfall-wind-march-2023.json   # and storm-aug30-2024
node scripts/validate-event-context.mjs --download
npm run weather:comparisons
python -B scripts/verify-temperature-comparisons.py; python -B scripts/verify-weather-comparisons.py
python -B scripts/verify-weather-references.py; python -B scripts/verify-rainfall-window.py --report=reports/rainfall-<id>-validation.json
python -B scripts/verify-event-context.py; node --test test/*.test.mjs
```

- **209 Node tests pass.** New tests cover configured names/notes, the plan validator, event-sample coverage, reference-config calendar offsets and 8-bit decoding.
- Every independent Python check passed, including all four new rainfall windows and 864 reference pair rows. Python was the bundled runtime (`C:\Users\jpbra\.cache\codex-runtimes\...\python.exe`).
- Offline replays reproduced identical catalogs with zero requests:
  - conditions `8cf86939…8484`
  - rainfall/wind `e53a8f9a…e0df`
  - reference selection `65dc9702…df79df`
- All eight cases, all lags and both CSV tables were read successfully through `ComparisonService`.

Evidence: `reports/weather-cases-expansion-*.{json,log}`, the `rainfall-{wind-march-2023,storm-aug30-2024}` and `rainfall-reference-*` batch, validation and independent reports, and pre-change copies (`*-before-cases-expansion.json`).

## Limits

These remain single selected episodes: four heat/cold and four rainfall/wind cases. Hours are dependent, and no pooled estimate, uncertainty interval or cause is claimed. The deployment, dashboard build, preview/cloud checks and browser checks were not run in this checkpoint. The VM needs the new data files before `npm run deploy:verify` can pass.

## Files to copy to the VM

Code releases do not carry data. Copy these files under `/var/lib/mlgw/data/` (owner `mlgw`), keeping the same relative paths:

- `data/comparisons/`: `catalog.json` and:
  - `052a939310d43aa45de642405252b19211192056d0957a0a2ea7721d2c7b64c0.json`
  - `339f16f1a2d77b332527a7553ca2ac1c527e361d74e28dfc460fa91600ff87c4.json`
  - `3d9d107f7350f92df35b49ea12d2f3469d82ba9318ddbd3e7aaf63cecbf833c4.json`
  - `53d4a59ca0950224a77e4f4238006b30f6d76c48775a27a37c893a67ed3c34b9.json`
  - `6a5fea3578147e8d5b6aba5ff5e050d37ade7b3a9caa3af0f679482215cbf60d.json`
  - `a9fcc9d004e05ab3dd3f6f02abb3bf158ddfc03a14f1015515bac90b3d1e5bcf.json`
  - `b8899258f6805b50664aad58e5b91ad7f150fc91903be7fadabbd0781273d0a3.json`
  - `ee4d6170bcc09e45af9d30045c58a9f1133653655fa16b732f31a54477700da8.json`
- `data/comparisons/conditions/`: `catalog.json` and:
  - `123a4774ec1d1a7ecb75484bb05a503b7aca4e1fd9cac1b7422d106eabcfc489.json`
  - `5d56cd6c1d56eae0465a59d681720b50cb0f64db500f8a167be15b7bb5291ec2.json`
  - `79b466e188003e8a36fb8a4587661227a8bc960ce6a7891e65e518636f137fd7.json`
  - `8b627e2b8e383854d156e96311aaa00d713a2e882d58917d79ffd51c3d5487fd.json`
  - `a4fa44a139f1471c13c379f2da4674a0af57f42e566f7a651ab3e43fa1a42722.json`
  - `c430245c5f487df42f32ff9aefa215c1a3d723ddb275e25261baa5ed73669e19.json`
  - `e4406358a8b2632d0a6eea3a0bfb58851baf98898682e84720054d0ae9f6ba07.json`
  - `e6ab8140b32c068c178d28c6a5ecfb26e4b1b921d14f7a502753038569a81aa7.json`
- `data/weather/cache/derived/` (the 24/48/72-hour periods; the 72-hour assets also serve the comparison map images):
  - `197aab75137408f67123e73a6dca41562ab7384724a08315e4bac8718350efd2.json`
  - `999d531d458e1eb539fbe71eb1634bf7f090679368ebaac135b44d3faa63c9b4.json`
  - `f640fd641704d67e1256acab655e962863dcb00c2d70c0961e864f2f00b0183d.json`
  - `acecd9ad562231baf6c59e30c6917538432a8c8ef9af3bbe7670df39befe6330.json`
  - `1c832cfa947d324f0dfc24c46303ab8be89fd326bfc32c9a29f81beb9b76e93c.json`
  - `ad9acc70dc539d06d629f8862ac5b9347cfb738f7b114a7d97b413c847808b9d.json`
- `data/weather/cache/published/catalog.json`: its pre-change local SHA-256 was `341898979e6b748f65f77a561762d55ddc1ba4ae254e802f984a54c504ff66b9`. If the VM copy differs, add the six new period entries instead of overwriting.

The hourly rainfall originals are not needed to serve the pages. Copy them only if the VM should also hold that evidence.
