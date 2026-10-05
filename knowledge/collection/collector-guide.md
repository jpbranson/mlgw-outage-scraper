---
type: Guide
title: "Local durable collector"
description: "Commands, paths and invariants for the stopped PC collector archive, schema-2 rebuilds, trial evaluation and transfer rehearsal."
tags: [collection, archive, operations]
status: stable
generated: { by: "codex/unknown", at: 2026-09-23T04:17:59Z }
verified:
  - { by: "process:documentation-review", at: 2026-09-23T04:16:15Z }
  - { by: "claude-code/claude-opus-5-5", at: 2026-10-05T02:45:24Z }
sources:
  - id: collector-config
    resource: "../../config/collector.local.json"
    title: "Local collector configuration"
    last_modified: 2026-09-16T16:59:46Z
  - id: schema
    resource: "../../src/durable/schema.sql"
    title: "SQLite schema version 2"
    last_modified: 2026-09-23T03:30:55Z
---
# Phase 2 local collector

The local run stopped for cloud handoff on September 22 at 13:56:33 UTC, after its 13:55 capture. Its preserved state records `stopReason=cloud_cutover`. The following commands inspect or replay local evidence; production uses separate state and Linux services described in the [deployment guide](../operations/digitalocean-deployment.md). The original local run mirrored the source pilot and then collected directly.

```powershell
npm run collector:status
npm run collector:import
npm run collector:recover
npm run collector:replay -- 'REPLACE_WITH_CAPTURE_ID'
npm run collector:verify
```

`status` checks current freshness, runner heartbeat, observed slot coverage and storage pressure. `import` indexes completed source-pilot captures without another network request. `recover` verifies archived bodies/parsers and indexes any manifests left pending by a failed transaction. `replay` reconstructs a capture from its compressed original with the saved parser. `verify` runs isolated 4,000/10,000-feature archive/replay checks and restores the real archive into a separate temporary database; it never adds synthetic data to the live index.

For an interrupted local trial that has not stopped or completed, `npm run collector:run` preserves its recorded window and skips missed observation slots. The existing PC trial is stopped for cloud handoff and must remain stopped while the VM collects. Its latest pre-handoff end time was September 22 at 17:00 UTC; the original September 23 deadline is historical. Source restrictions or urgent storage pressure retain a recorded reason. Do not erase state or archived history to hide gaps.

Paths:

- `config/collector.local.json`: cadence, seven-day duration, storage budget and pressure thresholds; automatic deletion is disabled.
- `data/collector/archive/objects/`: immutable gzip bodies addressed by the original-body SHA-256.
- `data/collector/archive/manifests/`: one immutable observation record per attempt, including failure evidence and parser provenance.
- `data/collector/archive/parsers/`: the source parser version used for historical replay.
- `data/collector/index.sqlite`: compact capture index, totals, recent comparison cache, leases and queued rollups. SQLite WAL/SHM files may be present while running; do not copy only the database file as a live backup. The separate immutable archive can rebuild the index.
- `data/collector/inbox/`: local diagnostic captures made after the pilot-to-collector handoff and before cloud cutover. These remain alongside the canonical archive on this PC. Production uses separate temporary staging.
- `reports/collector*.log`, `reports/collector-health.json`, `reports/durable-verification.json`: runtime logs, health and restore evidence.

Only one publication per actual five-minute slot is accepted. Failed/suspect captures do not advance the latest trustworthy snapshot. A failed database transaction leaves raw evidence available for retry. Original and HTML request times remain separate. Rollups store coverage alongside customer-minutes and never fill collection gaps with zero outages.

Schema 2 records compact `attempt_facts` and uses projection policy `outage-projection-v2` to select snapshots independently of import order. Both the production and stopped PC indexes were rebuilt and compared against their prior snapshots. Use `npm run collector:rebuild -- <collector-root> <separate-empty-index-directory>` for a separate verified rebuild; older or unknown index schemas require explicit migration. Follow the [upgrade and rollback procedure](../operations/digitalocean-deployment.md#routine-upgrades) before replacing a live index.

The local status command is an on-demand check of the saved PC state. Production has a separate two-minute systemd health timer, including a verified-PC-backup age check with a 36-hour limit. External notifications remain unconfigured by choice. The Windows backup task is installed; local collection remains stopped. Filesystem/SQLite restore and runtime behavior were verified on DigitalOcean. Cloudflare-specific tests remain an unused alternative.

`npm run collector:accept-trial` remains a local trial evaluator. It requires recorded completion and checks coverage, failures, storage, rollups and restore behavior; it never restarts or extends a trial. The existing run ended by cloud handoff, so reaching the former September 23 deadline cannot make it an accepted seven-day trial. Production verification uses the deployment guide and `deploy:verify`.

The local desktop-transfer core can be rehearsed with `npm run archive:verify-transfer`. It creates bounded, checksummed bundles from real captures, resumes downloads into an isolated temporary folder and restores/replays them. The [transfer checkpoint](../weather/autonomous-continuation.md#desktop-transfer-core-and-rehearsal) documents the verified 89-capture rehearsal. The deployed `deploy:backup` command downloads verified full backups over SSH, runs through the installed Windows task and records a verified backup receipt on the VM. The separate long-term offload protocol, cleanup journals and automatic deletion of canonical history remain uninstalled. The API token and SSH key stay local and ignored by Git.
