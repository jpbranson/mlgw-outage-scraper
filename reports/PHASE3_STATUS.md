# Phase 3 — local dashboard checkpoint

**September 22 deployment update:** the [DigitalOcean deployment guide](DIGITALOCEAN_DEPLOYMENT.md) is authoritative for current operation. The VM now serves the dashboard and runs both collectors; local collectors are stopped. Runtime counts, preview sessions, trial deadlines and hosting gates below describe this earlier checkpoint. Its scientific findings and dated validation results are preserved.

Implementation history from September 16, 2026, with dated addenda below; documentation reconciled September 18. Start with [current project status](PROJECT_STATUS.md) for the present dashboard and preview session. Old PIDs, test counts, colors/layouts, commit notes and preview lifetimes apply only to their named checkpoint and may have been superseded. Phase 4A audits and [separate legacy integration](LEGACY_DASHBOARD_STATUS.md) are complete. The [autonomous continuation](DEVELOPMENT_COMPLETION_STATUS.md) brings Weather comparisons to four cases, adds a native-grid cold map, bounded weather refresh/retention and a local transfer rehearsal. Permanent cloud compute/storage and provider-backed Phase 4B installation remain pending account/runtime setup.

## Source-pilot review — September 17, 17:19:54 UTC

The running loopback dashboard passed local HTTP checks against the durable index and saved archive. `/api/latest` reproduced the **17:15:01.965 UTC** capture's **134 customers / 9 outages**, with nine map features summing to 134 customers. `/api/health` reported `ok`, calculated age from the accepted capture, and retained `sourceUpdatedAt: null`; source publication freshness remains unknown. The UTC-day peak was 825 customers at 02:40 UTC, and the 28-day anomaly baseline correctly remained in learning mode.

Historical API replay reproduced the first capture's **216 customers / 16 outages**. A bounded five-minute series matched all **297 indexed captures** at the review cutoff, including the pilot-to-collector handoff. No interior gap was present; the one-millisecond trailing interval added to include the final capture was correctly marked as awaiting a later observation. Checksums and archive reconstruction passed in the separate [source review](PHASE1_STATUS.md#archive-replay-and-collector-handoff).

Evidence: ignored `reports/phase1-local-checkpoint.json`. This checkpoint checked local HTTP/API data, not browser visual rendering. No build, dashboard restart, public preview or weather preparation was performed. The user-requested tunnel closure was still in effect at that checkpoint; a new session was requested September 18.

## Initial dashboard checkpoint

Open **http://127.0.0.1:4173** while the local server is running. The dashboard was started as a hidden Node process (PID 2212 at this checkpoint; verify its command line before stopping it). It does not install a Windows service or start at boot. Closing the browser does not stop capture.

- One responsive page with freshness, customers, reported events, comparable customer change and the selected UTC day's observed customer peak.
- Leaflet canvas map with size-scaled approximate outage points, escaped source text, start/status/repair details, and visible source/basemap attribution.
- Date selection and keyboard-accessible capture slider. Selecting a chart observation or bucket peak loads that actual archived capture. Cards, map, durations and GeoJSON exports share its timestamp. Latest mode refreshes every minute; historical selection stays fixed.
- Customers/events chart with 24-hour five-minute observations, seven-day hourly peaks and 30-day daily peaks. Gaps are unknown, not zero. Partially covered summary buckets are shown as unconnected points, with explicit coverage and actual peak timestamps. Customer and event peaks can open different captures.
- Sharp-rise signals require at least 100 additional customers and doubling (zero uses the absolute threshold), within the collector's stricter 7.5-minute continuity window and with no intervening failed/suspect attempt. Larger red chart points mark qualifying captures.
- A robust 28-day baseline is implemented but remains in learning mode until at least 90% valid slot coverage exists. Threshold: median plus max(100, 6 × 1.4826 × MAD). Six-hour reported durations use source start times at the selected capture, with missing/ambiguous timestamps explicit.
- Bounded period CSV and single-capture GeoJSON exports. The initial list uses long-running events. A cumulative historical cell map was added later; see the addendum below.

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
- At 12:40 PM Central, the collector had **14 accepted captures**, 100% slot coverage over its observed span so far, no gap over ten minutes, no queued rollup work, and healthy runner/storage status. At that initial checkpoint both trials were still running; the later 24-hour review passed, while full seven-day acceptance remains pending.

Generated details: `reports/dashboard-verification.json`, `reports/collector-health.json`, and `reports/dashboard.*.log`. These ignored reports may be regenerated by later checks; the numbers above remain the recorded initial measurements. The API tests are deterministic and offline. At this initial checkpoint public preview controls were not yet implemented; the following addendum records their later validation. Production cloud runtime and provider quotas remain deferred.

## Authorized phone preview addendum

Later on September 16 the user authorized a temporary password-protected Cloudflare Quick Tunnel because they could not physically access the PC. A separate loopback authentication gateway and signed standalone tunnel process provided phone-browser access without installing a Windows service. This did not move collection/archive storage to the cloud or complete provider-runtime validation. The first preview ran from 1:40 PM to its automatic expiry at 9:40 PM CDT on September 16. The explicitly requested September 17 replacement is documented in [current status](PROJECT_STATUS.md); `npm run preview:status` supplies its live state.

Seven focused gateway tests cover anonymous denial, session cookies, route/header isolation, incorrect credentials, origin checks, expiry, request limits and HTTPS enforcement. External verification at 18:42 UTC confirmed the password form, blocked anonymous API/assets, authenticated archive totals/geometry, denied archive/admin/mutation routes and HTTP-to-HTTPS redirection. Password entry and live data loading also passed in the browser at 390 × 844. See ignored `reports/preview-verification.json` for the temporary URL and evidence; credentials remain outside tracked source. Phase 4 had not started at that checkpoint.

## Visual design update — September 16, 19:45 UTC

Applied the user's request for a visuals-first dashboard, minimal prose, Inter or equivalent, and a 12 pt minimum. Large totals lead into side-by-side map/history panels on desktop; phones show the map then history before supporting notes. Explanations are retained in a collapsed Data notes disclosure. Inter is served locally as a 47.1 KiB variable WOFF2 with its license retained in `web/fonts/`. Interface text, chart ticks/tooltips, Leaflet attribution, controls and popup text use at least 16 CSS pixels (12 pt). Raster basemap place labels are supplied by OpenStreetMap and cannot be styled by the dashboard.

Strict TypeScript checking and the frontend build pass; all 11 dashboard tests pass. Browser checks at desktop and 390 × 844 confirmed Inter loaded, no interface text below 16 px, no horizontal overflow, historical replay, metric/range controls, expandable notes and readable scrolling map popups. Corrected popup positioning after selecting a long outage and hid overlapping floating controls while a popup is open. Browser console had no warnings/errors. Screenshots: `reports/dashboard-mobile.png` and `reports/dashboard-desktop.png`.

The local dashboard restarted as hidden PID 4740 for the font content type change (verify identity before stopping). The existing authenticated preview serves the redesign with the same link, password and expiry; its supervisor/tunnel and capture processes were left running. Phase 4 was deferred at that checkpoint.

## Simpler utility layout — September 16, later update

Applied the user's subsequent direction to avoid generic SaaS styling. Replaced the branded title and boxed metric grid with “MLGW outages,” a Memphis/Shelby County label and inline totals. The map occupies most of the desktop width; history and long-outage records use a narrower column, with natural stacking on phones. Removed cards, rounded controls, shadows, badges, decorative arrows/icons, duration bars, the coverage progress bar and smooth map/scroll movement. The map legend sits below the map. Retained functional map details, exact chart values, exports, replay and concise data-quality information.

Uses a plain serif title, monospace numeric/time labels and Inter controls, retaining the 12 pt interface minimum. TypeScript/build, static element-reference and HTML nesting checks, and the local HTTP response pass. This update did not repeat browser visual testing. The existing preview serves the updated build; collection and preview lifetime are unchanged. These revisions follow the initial GitHub commit and have not been committed or pushed.

## Default ggplot aesthetics — September 16, subsequent update

The user then requested default ggplot aesthetics. Applied ggplot2's `theme_grey` appearance to the existing interactive viewer: a #EBEBEB chart panel, white major and thinner minor gridlines in both directions, dark ticks, no plot border, black lines/points, and plain sans-serif text. Larger triangles preserve sharp-rise indications; the selected capture has a dashed black line. Updated legends and notes to match. The geographic basemap is grayscale and its size-scaled outage points are black. The layout stays utilitarian and interface text stays at least 12 pt, rather than adopting ggplot's smaller default label sizes.

TypeScript checking and the frontend build pass. No browser visual QA was performed for this styling update. The running local server serves the rebuilt assets through the existing preview. The change does not migrate rendering to R or change capture/history calculations.

## Theme minimal, no emoji — September 16, subsequent update

Changed the chart to ggplot2 `theme_minimal`: removed the gray panel fill and axis tick marks, and changed both major and minor gridlines to pale gray on white. Black data marks and the thinner minor grid are retained. Replaced replay/export arrows with text and replaced Leaflet's default graphic attribution prefix with a plain text link; source attribution is preserved. The user's no-emoji preference is recorded in the README.

TypeScript/build and whitespace checks pass. Desktop and 390 px browser checks confirm the minimal chart appearance, working historical replay, no horizontal page overflow, no text below 16 px, no emoji presentation characters in displayed text, and no graphic in the Leaflet attribution prefix. Capture data, calculations, access and preview expiry are unchanged.

## Cumulative history map and drawn arrows — September 16, 23:17 UTC

Previous/next replay buttons now use stroked inline SVG arrows, with accessible labels and 44 px targets. The map has **One capture / All history** controls and an independent map-period selector. History mode combines verified archive locations into a fixed, approximately 1 km grid. Circle size represents distinct provisional source ID/start pairs per cell, deduplicating repeated polls. Popups show first/last observed capture times, peak simultaneous customers and uncertain identity counts. Missing detail, unmapped observations, continuity and provisional identity limitations are retained in Data notes. History mode hides single-capture totals, duration records and GeoJSON export so they cannot be mistaken for whole-period values. Chart selection returns to the selected actual capture.

Replay is read-only and bounded to 31 days, one million observations, 50,000 events and ten seconds, with one concurrent request and an explicit shorter-period error on limits. The existing `/api/series` allowlist supports its new spatial view; preview credentials and expiry did not change. The dashboard alone restarted as hidden PID 4072; verify its command line before stopping. Capture and preview processes remained running.

`npm test`: **61/61 pass**, including nine added tests for frequency deduplication, simultaneous peaks, moving locations, changing/ambiguous identities, missing evidence, gaps, empty captures, grid membership, limits and the HTTP route. TypeScript/build and whitespace checks pass. A local API check at 23:16:55 UTC replayed all **81 captures**, yielding **237 provisional events in 74 areas**, four uncertain identities, no unavailable details or unmapped observations, and 99.5% observed time coverage. The response was 14,308 bytes and the check completed in about 200 ms. These are checkpoint values, not current outage totals. Evidence: ignored `reports/spatial-verification.json`. No browser visual QA was performed for this update. At that checkpoint, legacy history was unimported, Phase 4 was deferred, and these revisions had not yet been committed or pushed.

## Heatmap and Census per-capita maps — September 16, 23:44 UTC

Replaced cumulative circles with a continuous blue density heatmap. It smooths deduplicated 1 km event cells using a fixed 750 m Gaussian bandwidth and a 2.25 km support radius. A period-wide square-root color scale preserves visibility of isolated locations, without rescaling during map movement. The plain `theme_minimal` layout and drawn arrow controls remain.

Added **Per capita** with outage-event and peak-customer measures per 1,000 estimated residents. Downloaded the official 2020–2024 ACS five-year population table B01003 and matching 2024 TIGERweb polygons, then joined all 685 Shelby County block groups. Population reconciles to 919,173; five areas have no positive denominator. Stored the 574 KiB compressed reference, source hashes and provenance locally. Census block groups have newer population estimates than Census blocks. Exact original outage coordinates are assigned to polygons; heatmap cell centers are not used for this join. Rates retain missing/zero denominators, population margins of error, uncertain incident identities and excluded observations. A visible caption distinguishes approximate location-based rates from the share of residents without power.

`npm test`: **67/67 pass**, with added coverage for polygon holes/multipart geometries, ambiguous shared boundaries, population denominators, simultaneous peaks, moving reports, complete Census geography joins and the read-only API. Strict TypeScript/build and whitespace checks pass. Desktop and 390 × 844 browser checks verified both new views, measure switching, population/MOE popups, no horizontal overflow, no text below 16 px and no console warnings/errors. Viewport overrides were reset afterward.

At 23:43:51 UTC, the local API replayed 86 captures in about 188 ms, with 239 provisional events assigned to 74 block groups, no missing detail or unassigned observations, and 99.1% time coverage. Anonymous requests to both new view routes were denied by the existing local preview gateway; authenticated requests succeeded. Evidence: ignored `reports/census-verification.json`. The dashboard restarted as hidden PID 1520; collection and the existing preview credentials/expiry were preserved. Phase 4 was deferred at that checkpoint. These changes had not yet been committed or pushed at that checkpoint.
