---
type: Checkpoint Report
title: "Local pilot closeout — September 24, 2026"
description: "September 24, 2026 offline verification of the stopped PC archive: 290/290 pilot slots, 1,722 restored attempts, 96.35% coverage and the unmet seven-day gate."
tags: [collection, pilot, recovery, coverage]
status: stable
generated: { by: "codex/unknown", at: 2026-09-24T17:21:16Z }
sources:
  - id: pilot-review
    resource: "../../reports/local-pilot-review-20260924.json"
    title: "September 24 local pilot review (local, ignored by Git)"
    last_modified: 2026-09-24T17:19:39Z
  - id: analyze-log
    resource: "../../reports/pilot-review-20260924-analyze.log"
    title: "Pilot analysis output (local, ignored by Git)"
    last_modified: 2026-09-24T17:16:34Z
  - id: status-log
    resource: "../../reports/pilot-review-20260924-status.log"
    title: "Collector status output (local, ignored by Git)"
    last_modified: 2026-09-24T17:16:36Z
---
# Local pilot closeout — September 24, 2026

Reviewed at **17:19:39 UTC / 12:19 PM CDT** after the old one-time follow-up triggered again. This review used the preserved PC archive only. Local collection had already stopped for cloud cutover on September 22; no collector, dashboard, weather download, deployment or cloud connection was started. The [deployment guide](../operations/digitalocean-deployment.md) remains authoritative for production operation. This is not a current cloud-health assessment.

## Completed source pilot

Reran `npm run analyze` against the unchanged September 16–17 pilot. Its **290/290 observed five-minute slots** remain valid across 24.036 hours, with no recorded failure, parser quality issue or gap over ten minutes. All 290 HTML/feed customer comparisons match.

- Adjacent pairs contain **197 meaningful changes**, 86 byte-only changes and six unchanged pairs. Five-minute polling cannot establish sub-five-minute publication frequency.
- The pilot contains **307 source IDs**. Eight IDs had revised start times; 27 had changed coordinates. No ID disappeared and reappeared during this pilot. These remain provisional identities and approximate reported locations, not confirmed unique incidents or service areas.
- All **290 pilot captures** are present in the durable archive. Their original feed and HTML bytes and saved normalized results match replay. The first direct collector capture remains September 17 at **16:45:01.288 UTC**, 301.085 seconds after the last pilot capture.

## Final retained local collection

`npm run collector:status` ran at **17:16:35 UTC**. The stopped PC archive contains **1,722 attempts: 1,635 valid snapshots and 87 failed attempts**. Those failures span 29 scheduled slots and record `fetch failed`, with no HTTP response status; this evidence does not establish whether the origin, network or PC caused them.

Valid coverage is **1,635 / 1,697 slots (96.35%) over the observed archive span**, which is 141.29 hours. This is neither seven-day coverage nor current cloud coverage. Two intervals between accepted captures exceed ten minutes:

| Interval, Central daylight time | Gap | Evidence |
| --- | ---: | --- |
| September 20, 1:05:03 PM to 3:35:22 PM | 150.31 minutes | Recorded failed fetch attempts |
| September 21, 8:00:30 PM to 10:52:20 PM | 171.84 minutes | Includes the owner's pause and later recorded resumption |

The last local capture is **September 22 at 8:55:09 AM CDT**, with **173 customers / 24 reported outages**. The run records `stopReason=cloud_cutover` and stopped at 8:56:33 AM CDT. The later resumption and changed local deadline were already saved before this review; neither was altered. There are no pending rollup days. Stale local freshness is expected for this stopped archive and says nothing about production freshness.

**The original seven-day reliability gate did not pass.** Local capture ended before seven days, and the observed 96.35% slot coverage and long gaps do not meet its 99%/no-unexplained-gap-over-15-minutes target. Retain these gaps; do not extend or restart the old trial to relabel it successful.

## Fresh offline replay and storage

Verified all **1,722 manifests**, their retained parser hashes and **3,270 referenced feed/HTML bodies**. All **1,635 accepted totals** replayed correctly. A new temporary database restored all 1,722 attempts and 1,635 snapshots, matching the existing attempt outcomes, snapshot identities, timestamps, hashes, quality and totals. Both database integrity checks returned `ok`; a second recovery found all 1,722 attempts already indexed without duplication. The saved local run-state bytes were unchanged.

The completed pilot uses **9.386 MB**, and the retained collector uses **58.755 MB**, or **68.141 MB combined**, excluding weather, backups, development artifacts and the isolated verification copy. Decimal units are used. Across successful retained local captures:

| Per-capture payload | Mean bytes | p95 bytes | Maximum bytes |
| --- | ---: | ---: | ---: |
| Original GeoJSON | 2,998 | 5,277 | 36,201 |
| Gzipped GeoJSON | 668 | 906 | 2,892 |
| Gzipped HTML evidence | 5,428 | 5,429 | 5,431 |

Gzipped feed plus HTML and the earlier provisional 4,096-byte metadata allowance extrapolate to **2.94 MB/day / 1.07 GB/year** at five-minute cadence. This sample-based estimate excludes weather, cloud backups, caches/staging, storm reserves and actual cloud index overhead. It is not a production capacity forecast. The earlier HTML-inclusive storm/reserve models remain separately documented in [Phase 1](phase-1-source-contract.md#observed-storage-and-revised-model).

Inspected the saved September 16 ordinary/4,000/10,000-feature benchmarks and byte-exact synthetic replay, and the September 18 602-capture restore report. Their timings and counts remain historical; no provider CPU or quota result is inferred from this local review. The old `cloudDeployment: deferred` and Phase 1 outstanding-gate fields emitted by the local scripts refer to their original implementation and do not override the documented DigitalOcean deployment.

The local dashboard at `127.0.0.1:4173` refused the connection; it was not started. Its UI/freshness could therefore not be checked live locally. No public or private cloud endpoint was contacted.

## Follow-up closed

The one-time `review-mlgw-phase-1-pilot` follow-up completed September 17 but was still active when it triggered September 24. Updated it through the app to **PAUSED** and verified the persisted state. The schedule and prompt were preserved; the cause of the repeat was not established. No replacement follow-up was created.

Evidence: ignored `reports/local-pilot-review-20260924.json`, `reports/pilot-review-20260924-analyze.log`, `reports/pilot-review-20260924-status.log` and helper `data/review-local-20260924.mjs`. Existing source history, local runtime state and cloud services were left intact.
