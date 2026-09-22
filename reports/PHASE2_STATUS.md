# Phase 2: local durable collection

**September 22 deployment update:** the [DigitalOcean deployment guide](DIGITALOCEAN_DEPLOYMENT.md) is authoritative for current operation. The VM now serves the dashboard and runs both collectors; local collectors are stopped. Runtime counts, preview sessions, trial deadlines and hosting gates below describe this earlier checkpoint. Its scientific findings and dated validation results are preserved.

Implementation checkpoint recorded September 16, 2026; local operating review updated September 17 at approximately 12:20 PM CDT. **The source pilot completed and handoff succeeded; the seven-day operating acceptance is still pending.** The collector continues in direct-capture mode within its original window. Original implementation/test measurements below remain dated evidence; the new review is recorded separately. Dashboard/weather implementation and temporary Quick Tunnel access do not pass the deferred production-cloud feasibility gates.

**September 18 continuation:** the [autonomous checkpoint](DEVELOPMENT_COMPLETION_STATUS.md) adds `npm run collector:accept-trial` and a verified local desktop-transfer core. The full archive restore passed for 602/602 captures at the 18:40 UTC cutoff; earlier restore counts below are historical. The original trial ends September 23 at **12:04:02 PM CDT**. The acceptance command waits for that end and the runner's completion marker, then checks coverage, failures, gaps, storage and rollups and performs a fresh full restore. Before completion it reports `awaiting-trial-end`; it does not restart the trial. Provider-backed transfer, cloud receipt transactions/cleanup and Windows installation remain pending account/runtime setup.

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

The scheduled **September 17 at 12:15 PM CDT** check-in completed. Permanent cloud collection/storage and provider-backed Phase 4B transfer installation remain pending account/runtime setup; the local transfer core is implemented. Phase 4A legacy audits subsequently completed locally; separate legacy dashboard integration is complete, as recorded in [current status](PROJECT_STATUS.md).

### September 17 operating review

**Subsequent requested verification at 22:00 UTC:** 354/354 valid captures, with all 290 pilot captures plus 64 direct captures, no duplicate slots and no gaps over ten minutes. All 354 snapshots replayed and restored into a new temporary index; repeat recovery duplicated nothing. The original run window and collector PID remain intact. See [the latest checkpoint](STORAGE_AND_PILOT_STATUS.md). The measurements below retain their earlier cutoff.

At the **17:15:01.965 UTC / 12:15 PM CDT** capture cutoff, the durable index contained **297 accepted captures**, covering all 297 five-minute slots in its observed span. All **290 Phase 1 captures were mirrored**, and seven subsequent captures came from the collector's own inbox. The last pilot capture was at 16:40:00.203 UTC; the first direct capture was **16:45:01.288 UTC**, a 301.085-second handoff gap. There were no duplicate slots, recorded HTTP failures, gaps over ten minutes or queued rollup days. The longest observed interval across the combined archive was 305.481 seconds.

`npm run collector:status` reported healthy freshness, heartbeat and storage. The latest capture at that cutoff contained **134 customers / 9 reported outages**. The advancing heartbeat was verified at 17:19:35 UTC; PID 17944 remained a running Node process. The finished pilot's PID was no longer running. The collector retained `startedAt=2026-09-16T17:04:02.511Z` and `endsAt=2026-09-23T17:04:02.511Z`; no restart, new trial window or backfilled observations were introduced. The observed archive also includes earlier mirrored captures before the seven-day runner started, so archive span is not the runner's elapsed trial duration.

A separate temporary index reconstructed **297 manifests into 297 valid snapshots** and matched every captured timestamp, quality and customer/outage total at the cutoff. Repeating recovery returned 297 already-indexed records with no duplication. All indexed source bodies and saved parsers passed checksum/replay checks; all 290 pilot feed/HTML originals and normalized results matched their durable copies. Live history and collection remained intact. Evidence: ignored `reports/phase1-local-checkpoint.json`.

The collector directory used **7.200 MB**, including a **4.169 MB live WAL**, at this review. Together with the completed pilot's diagnostics, capture data used **16.586 MB**; weather and development files are separate. The [Phase 1 review](PHASE1_STATUS.md#observed-storage-and-revised-model) now includes retained HTML in capacity modeling. About 240.2 GB remained free on C:, well above the 20 GB floor. No automatic cleanup is enabled.

These results establish a successful local handoff and complete observed coverage so far, **not seven-day acceptance**. The existing trial is scheduled to finish September 23 at about 12:04 PM CDT; assess its full coverage and operating evidence then.

A final status check at **17:25:17 UTC** confirmed continued operation: **299 valid captures / 299 slots**, no gaps over ten minutes, healthy heartbeat/storage and zero queued rollup days. The latest capture was 17:25:10 UTC with 133 customers / 8 outages. The 297-capture replay evidence above retains its earlier fixed cutoff.

## Verification evidence

**34 automated tests passed at the original implementation checkpoint.** Coverage includes malformed and empty feeds, timezone/DST cases, duplicate attempts and slots, disk-write failure, simulated database-commit failure, recovery into a fresh database, checksum/parser tampering, overlapping leases, delayed runs, Retry-After, suspicious zero confirmation, stale-data thresholds and rollup gaps/hour/day boundaries. The latest suite counts are recorded in [current status](PROJECT_STATUS.md).

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

1. Observe the ongoing seven-day run and report real slot coverage, failures, gaps, disk growth and recovery behavior. Its 100% observed coverage at this checkpoint does not yet demonstrate the full seven-day target of 99% success and no unexplained gap over 15 minutes.
2. Carry forward the completed Phase 1 review's source timestamp/location corrections and revised HTML-inclusive storage model; retain provisional timezone/identity assumptions and measure further growth.
3. Once cloud account/free-plan access is available, validate the provider runtime and implement the selected cloud storage adapters, separate development/production resources, account quotas and deployment credentials.
4. The local transfer core and real-data restore rehearsal are implemented; provider-backed transfer installation and production cleanup remain Phase 4B work. The local read-only dashboard/API, weather controls and temporary password-protected tunnel are documented in the subsequent dashboard reports and current status.
