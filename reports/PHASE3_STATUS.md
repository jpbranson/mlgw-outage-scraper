# Phase 3 — local dashboard checkpoint

Implemented September 16, 2026, following the user's request to proceed one step and check back. Validation and serving remain on this PC. No cloud resources or public dashboard were deployed. Phase 4 has not started.

## Available now

Open **http://127.0.0.1:4173** while the local server is running. The dashboard was started as a hidden Node process (PID 2212 at this checkpoint; verify its command line before stopping it). It does not install a Windows service or start at boot. Closing the browser does not stop capture.

- One responsive page with freshness, customers, reported events, comparable customer change and the selected UTC day's observed customer peak.
- Leaflet canvas map with size-scaled approximate outage points, escaped source text, start/status/repair details, and visible source/basemap attribution.
- Date selection and keyboard-accessible capture slider. Selecting a chart observation or bucket peak loads that actual archived capture. Cards, map, durations and GeoJSON exports share its timestamp. Latest mode refreshes every minute; historical selection stays fixed.
- Customers/events chart with 24-hour five-minute observations, seven-day hourly peaks and 30-day daily peaks. Gaps are unknown, not zero. Partially covered summary buckets are shown as unconnected points, with explicit coverage and actual peak timestamps. Customer and event peaks can open different captures.
- Sharp-rise signals require at least 100 additional customers and doubling (zero uses the absolute threshold), within the collector's stricter 7.5-minute continuity window and with no intervening failed/suspect attempt. Larger red chart points mark qualifying captures.
- A robust 28-day baseline is implemented but remains in learning mode until at least 90% valid slot coverage exists. Threshold: median plus max(100, 6 × 1.4826 × MAD). Six-hour reported durations use source start times at the selected capture, with missing/ambiguous timestamps explicit.
- Bounded period CSV and single-capture GeoJSON exports. The initial list uses long-running events; recurring-cell ranking and `/api/spatial-summary` remain optional future work.

## Data and access limits

The Node server binds only `127.0.0.1`. It opens SQLite read-only, validates local Host/Origin, serves only the built client and named read-only API routes, rejects mutation methods, and never serves the collector directory, raw archives or admin operations. This is local route isolation, not a claim that public cloud authentication has been validated.

Series reads are limited to 31 days, with five-minute detail limited to two days. The browser requests one UTC day's capture list and one selected detailed map. Full detail is capped at 10,000 features and responses at 12 MiB. A shared local budget permits 120 API requests per minute. Recent series/snapshot responses cache privately for 30/60 seconds; health and latest responses are not cached. Archive replay checks the manifest, original body and saved parser hashes against the index. Missing/corrupt detail produces an explicit unavailable state while preserving known summary counts.

Source publication time remains unknown. Daily peaks and archive date groups use UTC, clearly labeled; capture and outage timestamps otherwise display in Central time. Source cause text is excluded. Neither unique households affected nor utility reliability indices are inferred.

Standard OpenStreetMap tiles load only for the visible map, with visible attribution and browser referrer/cache behavior. Tiles are configurable or can be disabled; the point layer remains usable without them. No tile prefetch or offline tile export is implemented. The browser fetches basemap tiles over the internet; the application and outage archive remain local. See the [OSM tile usage policy](https://operations.osmfoundation.org/policies/tiles/).

## Verification

- `npm test`: **45/45 passing**, including 11 new dashboard tests covering read-only SQLite, historical geometry/totals, missing/corrupt evidence, source-field projection, failed-observation gaps, peak capture IDs, coverage, range bounds, anomaly thresholds, aging freshness, origin/route isolation, exports and request limits.
- `npm run dashboard:build`: strict TypeScript checking and local esbuild bundling pass. JS is about 359 KiB and CSS about 23 KiB before transport compression; Leaflet and Chart.js are bundled locally.
- `npm run dashboard:verify`: isolated offline API replay, with no synthetic entries in real history. At 17:40 UTC, 4,000 features returned 1,886,150 bytes in 151 ms; 10,000 returned 4,713,853 bytes in 310 ms. Counts and returned feature totals matched. These are single local API timings, not browser storm-rendering measurements or provider CPU results.
- In-app browser checks at the default desktop viewport and a 390 × 844 mobile viewport: map/attribution, source popup, historical keyboard slider, linked chart selection, latest mode, metric/range controls and export links. No horizontal overflow or console warnings/errors were observed. This is responsive desktop-browser validation; a physical phone has not been tested.
- Selecting the 12:05 PM Central observation reproduced **404 customers / 12 reported outages**, a +211-customer sharp rise from the prior valid capture. Selecting the first capture reproduced **216 / 16**, with unavailable prior change. These are historical verification examples, not current totals.
- At 12:40 PM Central, the collector had **14 accepted captures**, 100% slot coverage over its observed span so far, no gap over ten minutes, no queued rollup work, and healthy runner/storage status. The 24-hour and seven-day trials are still running; these early results do not establish their final acceptance criteria.

Generated details: `reports/dashboard-verification.json`, `reports/collector-health.json`, and `reports/dashboard.*.log`. The API tests are deterministic and offline. Cloud runtime, public-access controls and provider quotas remain deferred. The next checkpoint is user review of this local dashboard before Phase 4.

## Authorized phone preview addendum

Later on September 16 the user authorized a temporary password-protected Cloudflare Quick Tunnel because they cannot physically access the PC. A separate loopback authentication gateway and signed standalone tunnel process provide phone-browser access without installing a Windows service. This does not move collection/archive storage to the cloud or complete provider-runtime validation. The first preview runs from 1:40 PM to 9:40 PM Central on September 16, with automatic expiry; `npm run preview:stop` ends it earlier without stopping collection.

Seven focused gateway tests cover anonymous denial, session cookies, route/header isolation, incorrect credentials, origin checks, expiry, request limits and HTTPS enforcement. External verification at 18:42 UTC confirmed the password form, blocked anonymous API/assets, authenticated archive totals/geometry, denied archive/admin/mutation routes and HTTP-to-HTTPS redirection. Password entry and live data loading also passed in the browser at 390 × 844. See ignored `reports/preview-verification.json` for the temporary URL and evidence; credentials remain outside tracked source. Phase 4 has not started.

## Visual design update — September 16, 19:45 UTC

Applied the user's request for a visuals-first dashboard, minimal prose, Inter or equivalent, and a 12 pt minimum. Large totals lead into side-by-side map/history panels on desktop; phones show the map then history before supporting notes. Explanations are retained in a collapsed Data notes disclosure. Inter is served locally as a 47.1 KiB variable WOFF2 with its license retained in `web/fonts/`. Interface text, chart ticks/tooltips, Leaflet attribution, controls and popup text use at least 16 CSS pixels (12 pt). Raster basemap place labels are supplied by OpenStreetMap and cannot be styled by the dashboard.

Strict TypeScript checking and the frontend build pass; all 11 dashboard tests pass. Browser checks at desktop and 390 × 844 confirmed Inter loaded, no interface text below 16 px, no horizontal overflow, historical replay, metric/range controls, expandable notes and readable scrolling map popups. Corrected popup positioning after selecting a long outage and hid overlapping floating controls while a popup is open. Browser console had no warnings/errors. Screenshots: `reports/dashboard-mobile.png` and `reports/dashboard-desktop.png`.

The local dashboard restarted as hidden PID 4740 for the font content type change (verify identity before stopping). The existing authenticated preview serves the redesign with the same link, password and expiry; its supervisor/tunnel and capture processes were left running. Phase 4 remains deferred.
