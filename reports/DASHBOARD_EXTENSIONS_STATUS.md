# Dashboard extensions: replay playback, custom episodes, exact locations and paired rainfall maps

September 23, 2026. This checkpoint implements the four interface extensions that the [project status](PROJECT_STATUS.md) listed as remaining: automatic replay play/pause, arbitrary episode selection, synchronized side-by-side rainfall/outage maps and integration of the reported-outage-location dataset. It also adds rolling 24-hour rainfall totals, so the paired maps can compare rain with current-feed outages rather than only with dates before collection began.

## What changed

| Feature | Behavior | Main files |
| --- | --- | --- |
| Replay play/pause | Steps through accepted captures at 4 s, 2 s or 1.25 s. It continues into the next UTC day when that day has captures, and pauses on any other selection. The Legacy archive has the same control. | `web/app.ts`, `web/legacy-archive.ts`, both HTML pages |
| Custom episode | An explicit Central-time interval of up to 31 days. It drives the chart, CSV and the Heatmap, Per capita and Locations maps. Shareable through `?from=…&to=…&view=…`. | `web/app.ts`, `web/index.html` |
| Locations view | Exact published coordinates colored and sized by distinct source records, with a filter for reused points, a ranked list of the ten most reused, and a CSV export. | `src/dashboard/spatial.mjs`, `service.mjs`, `server.mjs`, `web/app.ts` |
| Paired rainfall/outage maps | The Rainfall view shows a second map of current-feed outage density over exactly the rainfall interval, with optional linked pan and zoom. | `web/paired-map.ts`, `web/rainfall.ts` |
| Rolling 24-hour rainfall | The cloud weather runner publishes sliding 24-hour MRMS totals from the hourly frames it already retains. | `src/weather/maintenance.mjs`, `src/weather/publish.mjs`, `scripts/production-weather.mjs` |

## Rules kept unchanged

- **Episodes.** An episode uses the existing API limits: at most 31 days, five-minute detail only up to two days, and one historical replay at a time. Time before current-format collection is reported as unknown. An ambiguous fall-back time uses its first (daylight-time) occurrence. A time skipped by the spring change is rejected rather than shifted.
- **Location identity.** Locations use the same identity and review bounds as `reported-outage-locations-v1`: exact numeric longitude/latitude, with source outage IDs as records. Repeated polls count once. Customer counts are summed only within one capture before taking a peak. Reuse of a point establishes location sharing only. Coordinate transitions and the unconfirmed nearby-replacement candidates remain in the offline SQLite build. No scheduled rebuild of that database was added, because the dashboard computes the same per-point summaries directly from hash-verified replay for the selected period.
- **Paired maps.** The outage side never draws weather, and its color scale is relative within the period, as in the Heatmap view. Coverage below 90%, unavailable detail and periods before collection are stated on the map. Shared locations are not presented as causes.
- **Rolling totals.**
  - A total is published only when all 24 one-hour Pass 2 frames are present.
  - Missing hours or cells are never treated as zeros.
  - Accumulation (`hourly-rainfall-v1`), grid checks, block-group area weights and the display legend are the same as for prepared periods.
  - Each total records its sources and is tied to its final hour's manifest, so ordinary retention removes it after about a day.
  - Hourly rainfall retention rose from 24 to 28 hours. Pass 2 latency otherwise removed the oldest hour before a complete window existed: both the PC and VM caches held only 23 frames.
  - At about 0.7 MB per frame, the four extra hours add about 3 MB to the 256 MiB rolling budget.
  - Rolling totals are labeled display aids, not saved study evidence.
- **Replay budget.** Playback waits for each map and its weather to load before scheduling the next step. The day list is reread only when playback leaves it. The fastest pace uses fewer than the 120 requests per minute allowed per client.

## Verification

- **Accumulation reproduces a validated period.** The rolling code path was run offline on the 24 saved originals for September 14, 2024. It matched the independently validated prepared period (`a1babcfa…`) exactly: all cell values, hours per cell, grid, summary, area-weighted mean and 685/685 complete block groups. Publication took 188 ms, including block-group weights.
- **Real current-feed period.**
  - The locally retained rolling frames (September 21 14:00 to September 22 12:00 UTC) were copied to a temporary cache.
  - Exactly one missing public MRMS hour was downloaded: 550,623 bytes, for September 21 13:00 UTC.
  - The run upgraded 23 older frames in 7.1 s (about 300 ms per decode on this PC) and published a 24-hour total ending September 22 12:00 UTC.
  - The total's maximum was 0 mm, consistent with the dry KMEM reports for that day.
  - The paired map showed 95 reported events in 255 verified captures at 87.8% time coverage.
  - The live data folders were not modified.
- **Locations on the local archive.** For the available history there were 845 exact reporting locations, 48 of them reused by two or more source records.
- **Browser checks.**
  - Headless Chromium runs on desktop (1440 px) and phone (390 px) exercised Locations, the paired maps, an applied episode with its shareable URL, replay crossing from September 19 into September 20 UTC, and legacy replay.
  - None logged a page or console error.
  - A new Playwright case covers playback, the Locations view and CSV link, episode restoration from the URL, episode validation and the paired Rainfall view. It runs on both desktop and phone.
- **Tests.**
  - `node --test test/*.test.mjs`: 206 tests passed before the case-study work was merged, and 209 after it.
  - New Node tests cover exact-location recurrence, the location API and CSV, and rolling totals. The rolling-total tests include a missing hour, the one-time upgrade of older frames, the rolling catalog flag and retention removal.
  - `npm run dashboard:build` (TypeScript and bundle) passed. `npx playwright test` passed 6/6.

## Limits

- Rolling totals exist only for the last day, and only 24-hour windows. A 48- or 72-hour rolling window would need more retained hourly originals than the 256 MiB rolling budget reliably allows alongside four hours of radar. Longer storm periods still use explicit, bounded saved-period preparation.
- **Deployed September 23 at 07:45 UTC.** The runner's first run on the new code upgraded the VM's 23 retained frames. That cache held only 23 frames, so the first complete window appears after the next hourly frame is added under the 28-hour retention.
- Paired outage maps cover current-format collection only. Before September 16, 2026, legacy regional totals remain on the Weather comparisons page. Legacy grid polygons are not mixed into the current-feed density map.
- Episode links reproduce the selected interval. A later import of late captures can change coverage within that interval.
