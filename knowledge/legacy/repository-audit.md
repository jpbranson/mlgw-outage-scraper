---
type: Audit Report
title: "Legacy history: repository overlap and staging audit"
description: "September 17, 2026 cross-repository overlap, pinned originals, deduplicated staging and independent source-row checks."
tags: [legacy, audit, staging]
status: stable
generated: { by: "codex/unknown", at: 2026-09-22T16:41:52Z }
verified: { by: "process:documentation-review", at: 2026-09-23T04:16:15Z }
sources:
  - id: legacy-inventory
    resource: "../../reports/legacy-inventory.json"
    title: "Legacy repository inventory (local, ignored by Git)"
    last_modified: 2026-09-18T01:13:13Z
  - id: legacy-data-audit
    resource: "../../reports/legacy-data-audit.json"
    title: "Legacy data audit (local, ignored by Git)"
    last_modified: 2026-09-18T01:25:02Z
  - id: legacy-offline
    resource: "../../reports/legacy-offline-verification.json"
    title: "Offline staging replay (local, ignored by Git)"
    last_modified: 2026-09-18T01:29:34Z
  - id: legacy-repo-1
    resource: "https://github.com/jpbranson/mlgw.outage/tree/a682acfbde35bac691363fa37545bceef7fdb06f"
    title: "mlgw.outage at a682acf"
  - id: legacy-repo-2
    resource: "https://github.com/jpbranson/mlgw.outage.2/tree/8702e4bdc675f421eca919d431ac18a4b237175f"
    title: "mlgw.outage.2 at 8702e4b"
  - id: legacy-repo-3
    resource: "https://github.com/jpbranson/mlgw.outage.3/tree/ea0c8309337171b398ffadd5d6105d997f9b354b"
    title: "mlgw.outage.3 at ea0c830"
---
# Legacy history: repository overlap and staging audit

**September 22 deployment update:** the [DigitalOcean deployment guide](../operations/digitalocean-deployment.md) is authoritative for current operation. The VM now serves the dashboard and runs both collectors; local collectors are stopped. Runtime counts, preview sessions, trial deadlines and hosting gates below describe this earlier checkpoint. Its scientific findings and dated validation results are preserved.

**Coverage update:** the [subsequent historical capture audit](coverage-audit.md) inventories 53,679 captures across selected revisions, including repository 1's pre-deletion directory. All captures without consolidated totals are classified as empty event data or the one additional nonempty original. Recorded failures and observation gaps remain explicit; the tip-only findings below are preserved as dated evidence.

**Recovery update:** the separate [verified timezone catalog](timezone-recovery.md) now resolves 53,273 total observations and all 18,906 grid snapshots. One total observation retains an unknown timezone. Original staging and the dated audit measurements below remain preserved.

**Timestamp evidence:** [historical code and original-capture verification](timestamp-findings.md) established mixed UTC/Central conventions, including the April 28, 2024 code change and earlier absolute RData timestamps rendered as Central strings. The later [recovery checkpoint](timezone-recovery.md) completed conversion and transition checks for supported records. The unresolved staging counts below describe the preserved original audit output.

Checkpoint: September 17, 2026, approximately 8:25 PM CDT / September 18 01:25 UTC. The three repositories supplied by the owner are now inventoried at pinned revisions. Their consolidated data has been deduplicated into a separate, compressed staging archive. **The first two repositories add no unique total observations or valid grid-cell records beyond repository 3's current consolidated files.** All matching records retain provenance from every repository that supplied them.

This checkpoint covers the files reachable from the three pinned branch tips, not every historical Git revision. It does not establish complete historical outage coverage or publish a weather-aligned legacy timeline. The live collector and dashboard continue to use their existing current-format archive.

## Compared sources

| Repository and pinned revision | Consolidated total observations | Valid snapshot/grid-cell records | Records absent from repository 3 |
| --- | ---: | ---: | ---: |
| [mlgw.outage, a682acf](https://github.com/jpbranson/mlgw.outage/tree/a682acfbde35bac691363fa37545bceef7fdb06f) | 33,586 | 153,615 | 0 |
| [mlgw.outage.2, 8702e4b](https://github.com/jpbranson/mlgw.outage.2/tree/8702e4bdc675f421eca919d431ac18a4b237175f) | 43,748 | 154,933 | 0 |
| [mlgw.outage.3, ea0c830](https://github.com/jpbranson/mlgw.outage.3/tree/ea0c8309337171b398ffadd5d6105d997f9b354b) | 53,274 | 154,933 | 0 |

The union contains **53,274 total observations**, dated February 8, 2022–February 20, 2025 by their stored dates. Deduplication merges **77,334 repeated summary references** across repository copies. No conflicting totals were found at matching stored timestamps. The largest reported customer total remains 117,861, at stored time `2023-06-26 03:54:02.943589`; the largest outage total remains 3,998 at `2022-02-08T22:33:35Z`.

The union of valid spatial records contains **154,933 snapshot/grid-cell records**, **774,665 ordered vertices**, **18,906 capture keys** and **127 geographic grid IDs**, dated March 8, 2022–April 27, 2024. There are **308,548 repeated cell references** across repository copies and no conflicting counts or shapes at matching capture/grid identities. Repository 2 and repository 3 have byte-identical `total_parsed_polygons.rds` files; repository 1's valid cell records are a subset. The latest polygon table also contains 1,634,487 rows with nonfinite coordinates and missing filename/cell fields. They remain in the retained original and are accounted for as unusable rows, not additional snapshots or outages.

## What was preserved and checked

- All three complete branch-tip trees were inventoried; none of GitHub's recursive responses was truncated. The inventory script supports bounded subtree traversal if a future response is truncated.
- Six consolidated file references resolve to **five unique originals**, totaling **43,862,158 bytes / 41.8 MiB**. Downloads verify both the pinned Git blob SHA-1 and a retained SHA-256. Original RDS bytes remain under ignored `data/legacy/originals/`.
- Base R reads only the two supported data schemas. Legacy scraper code is inspected as text for timestamp evidence; no legacy jobs, workspaces or credential/config files are executed or imported.
- The staged `totals.jsonl.gz` and `grid-cells.jsonl.gz` together occupy **5,148,010 bytes / 4.9 MiB**. `sources.json` resolves each record's repository, commit, path and original hashes. Record provenance retains original row positions/counts and raw count/filename fields. Generated CSV intermediates are compressed losslessly; retained source objects remain intact.
- A total observation is deduplicated by its exact stored timestamp and numeric totals. A spatial record is deduplicated by its capture key, geographic grid ID, customer count and original ordered polygon ring. Different totals/geometries at the same identity would remain separate conflict variants. Identical values at different capture times remain separate observations.
- An independent Python projection plus base-R verifier rereads all five original objects. It checks all **130,608 source summary references** against **5,673,964 original event-observation rows**, and all **1,542,740 valid vertex references** from the two distinct polygon originals. The byte-identical third polygon reference is checked as an alias. Coordinates, ordering, counts, timestamps, filenames, IDs and source-row accounting match.
- All **134 existing Node tests** and **6 new Python tests** pass. The new cases exercise copied observations, conflicting totals, unchanged values across different captures, unresolved/DST wall times, filename precision and malformed counts. Offline replay reproduces the same two staged archive hashes.

`sourceFormat=legacy_html` is explicit on every staged record. Grid IDs describe geographic areas, not individual outage identities. Geometry retains its original five-vertex rings; no centroids or event locations are fabricated. Staging is not connected to the live SQLite index, dashboard, weather joins or anomaly baselines.

## Import gates recorded at the original checkpoint

**Timestamp reconciliation:** 17,519 total observations carry an explicit `Z` UTC suffix. The other **35,755** omit a timezone, including fractional-second timestamps. They retain their exact source values with `observedAt=null` and `timeStatus=timezone-unresolved`. The pinned older scraper uses bare `Sys.time()`, while the newer scraper explicitly uses `America/Chicago`; those tip versions alone do not prove when historical timezone behavior changed. Geometry filename times also remain unresolved. Historical source revisions and saved-capture evidence must establish timezone periods and DST ambiguity before alignment. Deduplication by raw timestamp does not yet resolve possible aliases caused by different time representations.

**Original-capture coverage:** repository 1's current tree has no individual saved snapshot files. Repository 2 contains 10,394 capture filenames from April 26–September 9, 2024, of which 10,235 have both an RData and saved-text RDS file. Repository 3 contains 10,467 pairs from September 11, 2024–February 20, 2025. Individual files in these trees have been inventoried, not bulk downloaded or parsed in this checkpoint. Their date ranges do not establish uninterrupted observation coverage.

There are 1,975 snapshot blob hashes reused at different capture keys. Content reuse alone must not remove observations. In particular, event-derived consolidated totals can omit captures whose parsed event table was empty; missing total records must not automatically become zero outages. Saved pages and RData samples need validation, and older Git revisions need a bounded inventory to find originals removed from branch tips.

Those historical-revision, timestamp and bounded coverage checks subsequently completed in the linked reports. The subsequent [separate legacy publication](legacy-dashboard.md) completed, including independent source-boundary and historical-retrieval verification, with gaps and the two retained exceptions visible. See [current status](../project-status.md) for the next checkpoint; exhaustive raw-history recovery remains outside this bounded scope.

## Local operation and evidence

See the [README workflow](legacy-guide.md) for replay commands. Machine-readable evidence is local and ignored:

- `data/legacy/pins.json`, `inventory.json`, `discovery/`, `originals/`, `export/`, `staged/` and `verification/`.
- `reports/legacy-inventory.json`, `legacy-data-audit.json`, `legacy-stage-verification.log`, `legacy-offline-verification.json` and `legacy-checkpoint-tests.log`.
- `reports/legacy-checkpoint-collector-health.json`: at **01:24:39 UTC**, **394/394 observed slots** were valid, with no gaps over ten minutes and healthy runner/storage status. The original seven-day trial remains underway.
