---
type: Checkpoint Report
title: "Legacy dashboard integration"
description: "September 18, 2026 separate read-only legacy publication, month/day charts, exact grid replay, gaps/exclusions and full-record verification."
tags: [legacy, dashboard]
status: stable
generated: { by: "codex/unknown", at: 2026-09-22T16:41:52Z }
verified: { by: "process:documentation-review", at: 2026-09-23T04:16:15Z }
sources:
  - id: legacy-catalog
    resource: "../../data/legacy/dashboard/catalog.json"
    title: "Legacy dashboard publication catalog (local, ignored by Git)"
    last_modified: 2026-09-18T11:55:32Z
  - id: legacy-dashboard-reports
    resource: "../../reports/legacy-dashboard-*.json"
    title: "Legacy dashboard verification reports (local, ignored by Git)"
---
# Legacy dashboard integration

**September 22 deployment update:** the [DigitalOcean deployment guide](../operations/digitalocean-deployment.md) is authoritative for current operation. The VM now serves the dashboard and runs both collectors; local collectors are stopped. Runtime counts, preview sessions, trial deadlines and hosting gates below describe this earlier checkpoint. Its scientific findings and dated validation results are preserved.

Completed locally September 18, 2026. The dashboard now links to a separate **Legacy archive · 2022–2025** view at `http://127.0.0.1:4173/legacy.html`. It serves **53,273 resolved regional total observations**, **18,906 grid snapshots** and **154,933 grid-cell records** from the independently verified recovery catalog.

## Display and interpretation

The archive has UTC month/date navigation, Central-time capture labels, daily peak charts, detailed day charts, previous/next and keyboard-accessible capture selection, polygon replay, CSV and selected-grid GeoJSON exports. Months without observations remain selectable. The current-feed page and the legacy page have explicit source navigation; current anomaly baselines, heatmaps, Census maps and rainfall charts continue to use current-format observations only.

Daily peaks are separate points, so a day with observations does not suggest continuous sampling. Customer and outage peaks keep their own capture IDs and exact timestamps. Detailed charts break across intervals exceeding one hour, matching the coverage audit's threshold. Shorter connections are not proof of uninterrupted collection. Gap counts include intervals surrounding an entire requested period, including the 291.4-day gap. There is no assumed five-minute legacy schedule or fabricated coverage percentage.

Maps retain the original grid polygons, cell IDs and customer counts. Grid time and related regional-total time are stored separately and linked only through the audited recovery anchor. Grid totals can differ from regional totals. No centroids, point locations, incident identities or Census allocations are invented. A totals-only observation clears the preceding map and explicitly reports unavailable geometry; its GeoJSON export returns a conflict response.

The visible summary and expandable Data notes retain these exclusions:

- One unresolved consolidated time, stored `2024-04-26 12:24:32.859703`: 6 outages / 10 customers, outside the ordered UTC timeline.
- One unreconciled nonempty original, stored `2024-04-28 15:54:57.669638`: 7 outages / 201 customers, outside the published numeric archive.
- 2,211 empty event captures, including one blank saved page and one rejected request. None becomes a zero total.
- 1,807 consolidated observations without a candidate standalone original in the audited trees. The preserved consolidated sources remain valid evidence; original availability is distinct from numeric coverage.

The original coverage audit's `dashboardPublished=false` remains its historical checkpoint value. Publication status belongs to the new dashboard catalog; the earlier audit and recovery catalogs are unchanged.

## Publication and operation

`npm run legacy:prepare` is offline. It requires matching, verified recovery and coverage catalogs, verifies input SHA-256 values and independent verification evidence, and streams the resolved records into a separate SQLite read model. It rechecks inputs after streaming, validates counts, polygons, anchor uniqueness and database integrity, then atomically replaces only the dashboard publication catalog. Failed input validation leaves the previous publication active. Re-running it produces the same database hash and reuses the existing file.

The published database occupies **80,896,000 bytes / 77.1 MiB** under ignored `data/legacy/dashboard/`. Its SHA-256 is `740e7328a7b019cf08e3a62559a71a19688ee7ec06f612f7814db6ea21486dfd`. Source archives, original epochs, fractional UTC strings and per-record recovery methods remain preserved. The derivative retains exact timestamps, count values, polygon coordinates, total-source row references and catalog provenance. The index can be rebuilt from the local audited inputs; a fresh Git checkout does not include these ignored datasets.

The server verifies the database hash at startup and opens it read-only. A missing or corrupt legacy publication returns an explicit unavailable response while current-feed routes remain usable. Reads are limited to 31 days, 20,000 observations, 10,000 map features and the server's existing request/response budgets. Individual-observation charts are limited to two days. No legacy import or other write route exists.

Read-only routes are `/api/legacy/catalog`, `/api/legacy/series`, `/api/legacy/snapshots`, `/api/legacy/snapshot/<id>`, `/api/legacy/export.csv` and `/api/legacy/export.geojson`. Legacy IDs and source labels stay separate from current-feed IDs. The local server remains bound to loopback. The remote preview remained stopped at this integration checkpoint. The user subsequently requested a September 18 Quick Tunnel deployment; the authenticated allowlist now includes the legacy page/assets and bounded read routes. External replay/export and browser checks passed.

```powershell
npm run legacy:prepare
python -B scripts/verify-legacy-dashboard.py
npm run dashboard:build
# Restart only the existing dashboard process after verifying its identity.
npm run dashboard
```

Do not start a second dashboard while the existing server owns port 4173. Background output at this checkpoint was in `reports/dashboard.legacy.stdout.log` and `reports/dashboard.legacy.stderr.log`. Collector operation is independent.

## Verification

- **140 Node tests and 26 legacy Python tests pass.** Six new tests cover publication/replay, exact times and grid anchors, missing geometry, exclusions, independent peaks, gaps across empty periods, query limits, corrupt/unverified inputs, exports and read-only HTTP behavior.
- Independent Python verification compared **every resolved total, every grid cell and all 18,906 links**, preserving exact coordinates, source strings, counts and recovery metadata. The unresolved observation is absent from the ordered index and present in the exceptions. Coverage and monthly counts match their sources.
- Offline publication replay produced the same database hash. Original recovery/coverage catalog hashes still match the publication inputs; no upstream requests were made by publication or verification.
- TypeScript and frontend build pass. Existing 4,000/10,000-feature current-feed API replay verification also passes.
- All 37 archive months reconcile to the published totals and grid counts; all 1,793 distinct long intervals match the coverage audit. Documentation checks cover 21 Markdown files and 158 local links, with no broken links.
- Browser checks cover totals-only and grid captures, next-capture navigation, detailed day charts, empty months, exclusions, and source navigation. Desktop and 390-pixel phone layouts are readable; phone text is at least 16 CSS pixels and the document has no horizontal overflow. No browser warnings/errors appeared during the checked flows.
- At **11:57:01 UTC / 6:57 AM CDT**, the collector had **521/521 valid observed slots**, no gaps over ten minutes, healthy runner/storage status and no pending rollups. Its existing seven-day trial continues; the remote preview remains stopped.

Evidence is retained in ignored `reports/legacy-dashboard-*.json` and `.log` files. Initial rainfall/wind comparisons and [matched references](../weather/matched-references.md) subsequently completed, followed by [cold/heat studies and original-grid cold summaries](../weather/autonomous-continuation.md). Additional geometry recovery and reconciliation of the two outstanding records remain separate work. A local desktop-transfer rehearsal is complete; permanent cloud hosting and provider-backed transfer installation remain pending account/runtime setup. See [current status](../project-status.md) for operation; the PIDs, test counts and preview state above are historical.
