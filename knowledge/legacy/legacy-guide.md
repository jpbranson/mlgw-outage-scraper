---
type: Guide
title: "Legacy history audit and staging"
description: "The Legacy archive page, legacy:prepare publication, the audit/recovery/coverage summary and the offline replay commands and limits."
resource: "https://64.225.60.118/legacy.html"
tags: [legacy, operations]
status: stable
generated: { by: "codex/unknown", at: 2026-09-22T16:41:52Z }
verified:
  - { by: "process:documentation-review", at: 2026-09-23T04:16:15Z }
  - { by: "claude-code/claude-opus-5-5", at: 2026-10-05T02:45:24Z }
sources:
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
# Legacy history audit and staging

Open **Legacy archive · 2022–2025** at [the deployed dashboard](https://64.225.60.118/legacy.html), or the corresponding route on a local development copy. The separate view offers UTC month/date navigation, Central-time capture replay, observed daily peaks, detailed day charts, original grid polygons and bounded CSV/GeoJSON exports. Totals without geometry display an explicit unavailable map. Empty months, the 291-day gap, unresolved time and unreconciled original remain visible; empty event tables never become zero totals. Current-feed heatmaps, per-capita maps, anomalies and rainfall charts keep their existing source scope.

Prepare the separate local read model from the verified recovery/coverage inputs with `npm run legacy:prepare`, then independently verify it with `python -B scripts/verify-legacy-dashboard.py`. Build the client and restart only the dashboard after publication; keep the collector running. The ignored `data/legacy/dashboard/catalog.json` points to a hash-verified, read-only SQLite index (77.1 MiB). Preparation is offline and reproducible; original catalogs and archives remain unchanged. See [integration checks, routes and limitations](legacy-dashboard.md). A fresh checkout needs the retained audited inputs before preparation can succeed.

The [three-repository audit](repository-audit.md) found that the first two repositories' consolidated totals and valid grid records are already contained in repository 3. Staging preserves 53,274 distinct total observations and 18,906 grid snapshots with all repository/commit provenance. The separate [verified timezone recovery catalog](timezone-recovery.md) resolves 53,273 total observations and all grid snapshots, preserving one unresolved total and every original value. The subsequent [capture-coverage audit](coverage-audit.md) inventories 53,679 captures, including repository 1's deleted directory in Git history, and distinguishes 2,211 empty event tables from zero outages. It records timeline gaps and one additional nonempty original for reconciliation. The reports document offline replay. The [legacy dashboard integration](legacy-dashboard.md) now serves the resolved observations in a separate read-only view with explicit gaps and exclusions.

Overlap replay requires Node 24+, base R (`Rscript`) and Python 3.11+. The separate [timestamp evidence checks](timestamp-findings.md) also need IANA timezone data, supplied by Python's `tzdata` package in this Windows runtime. Run from this repository root. The commands read only the supported legacy schemas and never execute old scraper jobs.

```powershell
npm run legacy:inventory
# Initial acquisition only, if pinned inputs are missing:
# npm run legacy:inventory -- --download

$legacyInventory = Get-Content data/legacy/inventory.json -Raw | ConvertFrom-Json
foreach ($legacyOriginal in ($legacyInventory.originals | Sort-Object blob -Unique)) {
  $legacyKind = if ($legacyOriginal.path -eq 'total_outages.rds') { 'totals' } else { 'polygons' }
  Rscript --vanilla scripts/export-legacy-rds.R $legacyKind $legacyOriginal.local "data/legacy/export/$($legacyOriginal.blob)"
  if ($LASTEXITCODE -ne 0) { throw 'Legacy export failed' }
}
python -B scripts/audit-legacy-data.py
python -B scripts/verify-legacy-stage.py
Rscript --vanilla scripts/verify-legacy-stage.R
python -B -m unittest discover -s test -p 'legacy*_test.py'
```

The inventory uses saved pins and defaults to offline operation. Explicit acquisition is limited to the three supplied public repositories, 55 requests, 128 MiB per consolidated file and 256 MiB per invocation. It downloads pinned consolidated originals and tree metadata, without cloning full Git histories or fetching credential/config files. `data/legacy/` holds the source originals, compressed exports, staged JSONL and independent verification projections. Check each command's successful exit before proceeding; the audit report's source/catalog hashes must match before staged records are used. Repeated source times merge provenance; different capture times remain separate even when their payloads match. Unqualified timestamps remain unresolved rather than receiving an assumed UTC offset.
