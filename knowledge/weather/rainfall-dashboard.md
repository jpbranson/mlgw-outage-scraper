---
type: Checkpoint Report
title: "Multi-day rainfall dashboard checkpoint"
description: "September 17, 2026 expanded 4,800-cell extent, original 24/48/72-hour rainfall controls and dated verification."
tags: [weather, rainfall, dashboard]
status: stable
generated: { by: "codex/unknown", at: 2026-09-22T16:41:52Z }
verified: { by: "process:documentation-review", at: 2026-09-23T04:16:15Z }
sources:
  - id: window-validation
    resource: "../../reports/rainfall-window-validation.json"
    title: "Rainfall window validation (local, ignored by Git)"
    last_modified: 2026-09-17T05:38:36Z
  - id: window-independent
    resource: "../../reports/rainfall-window-independent.json"
    title: "Independent rainfall decode (local, ignored by Git)"
    last_modified: 2026-09-17T05:45:16Z
  - id: period-preparation
    resource: "../../reports/rainfall-period-preparation.json"
    title: "Rainfall period preparation (local, ignored by Git)"
    last_modified: 2026-09-17T13:58:00Z
---
# Multi-day rainfall dashboard checkpoint

**September 22 deployment update:** the [DigitalOcean deployment guide](../operations/digitalocean-deployment.md) is authoritative for current operation. The VM now serves the dashboard and runs both collectors; local collectors are stopped. Runtime counts, preview sessions, trial deadlines and hosting gates below describe this earlier checkpoint. Its scientific findings and dated validation results are preserved.

Completed locally September 17, 2026. The **Rainfall** map view provides prepared **24-, 48- and 72-hour** totals, an ending-time selector, opacity, an attributed millimeter legend, coverage and native-cell inspection. The outage chart uses the exact selected rainfall interval; its CSV export uses that interval too. Returning to the other map views removes the rainfall layer and restores their controls. See [current status](../project-status.md) for subsequent checkpoints and the latest preview-session state; the measurements below remain the original rainfall implementation checkpoint. The current cache cap is 1 GiB, superseding this report's earlier 256 MiB measurements.

## Coverage correction

The preserved Shelby County geometry extends west to −90.310491°. The earlier crop stopped at −90.3°. The prepared weather bounds now extend to **−90.4°, 34.9°, −89.6°, 35.5°**, retaining the full native resolution. The rainfall crop is **80 × 60 cells**, and **all 685 Census block groups now have complete spatial coverage** in the validated period, including 471579803001.

All expanded crops were rebuilt from existing verified originals with **zero new weather downloads**. Native subset processing is versioned `weather-subset-v2`; projected images are `weather-display-v3`. Source request identities stay unchanged, and older source/derived objects remain preserved. The cache is approximately **146.8 MB (140.0 MiB)** of its unchanged 256 MiB cap.

The prepared sample ends **June 27, 2023 at 00:00 UTC / June 26 at 7:00 PM CDT**. Its 24-hour outlined-area mean is 2.7573 mm and maximum native-cell total is 23.0 mm. The 48- and 72-hour means are 8.5531 mm and their maxima are 51.2 mm. These means cover the expanded rectangle, not the county alone; they differ from the earlier crop's means because the averaging area changed. The sample still describes a short storm burst within a three-day window, not prolonged rainfall.

At this checkpoint no 2023 outage records had been imported. The current-feed Rainfall view still says **“No collected outage captures in this rainfall period”** and shows 0% outage coverage for this interval; the separate legacy/comparison pages now supply verified historical regional totals. Missing history is not zero outages. Weather does not create or substitute outage observations. Multi-day periods remain explicitly prepared; choosing a view does not download upstream weather.

## Read-only serving and failure behavior

- `/api/weather/periods` lists prepared period IDs, durations and exact intervals; `/api/weather/period?id=...` reads one verified saved result. Only 24/48/72-hour catalog entries are accepted. Arbitrary ranges, upstream URLs, duplicate parameters and writes are rejected.
- PNGs use the existing verified image route. Period files remain distinct from single-capture one-hour rainfall and cannot silently substitute for it. Payloads include native cell totals and valid-hour counts, with null preserved for incomplete totals.
- Labels distinguish hourly-file availability, area/time coverage and area with complete totals. Gray means missing; transparent means zero estimated depth. The rectangle mean is unavailable unless the entire target has complete temporal/spatial coverage. Tapping a cell displays its own total and valid-hour count.
- Period changes clear prior images and values immediately. Responses for superseded selections are ignored. Rainfall/image failures leave the independently selected outage history usable. The preview allowlist protects the added routes behind password authentication. No tunnel was restarted during this rainfall implementation; the user subsequently requested the September 17 replacement, whose public login, period data and PNGs were verified separately.

## Verification

- **99 tests pass**, including read-only period routing, query bounds, missing versus zero payloads, corruption isolation, interval metadata, all 685 polygons inside the expanded crop and authenticated preview routing.
- TypeScript and the production client build pass.
- Independent Pillow/NumPy checks match **345,600 hourly native values** and **14,400 totals** across the 24/48/72-hour windows, plus analytic rectangle means. Independent polygon rasterization also passes for four areas, including the corrected western boundary area, now with 100% coverage.
- Desktop and 390 × 844 phone browser checks cover all three periods, matching dates/CSV ranges, native-cell popup, opacity, empty historical outage data, transitions to heatmap and one-capture modes, and clearing old layers. Phone controls use 16 px text without horizontal page overflow. No browser warnings/errors were observed during these checks.

Saved evidence: ignored `reports/rainfall-window-validation.json`, `reports/rainfall-window-independent.json`, `reports/rainfall-period-preparation.json`, and content-addressed originals/derivatives in `data/weather/cache/`. The window validation reports now describe the expanded crop; the prior [numeric checkpoint](rainfall-accumulation.md) records the original crop's measurements.

## Reproduce and remaining work

```powershell
npm run weather:validate-window
npm run weather:prepare-periods
npm run dashboard:build
```

The first two commands use saved originals only. The preparation command also upgrades existing single-capture weather layers from their saved originals to the expanded extent. Reload the page after preparation/build; restart an existing dashboard process when its server code changes. At this checkpoint the loopback dashboard was `http://127.0.0.1:4173`, with output in `reports/dashboard.rainfall.stdout.log` and `reports/dashboard.rainfall.stderr.log`.

The subsequent [broader weather checkpoint](weather-periods.md) completes selectable-period preparation, prolonged-rain validation, interruption/coverage checks and explicit station refresh. It supersedes this report's single-ending-date catalog and accumulated-rainfall color scale. Preparation now updates selected periods without rebuilding unrelated single-capture layers. [Storage](storage-and-pilot-revalidation.md), [station quality](station-quality.md), [event/zone-warning validation](event-context.md), legacy audits and [separate legacy publication](../legacy/legacy-dashboard.md) also completed. Initial rainfall/wind cases and [matched references](matched-references.md) are followed by [cold/heat comparisons, native-grid cold summaries and bounded automatic display-weather refresh/retention](autonomous-continuation.md). Additional source families, richer exposure analysis, operation beyond the trial and permanent cloud hosting/collection remain open. See current status for the latest temporary preview session.
