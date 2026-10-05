# Knowledge bundle update log

## 2026-10-04
* **Verification**: An owner-run read-only SSH check confirmed the active release and services and traced the missing rolling rainfall totals to unretried hourly frames and the rolling cache's per-download reservation (`reports/knowledge-verification-20261004-vm.log`).
* **Verification**: Public production checks, the 41-check deployment verifier, backup receipts and a cross-check of every command, path, API route and limit cited in the bundle confirmed [current project status](project-status.md) and the operating guides (`reports/knowledge-verification-20261004.json`). VM-internal facts were not re-read; the [deployment runbook](operations/digitalocean-deployment.md) keeps its October 23 `stale_after`.
* **Update**: The runbook now names the September 23 release and eight comparison cases. Missing rolling 24-hour rainfall totals in production are recorded in project status, the [weather guide](weather/weather-guide.md) and the [dashboard extensions](dashboard/dashboard-extensions.md) checkpoint.
* **Initialization**: Converted all project documentation into this OKF v0.2 bundle. Twenty-five reports moved from `reports/` with their Git history, together with the uncommitted September 24 closeout and addenda. `DESIGN_PLAN.md` became twelve [design concepts](design/index.md), the README's operating sections became guides, and the Census, fixture and font provenance notes moved to [references](references/index.md). Body text is unchanged apart from link paths, the replaced documentation-index table in [current project status](project-status.md) and six cross-references the split made necessary.
* **Creation**: Added frontmatter with type, sources, generation, verification and freshness; index files; this log; [the bundle playbook](maintaining-this-bundle.md); and `npm run knowledge:check`, which also runs in `npm test`.

## 2026-09-24
* **Creation**: [Local pilot closeout](collection/local-pilot-closeout.md) records the final offline verification of the stopped PC archive.
* **Update**: Dated closeout notes added to [current project status](project-status.md) and the [Phase 1](collection/phase-1-source-contract.md), [Phase 2](collection/phase-2-durable-collection.md) and [Phase 3](dashboard/phase-3-dashboard.md) checkpoints.

## 2026-09-23
* **Creation**: [Dashboard extensions](dashboard/dashboard-extensions.md) and the [weather case expansion](weather/cases-expansion.md).
* **Update**: [Current project status](project-status.md), the [deployment runbook](operations/digitalocean-deployment.md), the dashboard and weather guides and the design plan record the 07:45 UTC release.

## 2026-09-22
* **Creation**: [DigitalOcean deployment](operations/digitalocean-deployment.md) and the [technical audit implementation](operations/technical-audit.md).
* **Update**: All documents reconciled with the production deployment, the archive compatibility repair and the audit release.
* **Verification**: The release documentation audit passed for 28 documents at 04:16 UTC on September 23 (`reports/documentation-audit-release.json`).

## 2026-09-21
* **Creation**: The [point-location audit](locations/point-location-audit.md) and the [location dataset feasibility](locations/location-dataset-feasibility.md) prototype.

## 2026-09-18
* **Creation**: [Legacy dashboard integration](legacy/legacy-dashboard.md), the [initial weather comparisons](weather/comparisons-initial.md), [matched references](weather/matched-references.md) and the [autonomous continuation](weather/autonomous-continuation.md).
* **Update**: Documentation readiness and completion reviews reconciled all documents.

## 2026-09-17
* **Creation**: [Rainfall accumulation](weather/rainfall-accumulation.md), [rainfall dashboard](weather/rainfall-dashboard.md), [weather periods](weather/weather-periods.md), [storage and pilot revalidation](weather/storage-and-pilot-revalidation.md), [station quality](weather/station-quality.md) and [event context](weather/event-context.md) checkpoints.
* **Creation**: Legacy [repository audit](legacy/repository-audit.md), [timestamp findings](legacy/timestamp-findings.md), [timezone recovery](legacy/timezone-recovery.md) and [coverage audit](legacy/coverage-audit.md).
* **Update**: The [Phase 1](collection/phase-1-source-contract.md) 24-hour pilot review passed its local observation gate.

## 2026-09-16
* **Initialization**: The design plan and the [Phase 1](collection/phase-1-source-contract.md), [Phase 2](collection/phase-2-durable-collection.md), [Phase 3](dashboard/phase-3-dashboard.md) and [Phase 3A](weather/phase-3a-weather-sources.md) checkpoints.
