---
type: Design Section
title: "Cost and capacity estimates"
description: "Selected VM capacity plus the historical September 16 Cloudflare pricing comparison and storage scenarios."
tags: [design, cost, capacity]
status: stable
generated: { by: "codex/unknown", at: 2026-09-22T16:41:52Z }
verified: { by: "process:documentation-review", at: 2026-09-23T04:16:15Z }
sources:
  - id: workers-pricing
    resource: "https://developers.cloudflare.com/workers/platform/pricing/"
    title: "Cloudflare Workers pricing"
  - id: workers-limits
    resource: "https://developers.cloudflare.com/workers/platform/limits/"
    title: "Cloudflare Workers limits"
  - id: d1-pricing
    resource: "https://developers.cloudflare.com/d1/platform/pricing/"
    title: "Cloudflare D1 pricing"
  - id: d1-limits
    resource: "https://developers.cloudflare.com/d1/platform/limits/"
    title: "Cloudflare D1 limits"
  - id: r2-pricing
    resource: "https://developers.cloudflare.com/r2/pricing/"
    title: "Cloudflare R2 pricing"
---
# 9. Cost and capacity estimates

The selected DigitalOcean VM is $12/month for 1 CPU, 2 GB RAM and 50 GB disk, verified through the account API during deployment. About 44 GiB of disk remained free at the operating check. The collector uses a 20 GB budget and 5 GB free-space floor; weather has a separate shared 1 GiB cap. Paid provider backups and extra storage products are not enabled. See the deployment guide for measured memory use and limits.

## Historical Cloudflare comparison — September 16

Prices below were checked against provider documentation on September 16, 2026. Allowances are shared with other applications in the account and may change.

| Service | Relevant allowance or price |
| --- | --- |
| Workers Free | 100,000 requests/day; 10 ms CPU per invocation, including scheduled invocations |
| Workers Paid, comparison only | $5/month minimum; a cron running more often than hourly has a 30-second CPU limit; not selected under the free-first preference |
| D1 Free | 5 million rows read/day; 100,000 rows written/day; 5 GB account storage, but only **500 MB per database** |
| R2 Standard | 10 GB-month storage, 1 million Class A operations/month, and 10 million Class B operations/month included; additional storage $0.015/GB-month; no egress charge |

Sources: [Workers pricing](https://developers.cloudflare.com/workers/platform/pricing/), [CPU limits](https://developers.cloudflare.com/workers/platform/limits/), [D1 pricing](https://developers.cloudflare.com/d1/platform/pricing/), [D1 size limits](https://developers.cloudflare.com/d1/platform/limits/), [R2 pricing](https://developers.cloudflare.com/r2/pricing/).

CPU is the key free-tier risk: parsing, hashing, normalization, compression, and serialization count; waiting for network I/O does not. Reducing polling frequency does not solve a per-invocation CPU overrun. Test ordinary current-format payloads, roughly 4,000 features based on the legacy outage peak, and 10,000 features for headroom on the deployed runtime. Customer totals of 117,861 do not imply 117,861 separate features. A free pilot must retain meaningful headroom below the limit rather than depending on occasional tolerated overruns.

At five-minute collection, even six R2 writes per poll are only 51,840 writes per 30-day month before maintenance. A design using at most 20 billed D1 writes per poll would consume about 5,760/day. Measure actual `rows_written`, including index maintenance and cleanup; a database batch does not turn many changed rows into one billed write. Viewer queries and rollups also consume resources.

Storage sizing should use **combined bytes per poll**, including raw data, normalized data, manifests, and attributable rollups. The following are scenarios, not measurements; decimal KB/GB are used, with no assumed compression or deduplication savings.

| Combined archived bytes/poll | One year at 5 minutes | One year at 1 minute | Approx. monthly R2 storage charge at that retained volume: 5 min / 1 min |
| --- | ---: | ---: | ---: |
| 25 KB | 2.63 GB | 13.14 GB | $0 / $0.06 |
| 100 KB | 10.51 GB | 52.56 GB | $0.02 / $0.65 |
| 1 MB | 105.12 GB | 525.60 GB | $1.44 / $7.74 |

Formula: `annual_GB = bytes_per_poll * polls_per_year / 1,000,000,000`. Storage charges apply to the monthly stored volume above the included allowance, with provider rounding. The table describes the volume after a year; the first year grows gradually. Cloud retention beyond a year grows until older detail is offloaded. Request overages, taxes, domains, paid compute, and optional services are excluded. R2 operations for bundle staging, verification reads, and desktop downloads must also be counted, although R2 egress itself is free.

For illustration, a 10 GB free allowance with 2 GB reserved leaves a protected-year budget of **about 76 KB per five-minute observation**, including compressed raw/normalized data and its share of metadata/rollups. At one-minute polling that falls to about **15 KB**. The actual reserve must cover at least 30 days of projected incoming data, storm scenarios, transfer staging, and cleanup grace; do not assume 2 GB automatically meets that requirement. Other account storage reduces both budgets. The old 3.71 KB mean compressed pair is encouraging, but cannot establish either new-feed target: map format, storm exposure, capture frequency, and normalization differ. Measure new-format compression and duplication during the pilot, and include a multi-day 4,000-feature storm in the annual-growth model.

R2 requires a subscription checkout and bills usage above its allowance; “free tier” is not a hard spending cap. [R2 setup](https://developers.cloudflare.com/r2/get-started/)

Set usage alerts at 70% and 90%, bound public queries/exports, shorten diagnostic-log retention, and review storage growth after the pilot. Cache immutable history and recent series to protect the shared free API/database quotas, and enforce public request budgets so unexpected traffic cannot consume ingestion capacity unchecked. Prefer reducing viewer/maintenance load before collection. A free-first target is not a provider spending cap: keep R2's usage-based billing visible and trigger the desktop process early. Do not silently drop history or downgrade to intervals longer than 15 minutes.

The outage-only estimates above do **not** include weather imagery, numeric grids, historical backfill, raster decoding or analysis. Phase 3A measures those separately using selected local areas/periods; do not assume weather fits inside the existing cloud allowance. Serve cached/precomputed results to viewers and isolate weather work from the five-minute outage collector. No paid weather subscription or additional cloud commitment is selected by this plan.
