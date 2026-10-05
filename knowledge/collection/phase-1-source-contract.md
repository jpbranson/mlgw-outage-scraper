---
type: Checkpoint Report
title: "Phase 1 checkpoint: source contract and free-hosting feasibility"
description: "September 16–17, 2026 source contract, 24-hour pilot review, local benchmarks and storage-feasibility evidence."
tags: [collection, source-contract, pilot, benchmark, storage]
status: stable
generated: { by: "codex/unknown", at: 2026-09-24T17:21:18Z }
verified: { by: "process:documentation-review", at: 2026-09-23T04:16:15Z }
sources:
  - id: pilot-summary
    resource: "../../reports/pilot-summary.json"
    title: "Pilot analysis summary (local, ignored by Git)"
    last_modified: 2026-09-24T17:16:34Z
  - id: phase1-checkpoint
    resource: "../../reports/phase1-local-checkpoint.json"
    title: "Phase 1 local checkpoint (local, ignored by Git)"
    last_modified: 2026-09-17T22:00:38Z
  - id: benchmark
    resource: "../../reports/benchmark.json"
    title: "Ordinary/4,000/10,000-feature benchmark (local, ignored by Git)"
    last_modified: 2026-09-16T16:37:56Z
  - id: storage-alternative
    resource: "../../reports/storage-alternative.json"
    title: "Compressed-original storage alternative (local, ignored by Git)"
    last_modified: 2026-09-16T16:46:07Z
  - id: mlgw-feed
    resource: "https://outagemap.mlgw.org/geojson.php"
    title: "MLGW outage GeoJSON feed"
  - id: mlgw-map
    resource: "https://outagemap.mlgw.org/OutageSummary.php"
    title: "MLGW outage map page"
  - id: mlgw-map-description
    resource: "https://www.mlgw.com/outagemap/"
    title: "MLGW outage map description"
  - id: mlgw-privacy
    resource: "https://www.mlgw.com/privacypolicy"
    title: "MLGW privacy policy"
  - id: workers-limits
    resource: "https://developers.cloudflare.com/workers/platform/limits/"
    title: "Cloudflare Workers limits"
  - id: do-limits
    resource: "https://developers.cloudflare.com/durable-objects/platform/limits/"
    title: "Cloudflare Durable Objects limits"
  - id: r2-pricing
    resource: "https://developers.cloudflare.com/r2/pricing/"
    title: "Cloudflare R2 pricing"
  - id: lambda-pricing
    resource: "https://aws.amazon.com/lambda/pricing/"
    title: "AWS Lambda pricing"
---
# Phase 1 checkpoint: source contract and free-hosting feasibility

**September 24 local recheck:** the preserved source pilot still passes with 290/290 valid slots, 197 meaningful changes and matching HTML totals throughout. All pilot originals and normalized results matched replay again. See [local pilot closeout](local-pilot-closeout.md) for the final PC archive, gaps, storage and fresh 1,722-attempt restore. The unexpectedly repeated one-time follow-up is now paused; current cloud operation was not inspected or changed.

**September 22 deployment update:** the [DigitalOcean deployment guide](../operations/digitalocean-deployment.md) is authoritative for current operation. The VM now serves the dashboard and runs both collectors; local collectors are stopped. Runtime counts, preview sessions, trial deadlines and hosting gates below describe this earlier checkpoint. Its scientific findings and dated validation results are preserved.

Source/feasibility checkpoint recorded September 16, 2026; the scheduled local review completed September 17 at approximately 12:20 PM CDT. **The 24-hour local observation gate passed; the full Phase 1 exit gate has not passed.** The source pilot completed, and the seven-day collector continues. Production cloud resources and provider-runtime validation remain pending account setup. See [current project status](../project-status.md) for the latest preview session and [subsequent local development](../weather/autonomous-continuation.md), including the acceptance command and transfer rehearsal. Original benchmark tables and local findings below retain their measurement dates.

**Validation scope, confirmed by the user September 16:** the public-feed observation pilot, local parser/replay tests, storm benchmarks and storage modeling were authorized and completed locally. Permanent cloud account setup/deployment and provider-runtime tests remain deferred. The separately requested temporary Quick Tunnel did not establish provider CPU/storage feasibility. The completed source review below reports the local results and remaining cloud evidence.

The user's subsequent request authorized local Phase 2 implementation while the pilot was running. The pilot has now completed and handed off to the seven-day collector; see [PHASE2_STATUS.md](phase-2-durable-collection.md). This does not change the cloud deferral or mark the full Phase 1 gate accepted.

## Work completed

- Saved a live GeoJSON fixture, map HTML, response metadata and outage-host `robots.txt` response. Both data endpoints returned HTTP 200; robots returned 404.
- Implemented a dependency-free Node pilot at five-minute cadence, raw-body preservation, bounded requests, separate retrieval times, backoff, source-restriction handling, and diagnostic reports.
- Implemented explicit validation of source IDs/counts, geometry/schema flags, missing/ambiguous dates and meaningful changes that ignore duration-only changes and sequential feature IDs.
- Tested empty/malformed collections, missing fields, invalid and duplicate IDs, invalid counts and geometry, DST cases, HTML comparisons, response ceilings, Retry-After and archival-before-parsing behavior.
- Measured ordinary and varied synthetic 4,000/10,000-feature payloads. Prepared an authenticated cloud probe to compare ordinary Workers with the free SQLite-backed Durable Object option.

## Current source contract

Initial reference retrieval: **2026-09-16 16:30:49 UTC / 11:30:49 AM Central**. The response contained **16 features and 278 affected customers**. The separately fetched HTML summary also showed **278**, with page text “current as of” 11:30 AM. Later captures must be evaluated independently.

| Field | Observed contract / handling |
| --- | --- |
| Envelope | GeoJSON FeatureCollection; an empty features array is a valid zero candidate, not evidence of successful recovery on its own |
| `OUTAGE_NO` | Numeric in this fixture; normalize to string, reject unsafe numeric IDs and duplicate IDs for totals |
| `CUR_CUST_AFF` | Nonnegative integer; reject numeric strings and invalid values instead of silently coercing them |
| `TIME_STAMP` | Map labels it as the start time; format `MM/DD/YYYY hh:mm:ss AM/PM`, no explicit timezone |
| `EST_REPAIR_TIME` | Same format or empty; empty means unavailable |
| Timezone | America/Chicago is an explicit, plausible assumption, not a documented feed guarantee; validate daylight/standard cases and retain ambiguous fall-back times unresolved |
| `DURATION` | Human-readable text; exclude duration-only changes from event-change counts |
| `STATUS`, `IMPACT` | Source descriptions; preserve without interpreting status as exact restoration proof |
| `OUT_CAUSE` | Includes blanks and some maintenance/construction text; keep original privately, exclude from normalized public fields |
| Geometry | Point with longitude then latitude; preserve source precision. The sample generally has 4–5 decimal places, which does not establish location accuracy |
| Feature `id` | Sequential within the response; unsuitable for cross-capture identity |
| HTTP/source freshness | No ETag, Last-Modified or feed publication timestamp observed. HTTP Date is retrieval metadata, not a source publication time |
| HTML check | Desktop/mobile affected-customer totals must agree. The inspected page does not expose a separate outage-event total. HTML and feed are not atomic |

Matching customer sums support consistency for a capture pair but cannot establish complete coverage of real outages. ID reuse and reappearance need the pilot and longer observation; a quiet-day pilot cannot prove storm completeness. The map's 900-second refresh is a browser timer, not proof of the feed publication schedule. Five-minute polling cannot determine changes that happen entirely between polls.

Reviewed the public [map description](https://www.mlgw.com/outagemap/), [live map](https://outagemap.mlgw.org/OutageSummary.php), [feed](https://outagemap.mlgw.org/geojson.php), and linked [privacy policy](https://www.mlgw.com/privacypolicy). No machine-collection guidance or explicit reuse license was located in those pages or the targeted search; the privacy policy concerns information MLGW collects from visitors. This is a limited source-guidance check, not a legal conclusion. The pilot identifies itself with a User-Agent linked to the user's existing public GitHub profile, makes at most two scheduled requests per five minutes, and stops on access restrictions. It does not access customer accounts.

## Pilot and follow-up

The pilot started **September 16 at 11:37:51 AM CDT** and completed with its final observation at **September 17 at 11:40 AM CDT**, after the planned 24-hour boundary. Its first capture succeeded with matching feed/HTML totals and no validation flags. It ran on this PC without power-setting changes; the separate collector still depends on the PC staying awake and connected. Completed pilot evidence and state remain under `data/pilot/`; `npm run analyze` rechecks that preserved window.

The one-time **September 17 at 12:15 PM CDT** review (`review-mlgw-phase-1-pilot`) ran and produced the findings below. It reviewed the saved source observations, Phase 2 handoff and local dashboard without starting another implementation stage. The existing automation has one occurrence; no further review was scheduled here.

## Completed 24-hour local review — September 17

**Requested revalidation at 22:00 UTC:** the completed pilot again passed with 290/290 valid observations, no failures, no parser quality issues and all HTML totals matching. All 290 pilot originals/normalized results were verified again; the combined archive now had 354/354 captures replayed and restored successfully in an isolated database. The earlier scheduled-review figures below retain their original cutoff. See [storage and pilot revalidation](../weather/storage-and-pilot-revalidation.md) for the new evidence.

`npm run analyze` ran at **17:15:49 UTC / 12:15:49 PM CDT**. The pilot stopped after its final capture at **16:40:00.203 UTC / 11:40 AM CDT**, with `completedAt` recorded at 16:40:00.293 UTC. The observation span began September 16 at 16:37:51.973 UTC: **24 hours, 2 minutes, 8.230 seconds**. There are 290 slots rather than 288 because the initial observation was partway through a five-minute slot and the final observation was at/after the 24-hour boundary.

| Check | Measured result |
| --- | --- |
| Valid observations / expected slots in observed span | **290 / 290 (100%)**, with no recorded failures or parser quality issues |
| Observation spacing | Mean 299.406 seconds; p95 300.036 seconds; maximum 301.014 seconds; no gap over ten minutes |
| Adjacent feed comparisons | 197 meaningful changes, 86 byte-only changes excluded by the meaningful-state definition, six unchanged pairs |
| HTML consistency | **290 / 290 affected-customer totals match**; feed/HTML receipt times were at most 156 ms apart |
| Affected customers | Median 106, p95 814, maximum **6,256** at September 16 19:15 UTC / 2:15 PM CDT, with 21 reported outages in that capture |
| Reported outage features | Median 8, p95 15, maximum **112**; this is a separate peak from the customer maximum |
| Empty observations | Two valid zero captures, September 17 11:45 and 11:50 UTC, both supported by HTML zero |
| Source IDs | 307 distinct IDs; no observed disappearance/reappearance of an ID during this pilot |

Five-minute polling captured meaningful changes in about 68% of adjacent pairs. This supports retaining the provisional cadence, but does not establish the source's publication interval or recover events entirely between polls. HTML equality is a consistency check between non-atomic requests, not proof of completeness on the electrical network.

**Identity is not stable in every field.** Eight existing IDs received earlier start times together at September 17 06:10 UTC / 1:10 AM CDT; changes ranged from 10 to 295 seconds. There were also 30 coordinate edits across 27 IDs, with observed displacement about 19 m to 1.58 km. Overall, 34 IDs had a changed start or location. Preserve those edits as source evidence: provisional ID/start pairs can split one continuing report, and movement does not prove a new outage or affected service area. All 2,509 repeated feature observations parsed under the explicit Central-time assumption, with no future start times, but this one-day September sample does not validate winter/DST behavior or prove the timezone contract. The earlier offline DST tests remain relevant.

### Archive replay and collector handoff

At the fixed **17:15:01.965 UTC** capture cutoff, all **290 pilot records were present in the durable archive**, followed by seven direct collector captures. The first direct capture arrived at **16:45:01.288 UTC**, 301.085 seconds after the last pilot capture. There were **297 valid snapshots / 297 expected slots**, no duplicate slots and no gap over ten minutes. The collector kept its original September 16–23 window; see [Phase 2](phase-2-durable-collection.md).

Local verification checked the manifest/parser hashes and decompressed feed/HTML checksums for all 297 indexed captures. Each pilot original and saved normalized result matched its durable replay byte-for-byte or structurally, respectively. A new temporary database reconstructed all **297 snapshots**, matched their timestamps, quality and totals, and drained all rollup work. Repeating recovery returned **297 already indexed records** without duplicating them. The live index/history were not rebuilt or modified by that restore. This is local archive evidence, not a provider-runtime test.

### Observed storage and revised model

All values below use decimal MB/GB. Per-capture feed measurements over the completed pilot:

| Payload | Mean | p95 | Maximum |
| --- | ---: | ---: | ---: |
| Original GeoJSON | 3,071 bytes | 5,520 bytes | 36,201 bytes |
| Gzipped GeoJSON | 669 bytes | 943 bytes | 2,892 bytes |
| Gzipped GeoJSON + normalized result + provisional 4,096-byte metadata allowance | 5,545 bytes | 6,183 bytes | 10,371 bytes |
| Gzipped HTML evidence, separately | 5,428 bytes | 5,429 bytes | 5,431 bytes |

At **17:19:54 UTC**, the completed pilot directory occupied **9.386 MB**, and the collector occupied **7.200 MB**: **16.586 MB combined**, including diagnostics and SQLite journals. The collector's canonical objects were 1.807 MB (0.195 MB feed, 1.612 MB HTML); manifests used 0.611 MB, the main SQLite file 0.356 MB, and its live WAL 4.169 MB. Weather, benchmarks/fixtures, reports, builds and runtime tools are excluded. C: had about **240.2 GB free**. Startup/journal overhead means this directory total is not a measured ongoing daily growth rate.

At the pilot's average payload and five-minute cadence, gzip feed bodies alone project to **0.193 MB/day / 70.3 MB/year**; adding the provisional 4,096-byte metadata allowance gives **1.372 MB/day / 0.501 GB/year**, before HTML, storm reserves, caches, staging and weather. These extrapolations describe this sample, not an annual storm forecast.

Replacing the earlier single ordinary fixture with the measured mean yields these revised compressed-original scenarios. They retain seven synthetic storm days in the protected year, 30 storm days offline, seven days each of transfer staging and cleanup grace, 48 storm hours of normalized cache, 24 storm hours of raw staging, and 50 MB for parser artifacts:

| Synthetic storm size | Revised feed/metadata/cache/staging model | Including retained HTML and its raw staging |
| --- | ---: | ---: |
| 4,000 features | 2.546 GB | **3.191 GB** |
| 10,000 features | 5.443 GB | **6.088 GB** |

**The earlier model omitted retained HTML evidence.** The added allowance uses its observed 5,428-byte compressed mean for all 409 modeled days, plus 24 hours of uncompressed HTML staging (about 5.64 MB). The 4,096-byte metadata allowance does not cover that HTML. Storm HTML sizes, cloud index growth and actual account capacity remain unverified; weather is separate. This supersedes treating the earlier 2.58/5.47 GB estimates as a complete archive budget. No paid service, retention policy, cadence or runtime was changed.

Evidence: ignored `reports/pilot-summary.json` and `reports/phase1-local-checkpoint.json`; the latter records the fixed cutoff, source-field edits, storage calculations, restore directory and dashboard API checks. The local audit helper is retained at ignored `data/phase1-local-checkpoint.mjs`; running it again creates a new temporary restore and overwrites the JSON with a new cutoff. The September 16 ordinary/4,000/10,000-feature benchmark and byte-exact synthetic replay files were inspected, not relabeled as new measurements.

## Measured payloads and local processing

Node v24.19.0 on Windows. Twenty warm samples per size/mode, with the first iteration recorded separately in `reports/benchmark.json`. Processing includes parse/validation, timezone conversion, normalized serialization, meaningful-state comparison and SHA-256; compression mode adds gzip level 6 for raw and normalized payloads. Synthetic fixtures vary IDs, timestamps, coordinates and customer counts rather than cloning one identical record.

| Input | Raw bytes | Raw gzip bytes | Normalized gzip bytes | Median local CPU, no gzip / gzip | p95 local CPU, no gzip / gzip |
| --- | ---: | ---: | ---: | ---: | ---: |
| Ordinary, 16 features | 5,896 | 969 | 1,158 | below timer resolution / below timer resolution | 16 ms / below timer resolution |
| Synthetic 4,000 features | 1,386,237 | 99,581 | 143,366 | 140 / 156 ms | 204 / 218 ms |
| Synthetic 10,000 features | 3,467,248 | 247,620 | 357,132 | 313 / 375 ms | 376 / 453 ms |

Windows process CPU has coarse granularity; a recorded zero is not zero CPU cost. **These are not Cloudflare measurements.** Local timings show a material risk for the current full parser under the ordinary Worker free limit of 10 ms, including cron. Polling less often would not reduce per-invocation CPU. No free-Worker acceptance claim is made. [Worker limits](https://developers.cloudflare.com/workers/platform/limits/)

The next free compute candidate is a **SQLite-backed Durable Object**, invoked by a small scheduling Worker, with R2/D1 still holding archive/summary data. Cloudflare documents availability on its free plan, a 30-second default CPU budget per Durable Object request, 100,000 requests/day and 13,000 GB-seconds/day. The forwarding Worker retains its ordinary CPU limit. A provisional budget of 288 calls/day at 10 active seconds and 0.128 GB is 368.64 GB-seconds/day before other account use; this is a scenario, not measured usage. Avoid persistent timers/connections that prevent inactivity. Test platform CPU, active duration, memory and archive writes before selecting it. [Durable Object limits](https://developers.cloudflare.com/durable-objects/platform/limits/), [pricing](https://developers.cloudflare.com/durable-objects/platform/pricing/)

AWS Lambda is a secondary candidate: its published free allowance includes one million requests and 400,000 GB-seconds/month. Account eligibility, scheduling, logs, networking and storage must be budgeted separately; it has not been deployed or accepted here. [Lambda pricing](https://aws.amazon.com/lambda/pricing/)

## Storage model and cadence

Provisional model: 358 ordinary days plus 7 days at the selected storm size; additionally, **30 full storm days offline**, **7 storm days of transfer staging** and **7 storm days of cleanup grace**. This deliberately stresses the offline allowance. Add 4,096 bytes per capture for metadata/manifests/attributable rollups. No deduplication savings. D1 size and other account usage are separate checks. Synthetic compression and one ordinary fixture are insufficient to establish observed annual growth.

| Archive strategy / cadence | Storm size | Protected year | Offline + staging + grace | Total modeled R2 bytes | Assessment |
| --- | ---: | ---: | ---: | ---: | --- |
| Raw + normalized, uncompressed / 5 min | 4,000 | 8.95 GB | 44.30 GB | 53.25 GB | Does not fit |
| Raw + normalized, gzip / 5 min | 4,000 | 1.14 GB | 3.13 GB | 4.27 GB | Promising, needs pilot/account checks |
| Raw + normalized, gzip / 5 min | 10,000 | 1.87 GB | 7.72 GB | 9.58 GB | Too close to 10 GB to accept with headroom |
| Raw + normalized, gzip / 1 min | 4,000 | 5.70 GB | 15.65 GB | 21.35 GB | Does not fit |
| Raw + normalized, gzip / 1 min | 10,000 | 9.35 GB | 38.58 GB | 47.92 GB | Does not fit |

The R2 Standard free allowance is 10 GB-month, shared with other account use. Keep **five-minute collection** as the provisional cadence. Compression is necessary under this model; the uncompressed approach is not accepted. [R2 pricing](https://developers.cloudflare.com/r2/pricing/)

### Revised archive candidate: preserve compressed originals, bound derived data

Measured a leaner alternative in `reports/storage-alternative.json`: retain every original response as gzip, retain its uncompressed-body hash and parser version, and cache normalized maps for only 48 hours. A historical map can be regenerated from the canonical raw body using its retained parser. The local replay check passes for all three fixture sizes: decompressed bytes and regenerated normalized features match exactly. This preserves original spatial detail without keeping a second permanent representation.

The model still includes the protected year, 30 full storm days offline, seven days each of transfer staging and cleanup grace, and 4,096 bytes/capture of metadata. It additionally reserves 24 storm hours of uncompressed raw staging, 48 storm hours of normalized cache, and 50 MB for parser artifacts. Uncompressed staging duplicates may be removed only after compressed-body hash verification and indexing; the original observation remains in the protected compressed archive. A stalled compressor must be detected before its staging allowance is exhausted.

| Cadence | Storm size | Revised total | Assessment against unused 10 GB allowance |
| --- | ---: | ---: | --- |
| 5 minutes | 4,000 | 2.58 GB | Below the provisional 70% budget threshold |
| 5 minutes | 10,000 | 5.47 GB | Below the provisional 70% budget threshold |
| 1 minute | 4,000 | 12.68 GB | Does not fit |
| 1 minute | 10,000 | 27.17 GB | Does not fit |

**Provisional selection:** five-minute collection, compressed original history, a 48-hour normalized cache, and the Durable Object compute candidate. Cloud runtime/replay, account capacity and actual metadata growth remain unverified; these local results do not pass the full Phase 1 gate. Historical map reads will consume normalization compute and should be cached and rate-limited. Parser artifacts and immutable hashes become required archive metadata.

Selected local pilot/evidence location: `C:\Developer\mlgw-outage-scraper\data`. The C: drive had approximately **237.9 GB free** at inspection; D: had about **650.4 GB free**. Use `C:\Developer\mlgw-outage-scraper\archive` as the provisional future archive directory, with a 20 GB free-space floor and a capacity recheck at installation. No archive transfer task has been installed. Free disk space now does not guarantee indefinite local retention; capacity monitoring remains necessary.

## Remaining local validation

The scheduled 24-hour review, observed-distribution storage update and real-archive replay are complete. Continue the already running seven-day trial and assess longer-run coverage, storage growth and source-field edits. Retain uncertainty around publication cadence, ID/start corrections, approximate coordinates, timezone guarantees and large-storm completeness. The dashboard and weather checkpoints were implemented under separate requests; this review starts no additional implementation phase.

## Deferred cloud gates

These remain necessary for the original full Phase 1 hosting acceptance, but are outside the current local-only scope:

- Verify the selected account's free plan, storage availability and remaining allowances.
- Measure deployed Worker/Durable Object CPU, memory, archive processing and replay on ordinary/4,000/10,000 inputs. The prepared probe currently has Node smoke-test coverage only.
- Measure actual cloud metadata/index overhead and confirm the final storage budget. Local benchmarks cannot establish provider CPU or quota compliance.
