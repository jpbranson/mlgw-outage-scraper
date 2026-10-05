---
type: Guide
title: "Cloud runtime probe (deferred Cloudflare alternative)"
description: "Prepared but undeployed Cloudflare Worker/Durable Object benchmark procedure and acceptance thresholds, superseded by the selected VM."
tags: [operations, cloudflare, benchmark, alternative]
status: deprecated
generated: { by: "codex/unknown", at: 2026-09-17T12:38:31Z }
verified: { by: "process:documentation-review", at: 2026-09-23T04:16:15Z }
sources:
  - id: wrangler
    resource: "../../wrangler.benchmark.jsonc"
    title: "Benchmark Worker configuration"
    last_modified: 2026-09-16T16:42:12Z
  - id: worker
    resource: "../../workers/benchmark.mjs"
    title: "Benchmark Worker"
    last_modified: 2026-09-16T16:42:11Z
---
# Cloud runtime probe (deferred; prepared, not deployed)

`wrangler.benchmark.jsonc` defines an authenticated benchmark Worker with a SQLite-backed Durable Object alternative. It has no cron or production storage and performs no external source fetching. Account authentication and a verified free plan are needed before deploying this Phase 1 test. R2 is not provisioned automatically.

1. With Cloudflare connected, deploy the probe using the benchmark config and set `BENCHMARK_TOKEN` as a Worker secret. Never put credentials in tracked files or chat.
2. Send the generated ordinary, 4,000-feature and 10,000-feature fixture bodies via authenticated POST to `/worker` and `/durable-object`, both with and without `?compression=gzip`.
3. Collect platform invocation CPU metrics, cold and warm runs, p50/p95/max, failures and memory pressure. Worker elapsed timers must not be used as CPU measurements. Use at least 20 invocations per case/path/mode. Record both the forwarding Worker and Durable Object metrics.
4. For archive-cost validation, add a private temporary R2 binding named `BENCHMARK_ARCHIVE` only after the account's R2/free-budget status is known. The probe records raw bodies before parsing and writes normalized results. It deliberately preserves both uncompressed and compressed raw bodies during compression tests; that extra diagnostic copy is not included in the production storage model. Inventory the `phase1/` objects and record their bytes and request counts.
5. For a standard free Worker, require p95 CPU below 7 ms, no invocation over 10 ms, and no resource failures on all supported inputs. For the Durable Object candidate, use a conservative initial p95 target below 1 second, zero resource failures, forwarding Worker p95 below 7 ms, and measured total daily active duration below 70% of the available allowance. Include network/archive time in Durable Object duration budgeting.
6. Remove the temporary benchmark deployment/storage only after retaining the measurements. Do not launch a production cloud collector from this probe; the separately authorized local Phase 2 trial can continue.

The probe's Node smoke tests exercise transforms, authentication and archive ordering. They do not emulate Cloudflare resource limits or establish that its deployment config is accepted by Wrangler. Those checks remain pending account/runtime access.
