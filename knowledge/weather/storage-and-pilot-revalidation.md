---
type: Checkpoint Report
title: "Weather storage implementation and pilot revalidation"
description: "September 17, 2026 1 GiB weather cap, lossless station compression, storage verification and completed-pilot/archive revalidation."
tags: [weather, storage, pilot, recovery]
status: stable
generated: { by: "codex/unknown", at: 2026-09-22T16:41:52Z }
verified: { by: "process:documentation-review", at: 2026-09-23T04:16:15Z }
sources:
  - id: station-compression
    resource: "../../reports/weather-station-compression.json"
    title: "Station compression migration (local, ignored by Git)"
    last_modified: 2026-09-17T21:59:18Z
  - id: storage-verification
    resource: "../../reports/weather-storage-verification.json"
    title: "Weather storage verification (local, ignored by Git)"
    last_modified: 2026-09-17T22:03:27Z
  - id: pilot-summary
    resource: "../../reports/pilot-summary.json"
    title: "Pilot analysis summary (local, ignored by Git)"
    last_modified: 2026-09-24T17:16:34Z
  - id: phase1-checkpoint
    resource: "../../reports/phase1-local-checkpoint.json"
    title: "Phase 1 local checkpoint (local, ignored by Git)"
    last_modified: 2026-09-17T22:00:38Z
---
# Weather storage implementation and pilot revalidation

**September 22 deployment update:** the [DigitalOcean deployment guide](../operations/digitalocean-deployment.md) is authoritative for current operation. The VM now serves the dashboard and runs both collectors; local collectors are stopped. Runtime counts, preview sessions, trial deadlines and hosting gates below describe this earlier checkpoint. Its scientific findings and dated validation results are preserved.

Completed September 17, 2026, following the user's request to implement the storage recommendation and then validate the completed 24-hour pilot.

**Subsequent September 18 update:** [bounded weather maintenance](autonomous-continuation.md#bounded-ongoing-weather-maintenance) adds a separate disposable cache under the shared 1 GiB budget, with a shared budget lock, four-hour radar retention and 24-hour rainfall/METAR retention. The saved evidence cache described below still has automatic expiration disabled. Migration measurements and the 354-capture restore remain dated evidence; see [current status](../project-status.md) for the latest runtime and full-restore checkpoint.

## Storage result

- Weather cache capacity increased from **256 MiB to 1 GiB** in `config/weather.local.json`.
- Station originals now use lossless gzip storage. Their original SHA-256 identities, original byte counts, source manifests, retained revisions and saved derivative references remain unchanged. Readers support both legacy `.raw` and compressed `.raw.gz` files.
- The existing **32 MiB response cap, 96 MiB download budget, 24-request limit, five-minute run deadline, 20 GB free-space floor and disabled automatic expiration** remain unchanged. Compression does not increase permitted source response sizes.
- New station retrievals store and verify gzip before writing a manifest. The explicit migration enumerates current and retained station revisions under the existing writer lock, writes compressed files atomically and replays them from disk. It removes a redundant raw representation only after another exact comparison. Failures leave source evidence intact; rerunning after an interruption is supported.
- Decompression is bounded by the original length and response limit, and the reconstructed body must match its SHA-256. A corrupt compressed file fails closed instead of silently selecting another copy.

The migration at **21:59:16 UTC** verified all four retained station originals. Their **86,119,001 original bytes** now occupy **4,351,148 compressed bytes**: a saving of **81,767,853 bytes / 78.0 MiB**. Managed cache use decreased from **234,335,388 bytes / 223.5 MiB** to **152,567,535 bytes / 145.5 MiB**. The subsequent offline weather replay added small derived artifacts, bringing use to approximately **152,796,565 bytes / 145.7 MiB**.

All manifests, revisions, published assets and existing derived files were hash-identical before and immediately after migration. Only the redundant uncompressed representations of the four station originals were removed. Both the earlier and refreshed 2026 source snapshots remain replayable. No network downloads, outage archive changes or collector restarts were required.

Reproduce the bounded migration with:

```powershell
npm run weather:compress-stations
npm run weather:compress-stations -- --apply
```

The first command plans and verifies without modifying cache objects. The second applies the representation change. Both write a local report. Current readers automatically use compressed originals; no manifest rewrite or dashboard rebuild is needed.

## Storage verification

- **115 test entries pass**, including legacy/current revision preservation, interrupted migration and restart, corrupt gzip handling, storage pressure before cleanup, decompression bounds, new compressed downloads and reuse of equivalent gzip encoded at another compression level.
- All **168 distinct referenced weather originals** passed size and SHA-256 verification after migration, including the four station originals. Their uncompressed content totals 211,617,721 bytes.
- The wet, dry, winter and pinned September 16 weather cases replayed offline with **zero requests**. The lagging 2026 station source still correctly has no September 16 observations.
- All **six prepared rainfall periods and their PNGs** remained available from the running local API, each retaining its 4,800-cell grid and complete rainfall coverage for 685 block groups.

Evidence: ignored `reports/weather-station-compression.json`, `reports/weather-storage-verification.json`, `reports/weather-storage-replay.log` and `reports/storage-tests.log`.

## Completed 24-hour pilot revalidation

The earlier scheduled review had already passed the pilot's local observation gate. This requested revalidation reran the analysis at **21:59:51 UTC**, then verified originals, parser replay, durable archive recovery and dashboard results at **22:00:38 UTC**.

| Check | Result |
| --- | --- |
| Observation span | September 16 16:37:51.973 UTC through September 17 16:40:00.203 UTC: **24 hours, 2 minutes, 8.230 seconds** |
| Valid pilot observations | **290 / 290 expected observed slots (100%)** |
| Failures / parser quality issues | **0 / 0** |
| HTML affected-customer comparisons | **290 / 290 match** |
| Maximum pilot interval | **301.014 seconds**; no gap over ten minutes |
| Pilot archive replay | All **290** feed bodies, HTML originals and normalized results match their durable copies and retained-parser replay |
| Collector handoff | First direct capture at **16:45:01.288 UTC**, 301.085 seconds after the final pilot capture |
| Combined archive at the 22:00:24 UTC cutoff | **354 / 354 valid slots**, including 290 pilot records and 64 direct collector captures; no duplicate slots or gap over ten minutes |
| Isolated restore | **354 / 354** snapshots restored with matching timestamps, quality and totals; repeating recovery found all 354 already indexed, with no duplication |
| Local dashboard | Latest totals and geometry match the index; all **354** historical series points match |

The pilot is complete and **passes the local 24-hour observation gate**. The 290 count includes the initial partial five-minute slot and the terminal observation at/after the 24-hour endpoint. This validation does not restart or extend it.

Source identity caveats remain: eight IDs received start-time edits, and 27 IDs had 30 coordinate edits. These are preserved observations, not verified new incidents or restoration records. The prior [source review](../collection/phase-1-source-contract.md#completed-24-hour-local-review--september-17) retains the detailed interpretation and HTML-inclusive storage model.

The separate seven-day collector remained healthy at **22:00:40 UTC**, with its original PID and September 23 17:04:02.511 UTC end time. Its full seven-day acceptance and deferred cloud CPU/quota/storage validation remain open.

Evidence: ignored `reports/pilot-summary.json`, `reports/pilot-storage-review.log`, `reports/phase1-local-checkpoint.json`, `reports/pilot-storage-revalidation.log` and `reports/storage-collector-health.json`. The preceding scheduled-review JSON was preserved as `reports/phase1-local-checkpoint-scheduled.json` before the new audit. Recovery writes were confined to a new temporary database; the live index was opened read-only by the audit helper.
