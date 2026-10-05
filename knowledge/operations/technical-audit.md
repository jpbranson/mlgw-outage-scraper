---
type: Checkpoint Report
title: "Technical audit implementation — September 22–23, 2026"
description: "September 22–23, 2026 deterministic recovery, schema-2 rebuilds, runtime boundaries, release rollback, CI/browser checks and scheduled PC backups."
tags: [operations, recovery, architecture, ci, backup]
status: stable
generated: { by: "codex/unknown", at: 2026-09-23T03:56:25Z }
verified: { by: "process:documentation-review", at: 2026-09-23T04:16:15Z }
sources:
  - id: projection
    resource: "../../src/durable/projection.mjs"
    title: "Snapshot projection policy outage-projection-v2"
    last_modified: 2026-09-23T03:30:00Z
  - id: rebuild
    resource: "../../scripts/rebuild-index.mjs"
    title: "Schema-2 index rebuild"
    last_modified: 2026-09-23T03:38:39Z
  - id: upgrade-script
    resource: "../../deploy/digitalocean/upgrade-release.sh"
    title: "Release upgrade and rollback script"
    last_modified: 2026-09-23T03:45:42Z
  - id: ci
    resource: "../../.github/workflows/ci.yml"
    title: "Continuous integration workflow"
    last_modified: 2026-09-23T03:40:31Z
---
# Technical audit implementation — September 22–23, 2026

The project records MLGW observations before the source overwrites them, then serves current conditions, historical replay and bounded weather comparisons. The useful architecture remains a single VM, an immutable original archive, a rebuildable SQLite index and a read-only dashboard. No framework, queue, distributed database or additional paid service was introduced.

## Correctness and recovery

- `src/durable/production.mjs` now verifies the canonical manifest and indexed hash before removing redundant staging. Cleanup tolerates already-removed files, and recovery uses the archived parser rather than restaging evidence under today's parser. Regression tests interrupt each cleanup boundary.
- `src/durable/projection.mjs` and `LocalCollector.projectFrom()` select the earliest valid candidate within each five-minute slot, with a stable ID tie break. Late observations re-evaluate dependent zero classifications. Compact `attempt_facts` make this independent of import order; full feature histories remain in the archive. Contradictory zero observations still require review, and an abrupt unconfirmed zero remains quarantined.
- Projection policy `outage-projection-v2` is recorded in new manifests and indexes. Schema 1 and unknown versions fail closed. `scripts/rebuild-index.mjs` builds a separate schema-2 index, verifies originals using pinned parsers, compares snapshot choices/totals, drains rollups and checks SQLite integrity. The live database is never silently reinterpreted in place.
- `src/runtime/durable-files.mjs` flushes files and directory entries at publication boundaries. Linux directory-sync failures propagate; Node cannot perform the same directory operation on Windows. Archive hard links continue to enforce no-clobber publication.
- Interrupted HTTP bodies retain status and response headers. A failed 403 or 429 body therefore still stops or backs off instead of looking like a generic retryable network error.
- Valid counts survive additive schema fields, uncertain times and map-detail warnings. Warnings remain indexed, are returned by the snapshot API and are explained in the selected-capture note. Invalid counts/identities remain blocked.

The projection change costs one small facts row per attempt and a versioned rebuild. This is justified by reproducible restoration; it does not justify replacing SQLite or persisting another full normalized history.

## Runtime and boundaries

- The dashboard systemd mount namespace makes the canonical archive read-only. The collector directory remains writable only where SQLite WAL coordination requires it.
- Data request limits are per client, with a separate aggregate ceiling and bounded client bookkeeping. Forwarded addresses are trusted only from the explicitly configured loopback proxy. `/api/health` remains available under quota pressure; `/api/ready` returns 503 when current observations are unhealthy.
- Historical spatial replay has a four-entry, 30-second cache keyed by query and SQLite data generation, plus cancellation between captures. Existing observation/time limits and one-replay concurrency remain. This bounds repeat work without introducing a cache service; verification of deliberately corrupted detail may be delayed by at most that TTL.
- Archive size is reconciled hourly and incremented conservatively between scans, instead of traversing all files every 30 seconds. Free disk is still checked every cycle. Automatic archive deletion/offload remains absent and is explicitly reported.
- Prepared and rolling weather catalogs are evaluated independently. Missing prepared study weather no longer hides healthy rolling weather. Recoverable replay/catalog failures now produce structured stderr records with operation and capture context, while public errors remain generic.
- Production fetches no longer perform the pilot's duplicate normalization pass. Shared frontend API types and timeout handling were extracted; the existing map/chart ownership and request sequencing remain intact.
- Production configuration rejects unsupported keys, cadence, budgets and retention assumptions. This prevents settings from appearing to control behavior they do not implement.

## Operations

`deploy/digitalocean/upgrade-release.sh` verifies a code-only bundle, requires a recent verified PC backup and rebuilds alongside the running collector. It stops writers for a final catch-up, saves the prior index/service definitions, switches the release and checks readiness. A failed cutover restores the prior release and index while preserving canonical observations and the failed index for diagnosis. Retained rollback files require operator review; they are not automatically pruned.

`scripts/backup-cloud.mjs` downloads a manifest-snapshotted archive/application/study bundle to this PC. Packaging checks free space before copying, hard-links immutable originals when possible and hashes large files in bounded chunks. A successful local checksum creates the cloud backup receipt before temporary remote packaging is removed. Live SQLite, credentials and disposable rolling weather are excluded. These remain full backups; incremental storage is unnecessary at current size but should be revisited as the archive grows.

The user selected **PC backups only; cloud monitoring prepared for later**. The Windows task runs daily at 10 AM local time and at user login, with retries and no overlapping instances. This PC must be online and the user signed in. Backups are retained under ignored `data/deployment/backups/`; task output goes to `reports/scheduled-backup.log`. A missing or older-than-36-hour verified backup degrades the private health check. No paid backup product or external alert account was provisioned.

Optional external heartbeat configuration is in `deploy/digitalocean/monitoring.env.example`. It sends only after all private health checks pass. The endpoint is unset for this deployment; VM/disk/backup failures are recorded locally but do not currently send an external notification.

## Verification and ongoing checks

Local checks: 203 Node tests, TypeScript/build, and four Playwright cases across desktop and phone. The new regression coverage includes arrival permutations, partial cleanup, pinned-parser recovery, interrupted responses, schema guards, count-quality separation, catalog isolation, request quotas, cache invalidation/cancellation and backup/health conditions. Rebuilding the stopped PC archive reproduced 1,722 attempts and 1,635 snapshots with **zero added, removed or changed snapshots**, with integrity `ok`.

`.github/workflows/ci.yml` runs Node/build/browser checks on Windows and Linux, Python legacy tests, and an R verifier syntax check. It does not pretend that fixture tests replace a full archive restore or independent scientific replay. Deployment and restore results are recorded in [the deployment runbook](digitalocean-deployment.md).

## Deliberately unchanged

Keep the single writer, SQLite/WAL, bounded HTTP server, raw evidence and pinned parsers, offline study preparation, UTC storage with explicit source-time uncertainty, and Leaflet/Chart.js. Splitting every frontend view or historical script into new abstractions would add migration cost without addressing a demonstrated defect. Source polling remains five minutes; gaps remain unknown, not invented zeroes. Public dashboard access remains read-only without login. Multi-region availability, automatic archive offload, paid storage and active cloud notifications remain outside this deployment's selected scope.
