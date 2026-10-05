---
type: Guide
title: "Historical weather comparisons"
description: "The eight 72-hour weather comparison cases, matched-reference rules, preparation commands and read-only routes."
resource: "https://64.225.60.118/legacy.html?view=comparisons"
tags: [weather, comparisons, operations]
status: stable
generated: { by: "claude-code/claude-opus-5-5", at: 2026-09-23T07:41:28Z }
verified:
  - { by: "process:documentation-review", at: 2026-09-23T04:16:15Z }
  - { by: "claude-code/claude-opus-5-5", at: 2026-10-05T02:45:24Z }
sources:
  - id: comparison-config
    resource: "../../config/weather-comparisons.json"
    title: "Comparison case configuration"
    last_modified: 2026-09-23T07:20:53Z
  - id: candidates
    resource: "../../config/weather-candidates.json"
    title: "Outcome-blind candidate screen"
    last_modified: 2026-09-23T07:17:07Z
  - id: reference-policy
    resource: "../../config/weather-reference-policy.json"
    title: "Policy matched-weather-reference-v1"
    last_modified: 2026-09-18T13:30:24Z
---
# Historical weather comparisons

Open **Weather comparisons** at [the deployed dashboard](https://64.225.60.118/legacy.html?view=comparisons), or the corresponding route on a local development copy. Eight 72-hour cases pair verified legacy regional totals with eligible weather and matched references. Aligned charts, 0/1/3-hour additional weather lags, condition groups, coverage, archived context and CSV/JSON downloads retain missing values and source provenance.

| Case ID | UTC case window, end exclusive | Weather and geographic scope | Eligible pairs at lag 0 / 1 / 3 |
| --- | --- | --- | --- |
| `june-2023` | June 24–27, 2023 | Rainfall/wind; regional totals only | 50 / 50 / 49 |
| `september-2024` | September 12–15, 2024 | Rainfall/wind; regional totals only | 59 / 59 / 57 |
| `cold-2022` | December 22–25, 2022 | Below-freezing airport temperature; original legacy-grid summaries | 55 / 55 / 54 |
| `heat-2023` | June 29–July 2, 2023 | Airport temperature at least 32°C; regional totals only | 51 / 51 / 53 |
| `wind-march-2023` | March 3–6, 2023 | Rainfall/wind (NOAA High Wind); regional totals only | 55 / 55 / 55 |
| `storm-aug30-2024` | August 30–September 2, 2024 | Rainfall/wind (Thunderstorm Wind); regional totals only | 65 / 64 / 62 |
| `heat-june-2022` | June 13–16, 2022 | Airport temperature at least 32°C; original legacy-grid summaries | 48 / 48 / 49 |
| `heat-august-2024` | August 15–18, 2024 | Airport temperature at least 32°C; regional totals only | 65 / 64 / 62 |

The cold case maps 103 original grid cells from 41 paired below-freezing hours with geometry at zero additional lag. Missing polygons remain unknown; changing geometry is suppressed. These are observed cell peaks, not population rates or local temperature estimates. The June 2022 heat case is the first heat case with geometry: 52 original grid cells from 20 paired hours at or above 32°C at zero lag. The 2023 heat case begins during recovery from the June 25 storm, with 24,679 customers already affected. March 2023 is the first rainfall/wind case with enough higher-wind pairs (8) for a median. The four cases added September 23 used the unchanged screen and reference policy; see the [case expansion checkpoint](cases-expansion.md). None of the cases supports a complete customer-hour estimate, unique/new incident counts or causal attribution.

Matched references compare the same weekday and local clock hours using one actual capture near each half hour. References are selected using calendar, capture availability and station weather, without ranking outage counts. Rainfall/wind pairs require low reference regional rainfall and airport wind for the preceding weather hour. Temperature pairs require known low reference nominal station precipitation/wind and temperature outside the case threshold. Six eligible pairs are required for a median; sparse groups remain unavailable. See the [rainfall/wind matching rules](matched-references.md), [initial case methods](comparisons-initial.md) and [temperature methods](autonomous-continuation.md#weather-cases-and-geographic-scope).

```powershell
npm run weather:select-references
npm run weather:comparisons
python scripts/verify-weather-references.py
npm run weather:screen
npm run weather:temperature-cases
python -B scripts/verify-temperature-comparisons.py
npm run dashboard:build
```

These are offline preparation/replay commands and require the retained legacy index, originals and validated rainfall reports. The reference checkpoint documents rainfall validation commands. Restart only the dashboard after publication; keep the collector running. Preparation verifies source hashes and atomically promotes immutable data under ignored `data/comparisons/`. Browser reads never acquire weather. Weather cache use was 273.36 MiB at the matched-reference checkpoint; use the cloud service state in the deployment guide for current rolling/evidence measurements. Local weather status describes the stopped PC runner.

Read-only JSON is `/api/legacy/series?view=comparison&id=june-2023&lag=0`; CSV is `/api/legacy/export.csv?view=comparison&id=june-2023&lag=0`. Substitute any of the eight case IDs above; supported lags are 0, 1 and 3. Add `&table=reference` for all 72 paired rows, including exclusions. The combined catalog is `/api/legacy/catalog?view=comparisons`. Rainfall/wind publications use `data/comparisons/catalog.json`; temperature publications use `data/comparisons/conditions/catalog.json`. The cold-grid summaries and polygons are included in its JSON download. These routes are served by the deployed public dashboard; the password-protected preview sessions are historical.

The [autonomous continuation](autonomous-continuation.md) completed the additional-candidate screen. None of the three rainfall/wind candidates qualified under the unchanged reference policy at that time. Two eligible cold/heat cases were published through a separate immutable catalog, with original-grid cold summaries. The local trial later stopped for the September 22 cloud handoff; production continues on its independent schedule.
