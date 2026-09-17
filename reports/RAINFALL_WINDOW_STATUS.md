# Rainfall accumulation checkpoint

Validated September 17, 2026. This report records the original crop's numeric checkpoint. The subsequent [rainfall dashboard checkpoint](RAINFALL_DASHBOARD_STATUS.md) expands the crop to close the boundary gap and enables 24/48/72-hour controls. Current replay commands and machine-readable reports use that expanded crop; historical measurements below remain as recorded. See [current status](PROJECT_STATUS.md) for runtime/access checks and remaining work. Historical outage comparisons are not yet enabled.

## Saved period and results

The pinned window is **June 24 00:00 through June 27 00:00 UTC, 2023**. Each input is the preceding one-hour `MultiSensor_QPE_01H_Pass2` depth, in millimeters; 72 consecutive endpoints form the full window. The 48-hour check starts June 25 00:00 UTC. Originals come from the [NOAA MRMS Open Data archive](https://registry.opendata.aws/noaa-mrms-pds/), and the prior source/product validation remains in [Phase 3A status](PHASE3A_STATUS.md).

| Check | 48 hours | 72 hours |
| --- | ---: | ---: |
| Retrieved, validated hourly inputs | 48/48 | 72/72 |
| Native cells with every hour present | 4,200/4,200 | 4,200/4,200 |
| Cell totals, minimum–maximum | 0–51.2 mm | 0–51.2 mm |
| Area-weighted mean over the prepared rectangle | 8.9051 mm | 8.9051 mm |

These matching results are expected: the saved rectangle has positive estimates only in the hours ending June 26 00:00 and 01:00 UTC. The extra first day contributes verified zero estimates. This is a storm burst with dry hours around it, **not a prolonged-rain case** or a worst-case storage benchmark. The mean describes the rectangle −90.3° to −89.6° longitude, 34.9° to 35.5° latitude, not Shelby County as a whole. QPE remains an estimate, not confirmed ground truth, ice accretion or snow depth.

## Correctness and coverage rules

- Only exact, non-overlapping one-hour intervals are summed. Duplicate endpoints, future/out-of-window inputs, changed grid/product/processing metadata, incompatible units, and unsupported quality/value combinations fail explicitly. No rolling 24/48/72-hour products are added together.
- A cell's full-period total is null unless every required hour has a valid value. Known partial contributions and valid-hour counts remain separate; missing hours are never zero-filled or scaled up.
- Area means use intersections of the preserved Polygon/MultiPolygon geometry, including holes, with native weather cells. Weights use a spherical cylindrical equal-area representation, with straight polygon segments in that representation and radius 6,371,008.8 m. This is an explicitly stated approximation, not ellipsoidal surveying accuracy. No centroid assignment, weather interpolation, or population weighting is used.
- Area summaries separate spatial coverage, complete-period area fraction, and area/time coverage. A full-target mean is withheld unless coverage is complete; a mean over fully observed cells is separately named and cannot stand in for the full area.
- The existing 2024 Census geometry was checked for all **685 block groups**. **684 are fully inside the prepared weather grid.** Block group **471579803001** has **97.6153%** spatial coverage, so its full-area mean is null. The weather extent needs expansion before claiming county-wide coverage. Original outage observations and Census population denominators were not changed.

Two deliberate in-memory fault checks preserved the real files: removing the wettest hour made every full-period cell total unknown, with 71/72 hours present; masking ten cells in one hour left precisely those ten totals unknown. Neither incomplete case produced a full-rectangle mean. The retained partial contribution after removing the wettest hour was 3.1510 mm, explicitly not the period total.

## Independent verification and resource use

- **95 tests pass**, including nine new accumulation/spatial/pressure tests. Cases include UTC/DST boundaries, duplicate/overlapping hours, missing versus zero values, partial cells, holes, multipart and concave geometry, latitude-dependent area, uncovered target area and storage pressure. The pressure test confirms that rejected new downloads preserve existing originals and allow offline reads.
- An independent Python/Pillow/NumPy replay checked **302,400 hourly native values**, all **8,400 accumulated values** across the two windows, and analytic spherical cell-weighted means. Four representative Census polygons, including the clipped boundary area, also passed an independent 1,600 × 1,600 polygon-rasterization check. Largest observed differences were 0.00585 mm in the complete-area mean, 0.000228 in coverage fraction and 0.216% in area. Rasterization is approximate; it cross-checks the production polygon clipping rather than replacing it.
- The three download batches made **71 requests** and received **37,832,876 bytes**; one hourly file was already cached. All 72 source originals total 38,503,043 bytes. Each batch finished in 11.7–12.0 seconds, with peak resident memory approximately 287–289 MB.
- Offline replay of all originals, accumulation and weighting took **20.3 seconds**, made **zero network requests**, and peaked at approximately **279 MB** resident memory. The block-group intersection step took 61 ms. These are measurements on this PC, not cloud capacity guarantees.
- The managed cache grew by **42,853,503 bytes** to **140,479,915 bytes (134.0 MiB)**: **52.3% of the existing 256 MiB cap**. The cap, response/request/download limits, 20 GB free-space floor and no-deletion policy are unchanged. No automatic weather job, cloud service or new runtime package was installed.
- At September 17 05:27 UTC, the outage collector had **155 valid captures, 100% observed slot coverage, no gaps over ten minutes**, and a healthy heartbeat. Its 24-hour and seven-day trials remain unfinished.

Machine-readable evidence is kept under ignored `reports/rainfall-window-*.json`; input and aggregate digests identify content-addressed files in `data/weather/cache/`. Aggregates retain every contributing manifest/source digest, the numeric processing version, geometry-reference digest and method. Deliberate faults exist only in the validation report, not in normal aggregate assets.

## Reproduce

```powershell
# Replay and analyze saved originals; no network access.
npm run weather:validate-window

# Explicit acquisition, at most 24 hourly endpoints per bounded job.
# Re-running a batch verifies and reuses saved originals.
npm run weather:collect-window -- --batch=1 --download
npm run weather:collect-window -- --batch=2 --download
npm run weather:collect-window -- --batch=3 --download

# Optional independent check: Python with Pillow and NumPy.
python scripts/verify-rainfall-window.py
```

The period is pinned in `config/rainfall-window.json`; the collector has no dependency on these jobs. An interrupted acquisition can be resumed by rerunning its batch after checking any stale writer lock as documented in the README. No file deletion is needed to resume a successful partial batch. The aggregate validator reads all source bodies again and fails the checkpoint if any required hour is unavailable.

The extent expansion and bounded period controls proposed at this checkpoint are now completed in the [rainfall dashboard checkpoint](RAINFALL_DASHBOARD_STATUS.md). Broader period preparation, condition comparisons and legacy outage import remain subsequent work. Include a prolonged-rain period in further performance/interpretation checks before making broader rainfall or retention claims.
