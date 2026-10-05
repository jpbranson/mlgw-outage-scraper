---
type: Audit Report
title: "Legacy timezone recovery"
description: "September 17, 2026 verified UTC recovery of 53,273 totals and all 18,906 grid snapshots, source-transition rules and the one unresolved exception."
tags: [legacy, timezone, recovery]
status: stable
generated: { by: "codex/unknown", at: 2026-09-22T16:41:52Z }
verified: { by: "process:documentation-review", at: 2026-09-23T04:16:15Z }
sources:
  - id: timezone-recovery
    resource: "../../reports/legacy-timezone-recovery.json"
    title: "Timezone recovery report (local, ignored by Git)"
    last_modified: 2026-09-18T02:14:22Z
  - id: recovery-verification
    resource: "../../reports/legacy-recovery-verification.json"
    title: "Independent recovery verification (local, ignored by Git)"
    last_modified: 2026-09-18T02:14:22Z
  - id: recovery-replay
    resource: "../../reports/legacy-recovery-offline-replay.json"
    title: "Offline recovery replay (local, ignored by Git)"
    last_modified: 2026-09-18T02:11:07Z
  - id: recovered-catalog
    resource: "../../data/legacy/recovered/catalog.json"
    title: "Verified recovery catalog (local, ignored by Git)"
    last_modified: 2026-09-18T02:14:22Z
---
# Legacy timezone recovery

**September 22 deployment update:** the [DigitalOcean deployment guide](../operations/digitalocean-deployment.md) is authoritative for current operation. The VM now serves the dashboard and runs both collectors; local collectors are stopped. Runtime counts, preview sessions, trial deadlines and hosting gates below describe this earlier checkpoint. Its scientific findings and dated validation results are preserved.

**Subsequent checkpoint:** the [historical capture-coverage audit](coverage-audit.md) is complete, with gap lists, classified empty/failed captures and one additional nonempty original outside this recovered catalog. The [separate legacy dashboard integration](legacy-dashboard.md) subsequently completed. The recovery results below are unchanged.

Completed September 17, 2026, approximately 9:10 PM CDT / September 18 02:10 UTC. A versioned, independently verified recovery catalog now contains **53,273 of 53,274 total observations with resolved UTC instants**, plus **all 18,906 geographic grid snapshots**. This recovers **35,754 of the 35,755 previously timezone-free total observations**. Original values, source provenance, counts and geometry remain intact.

One total observation remains explicitly unresolved: **stored `2024-04-26 12:24:32.859703`, 6 outages and 10 affected customers**. It is present in the initial consolidated file in repository 2, but an original capture and independent clock reference were not found in the inspected sources. UTC and Central interpretations remain candidates. It is retained in the recovered archive and exception list with `observedAt=null`; it is excluded from the ordered UTC timeline.

## Recovery methods and results

| Basis | Total observations | Validation |
| --- | ---: | --- |
| Existing explicit UTC suffix | 17,519 | Instant preserved; normalized formatting only. |
| Original numeric POSIXct epoch | 1,567 | Every original matched the complete consolidated event table, not just its totals. Restored fractional seconds, retaining the original numeric value. |
| Original capture plus UTC commit reference | 4 | Complete event contents match; exactly one UTC/Central interpretation falls within five minutes before the capture's introducing commit. |
| Verified UTC source-version rule | 14,656 | Historical scraper and R setup code, corroborated by original captures and commits. |
| Verified Central source-version rule | 19,527 | Explicit `America/Chicago` scraper code, verified transition row and daylight-saving rules. |
| Unresolved | 1 | Preserved as an exception; no offset was assumed. |

The recovered UTC range is **February 8, 2022 at 22:06:14 UTC through February 20, 2025 at 20:43:41.006461 UTC**. There are **no duplicate UTC instants or collisions** among the resolved total observations. These remain capture observations, not unique outage counts or complete historical sampling coverage.

The December 2022 epoch cohort was checked in full. **1,710 original RData references** were inspected: 1,567 numeric-timestamp captures, ten character-timestamp captures and 133 empty event tables. All 1,567 numeric captures match the consolidated string when rendered in Central time at whole-second precision, with identical event columns and counts. None matched the competing UTC rendering. The original absolute epochs therefore recover both timezone and discarded fractional precision. Empty event tables were recorded as empty and were not converted into invented zero-outage observations.

Four exceptional character captures—December 24, 2022 at stored 01:08:56; April 26, 2024 at 17:22:43.937077; and April 28 at 16:01:24.799172 and 16:03:21.523106—were resolved from their full original contents and UTC commit timing. They use Central time. The introducing-commit checks and exact original-file hashes are retained in the recovery report.

The April 28 source transition uses original row provenance from the pinned consolidated object. The first verified automated Central capture is source row **1,775,646**, stored `2024-04-28 16:05:55.281641`. Earlier UTC values on that date have later-looking wall-clock text, so a date/time-text cutoff would be incorrect. The resolver locks its rules to the audited staged-input hashes and rejects changed inputs until the source-row rules are reviewed. Source-version recovery is distinguished from direct epoch recovery in every record's metadata.

## Geographic snapshot times

All **154,933 grid-cell records across 18,906 snapshots** have resolved capture times:

- **1,573 snapshots** match a retained original RData file by its capture filename. Their times come from that original's independently recovered total observation.
- **17,333 snapshots** use the pre-transition UTC filename convention, each corroborated by exactly one independently recovered total observation within one second. The filename and event timestamps were sampled separately by the legacy scraper; that precision limit is explicit.

The original-file matches correctly handle local-time filenames from exceptional runs. No grid time was selected solely by assuming all filenames were UTC. Polygon coordinates, their ordering, customer counts and geographic grid IDs are unchanged. These are geographic areas, not precise individual outage locations.

## Validation and storage

- Python compares every recovered record with staging after removing only the added recovery metadata and restoring the original timestamp fields. All **53,274 total records and 154,933 grid-cell records** preserve their source content and provenance exactly.
- An independent base-R verifier rereads all **1,567 original numeric timestamps**, checks every resolved total conversion using R's timezone implementation, checks all grid timestamp links and verifies strict UTC ordering for the total timeline. Conversions agree within one microsecond; original epoch text is retained for exact numeric reconstruction.
- **18 legacy Python tests** pass, including transition-row handling, precision recovery, provenance mismatch, unresolved records, both daylight-saving transitions and commit-anchor rejection. All **134 Node tests** pass.
- Offline acquisition replay makes zero requests. Re-running recovery produces the same two compressed archive hashes. Their combined size is **6,440,514 bytes / 6.1 MiB**. Source originals and earlier staging remain intact; recovery generations are separate.
- At **02:10:52 UTC**, the live collector had **404/404 valid observed slots**, no gaps over ten minutes and healthy runner/storage status.

The verified local catalog is `data/legacy/recovered/catalog.json`; it points to the recovery generation, its archives and verification evidence. The converter initially marks a generation unverified. Only successful independent verification marks the catalog verified. Each record carries its original time/status, resolved UTC value, method, precision and evidence. Ambiguous fall-back times and nonexistent spring-forward times remain unresolved unless independent evidence selects an instant.

At this recovery checkpoint, the dashboard and live collector were not connected to the historical catalog. The subsequent [raw-capture coverage checkpoint](coverage-audit.md) and [separate legacy dashboard](legacy-dashboard.md) are complete; live collection remains independent. The unresolved total does not prevent using verified observations, but must remain visible as missing time coverage. The coverage audit's additional nonempty original stays outside this recovered catalog until reconciled.

## Reproduction

Prerequisites are the previously audited staging/originals, Node 24+, base R, and Python 3.11+ with IANA timezone data (`tzdata` in this Windows runtime). Run from the repository root. Acquisition defaults to cached inputs; add `--download` only when missing originals need to be fetched. It selects the archived December RData files and transition additions automatically, verifies Git blob and SHA-256 hashes, uses four download workers and enforces request, time and byte limits. It never executes old scraper code.

```powershell
node scripts/collect-legacy-recovery.mjs --captures
Rscript --vanilla scripts/extract-legacy-recovery.R
python -B scripts/recover-legacy-timezones.py
python -B scripts/verify-legacy-recovery.py
Rscript --vanilla scripts/verify-legacy-recovery.R
python -B scripts/verify-legacy-recovery.py --finalize
python -B -m unittest discover -s test -p 'legacy*_test.py'
```

Check successful exits before proceeding to the next command. Evidence includes ignored `data/legacy/recovery-evidence/`, `reports/legacy-timezone-recovery.json`, `legacy-recovery-verification.json`, `legacy-recovery-offline-replay.json` and the test/collector-health logs. The preceding [timestamp findings](timestamp-findings.md) preserve the initial sample-based research; this report records completed recovery and its remaining exception.
