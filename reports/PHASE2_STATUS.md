# Phase 2: local durable collection

Updated September 16, 2026. **Local implementation is built and verified; the seven-day collection trial is running.** The original cloud deployment and operating acceptance criteria remain deferred. Phase 1's 24-hour source observation is still in progress. The user's request to proceed authorizes this local Phase 2 work while that observation continues; it does not establish that the earlier cloud feasibility gates passed.

## Implemented behavior

- Immutable gzip objects named by SHA-256 of the original body, with verification after write and on replay. Identical bodies share storage while each observation keeps its own manifest and timestamp.
- Independent archive manifests containing original attempt metadata, selected HTTP response headers, raw/HTML object references and parser provenance. The parser source is retained with a content hash so historical replay uses the saved version.
- A SQLite index with attempts, snapshots, compact totals, recent event-key comparison cache, collector state, leases, maintenance queue and hourly/daily rollups. WAL, full synchronous commits and foreign keys are enabled. One accepted snapshot per actual five-minute observation slot prevents duplicate publication.
- Archive publication before the database transaction. A failed commit leaves recoverable archived evidence. Recovery verifies hashes and rebuilds a fresh index; repeated recovery does not add duplicate snapshots.
- Original scheduled time and actual retrieval time remain distinct. Late captures cannot move the latest valid pointer backward or masquerade as backfilled observations.
- Invalid payloads and HTTP errors remain explicit attempt records; they never become zero-outage snapshots. HTML mismatches and schema/geometry problems are marked for review. A large-to-zero transition without supporting HTML zero is held until a subsequent empty capture confirms it.
- Expiring leases with an ownership check before publication; at most two retries for transient fetch failures, bounded timeout/response size, jitter, Retry-After handling and source-restriction stops.
- Hourly/daily left-step customer-minute estimates split at UTC boundaries. Intervals over 7.5 minutes, suspect snapshots and intervening failures contribute unknown time. Each rollup stores covered minutes, observed peaks and observation counts. Dirty UTC days are queued and recalculated in bounded batches, including late-arriving captures.
- Freshness based separately on successful HTTP retrieval and the latest trustworthy snapshot, warning after 10 minutes and stale at 15. Source publication time remains unknown. Runner heartbeat and collection-window coverage are separately reported.
- Storage-pressure telemetry and a configured stop at urgent local pressure. No history, diagnostic input, archive objects or database rows are automatically deleted. A short-lived event-key cache may be cleared because the complete source remains archived.

## Running trial

The seven-day local window began **September 16 at 12:04:02 PM Central** and ends **September 23 at approximately 12:04 PM Central**. The exact window and current PID are in `data/collector/run-state.json`. The runner is a hidden Node process, not a Windows service or startup task.

It checks the current Phase 1 pilot every 30 seconds and indexes completed captures. While that pilot owns its observation window, the new collector does not issue additional MLGW requests. After the Phase 1 pilot completes, it continues source collection every five minutes into its own inbox. Source restrictions and backoff carry through the handoff. It retains all Phase 1 files and separately stores its compressed archive.

The PC must remain awake and online. Sleep, shutdown or a stopped process can create gaps; a later run records current observations and reports the missing time. Restarting `npm run collector:run` resumes the existing window, not a new seven-day claim. No Windows power settings were changed.

The check-in on **September 17 at 12:15 PM Central** will review the 24-hour source results and the local durable collector's progress. It will not treat one day of evidence as a completed seven-day reliability trial. Cloud work and Phase 3 remain outside this checkpoint.

## Verification evidence

**34 automated tests pass.** Coverage includes malformed and empty feeds, timezone/DST cases, duplicate attempts and slots, disk-write failure, simulated database-commit failure, recovery into a fresh database, checksum/parser tampering, overlapping leases, delayed runs, Retry-After, suspicious zero confirmation, stale-data thresholds and rollup gaps/hour/day boundaries.

At **17:06:47 UTC**, a separate local restore verified **seven real manifests and seven valid snapshots**, with no pending rollup days. The latest restored observation was 17:05 UTC, with 12 reported outages affecting 404 customers. These are timestamped observations, not a current-outage claim. An earlier real snapshot replay reproduced its 16 features and 216 customers. Re-import/recovery did not double-count them.

| Synthetic case | Raw bytes | Archive + SQLite bytes after close | Local import wall time | Full normalized replay |
| --- | ---: | ---: | ---: | --- |
| 4,000 features | 1,386,237 | 312,012 | 142 ms | Equal |
| 10,000 features | 3,467,248 | 656,662 | 327 ms | Equal |

The stress cases were isolated in a temporary verification directory, never mixed into real history. These measurements include a single snapshot's local compressed archive, parser, manifest and SQLite files; they are not bytes-per-poll forecasts or Cloudflare performance measurements. Raw diagnostic input is outside those per-case sizes. Full machine-readable results and the restore location are in `reports/durable-verification.json`.

## Local operation and limitations

Use `npm run collector:status` for a freshly calculated health report, `npm run collector:recover` to verify/reindex the archive, and `npm run collector:replay -- <capture-id>` to reconstruct a historical snapshot. See [README.md](../README.md) for all commands and paths.

The local budget is 10 GB with pressure thresholds of 70/80/90%, plus a 20 GB minimum free-disk floor. These are configurable local safeguards, not cloud billing controls. Phase 2's diagnostic inbox retains uncompressed input and normalized test output as well as the compressed archive, so local disk use exceeds the proposed cloud storage model. The 48-hour normalized cloud cache is not deployed; local historical replay currently reconstructs it on demand.

The independent status command can detect a stale runner heartbeat; no separate always-on notification service is installed. The Node filesystem/SQLite implementation is a local validation backend, not an R2/D1 emulator or a tested cloud adapter. The runtime uses Node 24's built-in [SQLite API](https://nodejs.org/docs/latest-v24.x/api/sqlite.html).

## Remaining acceptance work

1. Observe the ongoing seven-day run and report real slot coverage, failures, gaps, disk growth and recovery behavior. The target of 99% success and no unexplained gap over 15 minutes has not yet been demonstrated.
2. Finish the Phase 1 local source-characterization report and refine any provisional timezone/identity/capacity assumptions.
3. When the user resumes cloud work, implement and validate the selected cloud storage/runtime adapters, separate development/production resources, account quotas and deployment credentials.
4. Keep production cloud retention/cleanup and verified desktop transfer deferred to their planned phase. Keep the dashboard and public API in Phase 3.
