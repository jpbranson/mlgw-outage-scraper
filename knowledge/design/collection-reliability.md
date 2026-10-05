---
type: Design Section
title: "Collection frequency and reliability"
description: "Polling cadence trade-offs and the deployed collection attempt, retry, lease and freshness rules."
tags: [design, collection, reliability]
status: stable
generated: { by: "codex/unknown", at: 2026-09-22T16:41:52Z }
verified: { by: "process:documentation-review", at: 2026-09-23T04:16:15Z }
---
# 3. Collection frequency and reliability

Five minutes remains the provisional cadence: finer than the requested 15-minute resolution and 288 feed requests per day, plus the separately retrieved HTML checks. The [completed 24-hour pilot](../collection/phase-1-source-contract.md) measured byte/meaningful changes and response spacing; it supports this cadence without proving the source publication interval or storm completeness. The local trial and continuing cloud observations supply longer operating evidence; the stopped local trial has not been accepted as a completed seven-day run.

| Poll interval | Polls/day | Polls/30-day month | Polls/365-day year |
| --- | ---: | ---: | ---: |
| 15 minutes | 96 | 2,880 | 35,040 |
| 5 minutes | 288 | 8,640 | 105,120 |
| 1 minute | 1,440 | 43,200 | 525,600 |

The deployed `mlgw-collector` systemd service runs `scripts/production-collector.mjs`, checks every 30 seconds and captures the next due UTC five-minute slot. Persistent next-due/backoff state and the SQLite lease prevent duplicate publication. The browser does not drive collection. The production configuration currently requires five-minute polling; a one-minute mode would need implementation and validation.

If source changes occur more frequently than five minutes, consider fixed one-minute polling after checking resource use and source guidance. An optional later mode can poll every minute during elevated activity and every five minutes otherwise; a future durable next-due policy could select the interval without changing the service schedule.

Polling resolution and information freshness are different. A five-minute collector can repeatedly receive the same source state; faster polling cannot expose changes that MLGW has not published. Outages that begin and end between observations may never be captured.

## Deployed cloud collection attempt

These steps describe the deployed filesystem/SQLite collector. The [deployment guide](../operations/digitalocean-deployment.md) records Linux execution, real archive recovery and the service lifecycle; [Phase 2](../collection/phase-2-durable-collection.md) preserves the original local implementation evidence.

1. Assign an attempt ID and a UTC scheduled-slot ID. Record actual request and response times separately.
2. Fetch the allowlisted GeoJSON URL with a 15-second timeout and a configurable response-size ceiling. Use conditional headers if the source later supplies validators.
3. Preserve the received body and selected response metadata before parsing/normalization. Production retains a byte-exact gzip original and its uncompressed-body hash; redundant staging is removed only after verified archival/indexing. Compression, replay and restore were exercised in Linux and on the VM.
4. Validate the collection, required identifiers, nonnegative integer customer counts, timestamp parsing, and geometry. Preserve unknown fields in the private raw archive. Flag out-of-area coordinates for review rather than silently losing those outages.
5. Produce a normalized snapshot, totals, and comparisons with the previous valid observation. Store timestamps, validation results, and parser version.
6. Write immutable archive objects and manifests first. Commit the SQLite snapshot reference and summaries together only after those objects exist. Advance the latest pointer only if this capture is newer than the current one.
7. Update the cached dashboard result. Record failures without converting them into zero outages.

Use a short expiring lease to prevent overlapping collectors. Make slot publication idempotent, keep retry attempts as separate records, and tolerate archived objects awaiting indexing after a failed database commit. Retrying publication must not double-count a snapshot. A recovery pass can find archived but unprocessed captures and process them later with their original observation times.

Retry transient network/5xx failures at most twice with jitter inside a bounded run. Honor `Retry-After` for 429 responses, even if that means skipping scheduled slots. A delayed run captures the current state at its actual retrieval time; it must never pretend to backfill the earlier scheduled instant.

Track two independent health measures: **last successful retrieval** and **evidence of source freshness**. Identical content alone is not evidence of failure. With no reliable source timestamp, show “retrieved at” and “source update time unavailable.” Flag collection gaps above 10 minutes and display a clear stale-data banner at 15 minutes. Use an independent heartbeat check so a stopped scheduler can be detected.
