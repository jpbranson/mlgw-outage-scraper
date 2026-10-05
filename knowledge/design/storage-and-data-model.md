---
type: Design Section
title: "Storage and data model"
description: "Immutable gzip archive, SQLite schema-2 tables, storage budgets, backup implementation, planned desktop offload protocol and weather storage rules."
tags: [design, storage, sqlite, retention]
status: stable
generated: { by: "codex/unknown", at: 2026-09-23T04:17:59Z }
verified: { by: "process:documentation-review", at: 2026-09-23T04:16:15Z }
sources:
  - id: schema
    resource: "../../src/durable/schema.sql"
    title: "SQLite schema version 2"
    last_modified: 2026-09-23T03:30:55Z
---
# 5. Storage and data model

Canonical source bodies are immutable gzip files; each observation has a manifest and pinned parser. SQLite stores the compact index and rollups rather than one indefinitely retained row per outage feature per poll. The live data root is `/var/lib/mlgw/data`; local development uses the matching `data/` layout.

## Current filesystem layout

```text
data/collector/archive/objects/<original-body-sha256>.gz
data/collector/archive/manifests/<attempt-id>.json
data/collector/archive/parsers/<parser-version>-<parser-sha256>.mjs
data/collector/index.sqlite
data/collector/production-state.json
data/collector/staging/
data/weather/cache/
data/weather/live-cache/
data/weather/production/state.json
```

Byte-identical responses can share archived bodies, while each attempt retains its own times and provenance. Failed observations are not converted to zero outages. Production removes redundant staging only after verifying its durable copy. It preserves canonical originals; no unconditional one-year expiration or automatic history offload is enabled.

## SQLite tables

| Table | Stored purpose |
| --- | --- |
| `poll_attempts` | Attempt ID, scheduled/received times, HTTP status, outcome/error, archive keys and hashes |
| `attempt_facts` | Compact projection inputs for deterministic slot selection and zero confirmation, including counts, HTML totals, flags and recent event keys |
| `snapshots` | Unique accepted slot, capture time, raw key/hash, parser identity, quality and recent event-key cache |
| `totals` | Snapshot ID, affected customers and reported outages |
| `rollups` | Resolution/bucket, customer-minutes, covered minutes, mean/peak customers, peak outages and observation count |
| `leases` | Collector owner and expiration |
| `collector_state` / `maintenance_queue` | Internal state and queued rollup days |

The exact schema is `src/durable/schema.sql`, version 2. Projection policy `outage-projection-v2` selects the earliest valid candidate per slot with a stable ID tie break and re-evaluates dependent zero classifications after late imports. Time indexes and unique slot constraints bound reads and prevent duplicate publication. Coverage accompanies rollups. Older or unknown schemas require an explicit separate rebuild using `scripts/rebuild-index.mjs`; the canonical archive and pinned parsers reproduce the index. Copying only an open SQLite main file is not a valid live backup.

Production has a 20 GB collector budget, a 5 GB free-disk reserve and warning/offload/urgent fractions of 70%/80%/90%. These are pressure thresholds, not installed automatic offload jobs. Preserve the newest year and older evidence while capacity permits; review growth before those thresholds are reached.

## Automatic archiving to this PC

**Current backup implementation:** `npm run deploy:backup` downloads full verified bundles over SSH using an ACL-protected local key. The installed Windows task runs daily at 10 AM Central and at login, with three 30-minute retries and no overlapping runs. The PC must be online with the user signed in. Packages and receipts accumulate in `data/deployment/backups/`, with task output in `reports/scheduled-backup.log`. A verified cloud receipt is recorded after the local checksum succeeds; only temporary remote packaging is removed. Full-backup restore was verified. No automatic deletion of PC backups or canonical cloud history is enabled.

**Long-term offload preparation:** the [local transfer core](../weather/autonomous-continuation.md#desktop-transfer-core-and-rehearsal) supplies bounded bundles, resumable downloads, a SQLite verification catalog, authenticated receipts, restore and a non-executable cleanup-eligibility calculation. An actual 89-capture partition passed download/restore/replay. The offload receipt transactions, cleanup journal and installation described below remain unimplemented; the scheduled full-backup task does not implement that protocol.

The planned partition-offload protocol uses a **desktop-initiated download** over outbound HTTPS, so the PC needs no public address, open inbound port or always-running web server. It should run daily, resume after missed runs and prevent overlapping executions. Installing that resumable offload worker and selecting its final archive folder remain future tasks; the installed full-backup task currently uses SSH.

The archive preserves original payloads, normalized geometry/properties, UTC observation metadata, schema/parser versions, quality flags, and per-file SHA-256 checksums. Use portable daily or monthly bundles with a manifest, bounded part sizes, and a small local SQLite catalog. A source-to-bundle index preserves every retained observation even when repeated bodies are deduplicated. Retain long-term chart summaries and the archive catalog in the cloud.

Transfer protocol:

1. Predict storage use from measured recent growth and storm scenarios. Trigger preparation at 70% of the configured cloud archive budget, begin offloading older-than-one-year detail at 80%, and flag urgent pressure at 90%. Start earlier if needed to retain at least 30 days of projected incoming data plus transfer staging and cleanup-grace capacity. Include other VM data and temporary backup/transfer packaging in disk forecasts; these percentages are planning thresholds, not provider-enforced caps.
2. Select oldest eligible UTC date partitions only when every observation in them is strictly older than the current instant minus one calendar year. The plan does not permit moving the protected year out of cloud storage.
3. The PC checks available disk space, downloads immutable parts into `.partial` files, resumes interrupted transfers, checks byte counts and SHA-256, and verifies that the bundle can be read. Write the completed manifest/catalog atomically only after every part is verified.
4. The PC sends an authenticated receipt identifying the manifest version, object list, hashes, and completed local verification. A narrowly scoped machine credential lives in Windows-protected credential storage, never in the public dashboard.
5. The cloud records the receipt. After a seven-day grace period and a second successful local verification, the cleanup job rechecks age eligibility and removes only the receipted cloud detail. Keep manifests and summaries. Deduplicated payloads referenced by the protected year cannot be deleted.
6. After handoff, the public dashboard identifies that date's detailed map as archived to the owner’s PC. It continues to show cloud summaries. The owner can inspect full detail locally or explicitly restore selected bundles to the cloud for sharing; the public page does not connect to this desktop.

Use idempotent receipts, immutable manifest IDs, and a per-part cleanup journal so retries or partial deletion cannot lose unacknowledged files. Export SQLite observation metadata before any future cloud rows are pruned. Verify original bytes with SHA-256 independently of transfer protocol metadata. Test a restore from the actual downloaded bundle before first enabling cleanup.

The PC is on irregularly, so **30 days of offline headroom is a confirmed requirement**. If it is off, disconnected, full, or has failed verification, leave the cloud copies intact, retry when it becomes available, and show archive-backlog/last-receipt status. Size the reserve from measured storage growth and storm scenarios, with additional room for transfer staging and the deletion grace period. Forecast pressure early enough to preserve that reserve. A verified single-PC archive remains vulnerable to disk loss; a second local/external-drive copy is advisable where available.

There is a real capacity boundary: offloading data older than a year cannot help if the newest year alone exceeds provisioned storage, or if the PC stays unavailable beyond the reserve. Measure this before launch. Compress/deduplicate first, prefer five-minute over one-minute collection if needed, and review the provisioned capacity before adding storage or changing the VM plan. If the requirements no longer fit, surface the storage/cadence decision rather than silently deleting the protected year, losing old detail, or promising unlimited retention.

## Weather storage and jobs — Phase 3A, extended in Phase 5

Keep weather acquisition and processing separate from MLGW polling. Weather failures, rate limits or heavy raster processing must not delay outage capture or alter an accepted snapshot. Use a separate weather service, memory limit and cache budget. Cloud refresh and memory use were checked during deployment; heavy backfills remain bounded explicit work.

The deployed weather service refreshes recent radar, hourly rainfall and KMEM METAR every 30 minutes continuously, using separate production state. The former PC runner is stopped. Its disposable cache is capped at 256 MiB within the shared 1 GiB weather budget; radar expires after four hours, rainfall/METAR after 24 hours. Saved study evidence never expires through this runner. Shared writer/budget locks preserve aggregate limits; source latency and matching tolerances can still leave weather unavailable. Annual GHCNh revisions and new study acquisition remain explicit bounded jobs. See [operation and stop/resume controls](../weather/weather-guide.md#automatic-weather-refresh). The VM schedule has no trial deadline. Scheduled full backups include saved study evidence and exclude disposable rolling weather; external alerts remain unconfigured.

- Maintain a weather manifest with provider, product/version, source URL, observation/valid time or interval, retrieval time, units, CRS/grid or station ID, quality/missing-data flags, checksum and processing version. Record original weather times even when displaying a nearest eligible frame.
- Cache selected Memphis-area imagery and numeric subsets on demand. Use immutable timestamped cache keys, bounded time windows, request concurrency and retry/backoff. Avoid continuously retaining national radar volumes. Distinguish disposable display-cache entries from evidence required to reproduce a saved comparison.
- Preserve source-aligned numeric rainfall subsets, station observations, event/warning records and checksums for saved analyses. Keep full national files only as bounded processing inputs where required; validate the retained subset and its extraction provenance before discarding temporary derivatives. Do not change outage retention rules.
- Store compact weather summaries by native weather cell/station and time bucket, plus area-weighted summaries where appropriate. Store saved analysis periods, exposure/coverage, metric definitions and source/vintage versions. Separate measured data from derived condition classifications and cached visualizations.
- Derive long accumulations from non-overlapping increments or an explicitly matching source accumulation period. Never add overlapping rolling 24-hour rainfall totals. Preserve missing and trace values as distinct from measured zero.
- Measure download volume, disk growth, decode time and map payloads using a wet multi-day period as well as dry data. Select a weather-cache size after those measurements; it must fit inside the local free-space floor and any future shared cloud reserve.
