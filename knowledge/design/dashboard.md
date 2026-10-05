---
type: Design Section
title: "A deliberately small dashboard"
description: "Map-led dashboard design, weather replay and comparison controls, read-only API routes and request limits."
tags: [design, dashboard, api]
status: stable
generated: { by: "claude-code/claude-opus-5-5", at: 2026-09-23T07:41:28Z }
verified: { by: "process:documentation-review", at: 2026-09-23T04:16:15Z }
sources:
  - id: leaflet-geojson
    resource: "https://leafletjs.com/examples/geojson/"
    title: "Leaflet GeoJSON"
  - id: chartjs
    resource: "https://www.chartjs.org/docs/latest/"
    title: "Chart.js documentation"
  - id: osm-tiles
    resource: "https://operations.osmfoundation.org/policies/tiles/"
    title: "OpenStreetMap tile usage policy"
---
# 8. A deliberately small dashboard

Use plain TypeScript with a small build setup, [Leaflet for GeoJSON maps](https://leafletjs.com/examples/geojson/), and [Chart.js for time-series charts](https://www.chartjs.org/docs/latest/). Keep the initial UI to one responsive page:

1. A freshness line and compact inline totals for affected customers, active reported outages, change, and daily peak.
2. A map and time slider. Start at the latest accepted capture; allow selecting an actual historical observation. Size markers by affected customers and show start/status/repair estimate in a popup.
3. One main line chart with customers/outage-count toggle, 24-hour / 7-day / 30-day presets, visible gaps, and anomaly markers.
4. A small list of long-running outages or recurring-location rankings, plus CSV/GeoJSON export for the selected bounded period.

Retain the user's visual direction: ggplot `theme_minimal` aesthetics, visuals before prose, Inter or an equivalent readable font, no emojis, plain drawn SVG previous/next arrows, and a minimum 16 CSS px (12 pt) for the main dashboard's interface text. Use a map-led utility layout with concise legends and expandable Data notes; avoid decorative cards, shadows, badges and unrelated animation. The implemented map choices are **One capture**, **Heatmap**, **Per capita**, **Locations** and **Rainfall**. Heatmap/per-capita modes use bounded outage periods; Rainfall offers prepared 24/48/72-hour intervals, an ending-time selector and a matching outage chart/CSV.

Selecting a chart point updates the map to that observation when its detail is available to the serving archive. Show the exact selected timestamp and avoid blending “latest” totals with an older map. Use five-minute observations for short ranges and hourly/daily summaries for long ranges, preserving bucket peaks so short spikes remain visible. Load an older map on demand; do not download an entire year of features to the browser. For a future cloud dashboard whose requested detail has moved to the PC, display its archive status and available summary instead of an empty map or a fabricated point layer. Legacy maps use the old grid representation and carry a visible source-format label.

The map library and basemap tiles are separate dependencies. For a small personal pilot, standard OpenStreetMap tiles may be used subject to its visible attribution, referrer, and caching requirements. Do not bulk-download or prefetch tiles. Keep the tile provider configurable and let the outage layer remain usable if tiles are unavailable. Reassess the basemap for public traffic. [OSM tile policy](https://operations.osmfoundation.org/policies/tiles/)

## Weather replay and comparison controls

Phase 3A has implemented a single-capture weather selector (off, radar reflectivity, preceding one-hour rainfall), opacity control, legend, attribution and exact matched time/interval. The capture slider and drawn arrows synchronize outage/weather replay; a regional KMEM temperature/wind plot uses only eligible prior station reports. Rainfall mode separately displays prepared 24/48/72-hour totals and a chart over that exact interval. Saved study acquisition is explicit and bounded; a separate maintenance runner refreshes recent display weather. Opening a view does not fetch upstream weather. The current-feed rainfall chart has no outage captures for June 2023 or September 2024; separate legacy and comparison pages now serve verified regional totals for those dates. The September 23 [dashboard extensions](../dashboard/dashboard-extensions.md) add automatic play/pause, a synchronized side-by-side rainfall/outage-density map for the same interval, and rolling 24-hour rainfall totals built from the retained hourly frames, so current-feed outages can be paired with recent rain.

The broadened prepared-period workflow and regional rainfall/wind case/reference comparisons are implemented for June 2023 and September 2024. December 2022 cold and June 2023 heat add temperature-based comparisons, with original-grid cold summaries. Arbitrary current-feed episode selection (up to 31 days, shareable by URL) is implemented for the chart and the period maps. The comparison catalog now has eight screened cases: `wind-march-2023`, `storm-aug30-2024`, `heat-june-2022` (with original-grid geometry) and `heat-august-2024` were added September 23 under the unchanged policy. Arbitrary weather-comparison episodes still require explicit, bounded weather preparation, and additional supported conditions remain planned. A single radar frame is compared with its matched outage capture, while period summaries must compare outages and rainfall over compatible stated intervals. An antecedent rainfall layer must be labeled as preceding the episode. Do not overlay one storm's rain on the all-time outage heatmap without changing or clearly separating the outage period. Show missing weather independently and keep outage replay usable when weather fails.

The Phase 5 interface provides four case choices, aligned weather/outage timelines, condition groups and matched snapshot comparisons at fixed 0/1/3-hour additional lags. The cold map preserves original polygons and missing cells; it is not a neighborhood temperature surface or population rate. The heat case explicitly retains preceding-storm recovery as a confounder. Area-by-condition frequency/customer-hours and per-capita weather comparisons remain future work where coverage and denominators support them. Keep attribution, population/weather vintages, uncertainties and methods available in Data notes and exports.

Implemented read-only API, served publicly through Caddy in production and through loopback in local development:

```text
GET /api/latest
GET /api/series?from=...&to=...&resolution=...
GET /api/snapshots?date=YYYY-MM-DD
GET /api/snapshot/<snapshot-id>
GET /api/series?view=spatial&from=...&to=...&geography=grid|block-group|location
GET /api/config
GET /api/config?view=census
GET /api/health
GET /api/export.csv?from=...&to=...&resolution=...
GET /api/export.csv?view=locations&from=...&to=...
GET /api/export.geojson?id=<snapshot-id>
GET /api/weather?at=<explicit-UTC-timestamp>
GET /api/weather/periods
GET /api/weather/period?id=<prepared-period-sha256>
GET /api/weather/image/<prepared-asset-sha256>
GET /api/legacy/catalog
GET /api/legacy/series?from=...&to=...
GET /api/legacy/snapshots?date=YYYY-MM-DD
GET /api/legacy/snapshot/<snapshot-id>
GET /api/legacy/export.csv?from=...&to=...
GET /api/legacy/export.geojson?id=<snapshot-id>
GET /api/legacy/catalog?view=comparisons
GET /api/legacy/series?view=comparison&id=june-2023&lag=0
GET /api/legacy/export.csv?view=comparison&id=june-2023&lag=0&table=reference
GET /api/legacy/series?view=comparison&id=cold-2022&lag=0
```

The weather routes read bounded saved and rolling catalogs and hash-verified prepared assets. They cannot launch collection or accept arbitrary upstream URLs. Phase 5 comparisons use the existing `/api/legacy/catalog`, `/api/legacy/series` and `/api/legacy/export.csv` routes with `view=comparison` (or `comparisons`), a prepared case ID (`june-2023`, `september-2024`, `cold-2022`, `heat-2023`) and a supported lag; `table=reference` selects paired CSV rows. The service merges the rainfall/wind catalog with `data/comparisons/conditions/catalog.json`; cold-grid summaries and geometry are included in the case JSON. Preview login is handled separately at `POST /preview/login`; the dashboard itself has no write routes. Retain authentication for any separately requested temporary preview. Public production access uses the request quotas, replay bounds and cache controls described in the [technical audit](../operations/technical-audit.md).

The local API limits series to 31 days, with five-minute detail limited to two days; hourly/daily resolutions serve longer ranges. Responses are capped at 12 MiB, with a shared 120 API requests/minute budget. Latest/health reads use no-store, series cache privately for 30 seconds, snapshots for 60 seconds and Census geometry/weather PNGs for one day. The preview gateway overrides all responses to no-store/private. Future public caching needs a separate design. Return source attribution, quality flags, and capture times consistently. Escape source strings in popups. Keep database bindings, storage credentials, and administrative operations out of the browser.
