# Phase 1 checkpoint: source contract and free-hosting feasibility

Updated September 16, 2026. **In progress; the Phase 1 exit gate has not passed.** A 24-hour local pilot is running. Cloud deployment has not occurred, and there are no configured Cloudflare credentials on this PC. No paid services or production resources were created.

**Current scope, confirmed by the user September 16:** keep validation local for now. Continue the existing public-feed observation pilot, local parser/replay tests, storm benchmarks and storage modeling. Cloud account setup, deployment and provider-runtime tests are deferred until the user asks to resume them. The next check-in should report the local results and identify deferred cloud evidence without requesting an account connection again.

The user's subsequent request to proceed with the next step authorized local Phase 2 implementation while this pilot continues. See [PHASE2_STATUS.md](PHASE2_STATUS.md). This does not change the cloud deferral or mark Phase 1 accepted.

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

The pilot started **September 16 at 11:37:51 AM Central** and is scheduled to take its last observation on/after **September 17 at 11:37:51 AM**, normally the 11:40 slot. Its first capture succeeded with matching feed/HTML totals and no validation flags. It runs on this PC, so sleep/shutdown or network loss can leave gaps. Power settings have not been changed. Raw evidence and state are under `data/pilot/`; run `npm run analyze` for current coverage.

A one-time review in this conversation is scheduled for **September 17 at 12:15 PM Central** (automation `review-mlgw-phase-1-pilot`). The computer and Codex app must be running for that local review. See [the scheduled-task documentation](https://learn.chatgpt.com/docs/automations?surface=app). It will review the Phase 1 observations and the now-authorized local Phase 2 trial, then check back without advancing to Phase 3 or cloud deployment.

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

1. Finish at least 24 hours of observations at five-minute resolution; evaluate actual gaps, meaningful changes, ID behavior, timezone consistency and HTML discrepancies.
2. Replace quiet-day assumptions with pilot size distributions, check local replay and refine the storage/headroom estimate.
3. Report local findings, remaining source uncertainty and provisional runtime/cadence choices alongside the authorized local Phase 2 trial; check back before advancing to the dashboard or cloud deployment.

## Deferred cloud gates

These remain necessary for the original full Phase 1 hosting acceptance, but are outside the current local-only scope:

- Verify the selected account's free plan, storage availability and remaining allowances.
- Measure deployed Worker/Durable Object CPU, memory, archive processing and replay on ordinary/4,000/10,000 inputs. The prepared probe currently has Node smoke-test coverage only.
- Measure actual cloud metadata/index overhead and confirm the final storage budget. Local benchmarks cannot establish provider CPU or quota compliance.
