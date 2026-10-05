---
type: Guide
title: "Dashboard views, API and design rules"
description: "Deployed and local dashboard views (heatmap, per capita, locations, episodes, playback), read-only API routes, visual design rules and server settings."
resource: "https://64.225.60.118"
tags: [dashboard, api, design, census]
status: stable
generated: { by: "claude-code/claude-opus-5-5", at: 2026-09-23T07:41:28Z }
verified:
  - { by: "process:documentation-review", at: 2026-09-23T04:16:15Z }
  - { by: "claude-code/claude-opus-5-5", at: 2026-10-05T02:45:24Z }
sources:
  - id: acs-schedule
    resource: "https://www.census.gov/programs-surveys/acs/news/data-releases/2024/release-schedule.html"
    title: "ACS 2024 release schedule"
  - id: b01003
    resource: "https://data.census.gov/table/ACSDT5Y2024.B01003"
    title: "ACS 2020–2024 B01003 table"
  - id: ggplot-theme
    resource: "https://ggplot2.tidyverse.org/reference/ggtheme.html"
    title: "ggplot2 complete themes"
---
# Phase 3 local dashboard

The deployed dashboard is **https://64.225.60.118**. A development copy can run at **http://127.0.0.1:4173**, reading the stopped PC archive without changing captures. Rebuilding or restarting a local copy does not update the VM. Start or rebuild it with:

```powershell
npm ci
npm run dashboard:build
npm run dashboard
```

The page links historical maps, totals and charts; offers 24h/7d/30d chart views or a custom episode; explains gaps, freshness and anomaly rules; and exports bounded CSV or the selected GeoJSON. Daily peaks and archive date groups are labeled UTC; other displayed times use Central. See [Phase 3 status](phase-3-dashboard.md) for checks and limits.

Select **Heatmap** above the map to see reported outage activity across the available archive or the last 6h/24h/7d/30d. The heatmap smooths distinct provisional source ID/start pairs in a fixed, roughly 1 km grid. Repeated polls count once. A 750 m Gaussian bandwidth, truncated at 2.25 km, shows nearby activity together; a square-root color scale keeps isolated locations visible. The density scale uses the whole selected period and does not change when panning or zooming. Tapping an underlying area shows its first/last observations, peak simultaneous customer count and uncertain identities. These are reported activity near a location, not service areas or confirmed unique incidents/households. Moving events can appear in several cells. Only current-format captures collected locally before cutover or subsequently on the VM are included here; older history has its own **Legacy archive** page. **One capture** restores the map, totals and arrow replay controls for a single observation.

Select **Per capita** for a Census block-group choropleth. **Measure** switches between provisional outage events and peak simultaneous customers affected, each per 1,000 estimated residents. Original outage points are assigned to the full Census polygons, not to heatmap cell centers. The denominator is the latest available block-group population release as checked September 16, 2026: [2020–2024 ACS five-year estimates](https://www.census.gov/programs-surveys/acs/news/data-releases/2024/release-schedule.html), table [B01003](https://data.census.gov/table/ACSDT5Y2024.B01003), with matching 2024 TIGERweb boundaries. Popups retain the estimate and its 90% margin of error. Block-level population is older decennial data; newer boundary vintages alone do not make population estimates newer.

Per-capita rates are location-based proxies: utility customers are accounts, not people, and an outage point can represent customers across multiple block groups. These maps do not estimate the share of residents without power. Outside-county and boundary-ambiguous points are excluded and counted. Gray means no rate because population is zero/missing or there are no verified captures; white means no assigned events in verified captures, not proof of uninterrupted power. A large or unavailable population margin of error is flagged in the popup. Coverage gaps remain unknown. Fixed legend intervals make rate colors consistent across map movements and selected periods; event rates still depend on the selected period's length and coverage.

Select **Locations** to map each exact published outage coordinate for the selected period, using the same rules as the offline [reported-outage-location dataset](../locations/location-dataset-feasibility.md): no rounding, snapping or inferred footprint. Color and size follow a fixed scale of distinct source records (source outage IDs) reported at that point; repeated polls count once, and a start-time edit is another provisional event but not another record. **Show** can limit the map to points reused by two or more records. A ranked list shows the ten most reused points, with peak simultaneous customers and last observation, and **Download locations CSV** exports every point for the period. Reuse shows a shared reporting location only; it does not establish a shared cause, circuit, equipment or customer group. Records whose coordinates change appear at each point and are marked uncertain. The offline SQLite build (`node scripts/build-location-dataset.mjs`) remains the source for coordinate transitions and unconfirmed nearby replacements.

**Custom episode** selects any explicit interval of up to 31 days in Central time. Choose it from **Map period** or the chart's **Episode** button; one episode drives the chart, its CSV and the Heatmap, Per capita and Locations maps. The chart uses five-minute captures up to two days, hourly peaks up to ten days, and UTC daily peaks beyond that. An ambiguous fall-back time uses its first (daylight-time) occurrence; a time skipped by the spring change is rejected. Periods before current-format collection began are reported as unknown rather than zero. The address bar keeps the episode and map view (`?from=…&to=…&view=locations`), so a link reopens the same selection. A completed episode is not refetched every minute.

The play button beside the replay arrows steps through accepted captures at a Slow (4 s), Normal (2 s) or Fast (1.25 s) pace, moving into the next UTC day when it has captures. Each step waits for the previous map and weather to load, and the day list is reread only when the replay leaves it, keeping playback within the public request budget. Selecting any other capture, date, view or chart point pauses playback. Starting from the latest capture replays the loaded UTC day from its first capture. The Legacy archive page has the same play control for its captures.

The compressed public reference file and provenance are described in [reference/README.md](../references/census-block-groups.md). It contains 685 Shelby County block groups, reconciling to 919,173 estimated residents, and is about 574 KiB. Regenerate from cached sources with `node scripts/prepare-census.mjs`, or explicitly refresh the pinned official sources with `node scripts/prepare-census.mjs --download`. It never accesses outage captures. The dashboard uses the local reference; population is not fetched on each view.

Historical maps replay hash-verified originals through the read-only `/api/series?view=spatial&from=...&to=...` route. Add `geography=block-group` for per-capita results or `geography=location` for exact reported points; `/api/export.csv?view=locations&from=...&to=...` exports the location table; `/api/config?view=census` provides the static public geometry and provenance. Missing detail and coverage remain explicit. Requests are limited to 31 days, one million feature observations, 50,000 provisional events and ten seconds of replay; a limit failure asks for a shorter period rather than returning a partial map. Only one historical replay runs at a time. The deployed public dashboard serves these reads; historical password-preview checks are recorded separately.

Dashboard design: a plain utility outage monitor, with the Memphis/Shelby County map dominant, compact inline totals, and a smaller history chart. Use ggplot2 [`theme_minimal`](https://ggplot2.tidyverse.org/reference/ggtheme.html) aesthetics: a white plotting surface, faint gray major/minor gridlines, black marks, no panel border or axis tick marks, and plain sans-serif type. The interactive chart remains in Chart.js; `web/ggplot-theme.ts` supplies its thinner minor gridlines. Sharp rises use larger black triangles, and the selected capture uses a dashed black line. The geographic basemap is grayscale with black outage points. Do not use emojis or decorative glyphs. Previous/next capture controls use simple drawn SVG arrows with accessible labels; exports use text. Retain only functional data symbols. Avoid rounded cards, shadows, gradients, badges, KPI tiles, decorative marks, forced symmetry, elaborate typography hierarchies and unnecessary motion or explanations. Keep detail in expandable Data notes. All interface text, chart labels/tooltips and map controls use at least 16 CSS pixels (12 pt), including on phones, overriding ggplot's smaller text defaults. OpenStreetMap's raster basemap has its own embedded place labels. The subject should determine the layout; avoid generic reusable dashboard styling.

`npm run dashboard:verify` checks 4,000/10,000-feature API replay in separate temporary archives. `npm test` remains offline and does not require the frontend packages. The frontend build uses the pinned packages in `package-lock.json`.

The server binds only to `127.0.0.1`, defaults to port 4173, and has no collector/admin mutation routes. Set `DASHBOARD_PORT` to change the local port. Set `DASHBOARD_TILES` to an HTTPS `{z}/{x}/{y}` tile template, with `DASHBOARD_TILE_ATTRIBUTION` and `DASHBOARD_TILE_ATTRIBUTION_URL` matching its provider. An explicitly empty `DASHBOARD_TILES` disables basemap requests. By default, the browser downloads visible OpenStreetMap tiles with attribution; application assets and outage data are served by the chosen dashboard host. The production Node server also binds to loopback, with Caddy providing public HTTPS through the configured `PUBLIC_ORIGIN`. The dashboard starts through systemd on the VM; no Windows dashboard startup task is installed. The separate Windows task downloads backups only. The historical temporary preview is described in [Temporary phone preview](../operations/temporary-preview.md).

Client source is in `web/`; the read-only API is in `src/dashboard/`. Generated `dist/dashboard/` files are ignored. Rebuild after client changes and restart only the dashboard after server-code changes. Local log names depend on the launch command; the September 18 checkpoint used `reports/dashboard.legacy.stdout.log` and `reports/dashboard.legacy.stderr.log`. Production logs use `journalctl -u mlgw-dashboard`. Verify a local PID/command line before stopping it, and use the deployment guide for VM operations.
