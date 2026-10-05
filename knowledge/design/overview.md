---
type: Design Section
title: "Design plan: overview and status"
description: "Purpose and dated status of the design plan, reconciled after the September 22–23 deployment and audit release."
tags: [design, status]
status: stable
generated: { by: "codex/unknown", at: 2026-09-23T04:17:59Z }
verified: { by: "process:documentation-review", at: 2026-09-23T04:16:15Z }
---
# MLGW outage history and dashboard: design plan

Prepared September 16, 2026; operating state reconciled after the September 22–23 audit release. See [current status and the documentation index](../project-status.md). Editing this plan does not itself authorize additional implementation work.

**September 22 deployment:** the user selected a DigitalOcean Linux VM and public-IP access, and authorized deployment. The $12/month, 1 CPU / 2 GB / 50 GB Ubuntu VM now hosts the existing filesystem/SQLite application at https://64.225.60.118. Linux services run five-minute outage collection and 30-minute weather refresh continuously. All retained history was verified during migration, and local collectors are stopped. HTTPS and certificate renewal are configured. The [deployment guide](../operations/digitalocean-deployment.md) supersedes earlier local-only and free-first implementation assumptions in the plan sections; long-term retention and evidence protections remain in force.

**September 22–23 audit release:** [recovery and operational hardening](../operations/technical-audit.md) is deployed, including schema-2 deterministic projection, explicit rebuild/rollback, per-client request limits and CI/browser checks. Verified full PC backups are installed for 10 AM Central daily and at user login; downloads require this PC online with the user signed in. External monitoring is prepared but unconfigured by choice. Long-term automatic offload and deletion remain future work.

**Historical scope, September 18:** collection, validation and the dashboard run locally. The 24-hour pilot passed; the seven-day collector trial continues. The dashboard, heatmap, Census per-capita maps, weather replay, legacy integration and two rainfall/wind cases with matched references are complete. The requested [autonomous continuation](../weather/autonomous-continuation.md) adds verified cold/heat comparisons, original legacy-grid cold summaries, isolated ongoing weather refresh/retention, a real-data desktop-transfer rehearsal and a guarded seven-day acceptance command. Three additional rainfall/wind candidates failed the existing reference screen; snow/ice and some heat periods lack sufficient outage coverage. Saved study evidence remains protected under a shared 1 GiB weather cap. The existing Quick Tunnel keeps its September 18 3:06 PM CDT expiry. Cloud provider validation/deployment and Phase 4B installation/cleanup still need account/runtime setup; unsupported source families, missing legacy evidence and richer local-exposure rankings remain open.

**Access update, September 18:** after the September 17 session was closed at the user's request, the user requested a new Quick Tunnel deployment of the latest version. The new password-protected session began at 7:06:19 AM CDT and expires at 3:06:19 PM CDT. Current-feed, weather and legacy routes passed external verification and browser sign-in/replay. Storage and collection remain local.

**Source review update, September 17 at approximately 12:20 PM CDT:** the 24-hour pilot completed with 290/290 observed slots and passed its local observation gate. All captures mirrored into the existing seven-day collector, which continued directly at the next slot. All 297 captures at the 17:15 UTC cutoff replayed and restored successfully; dashboard API totals/freshness matched. The [completed review](../collection/phase-1-source-contract.md) documents source start/location edits and an HTML-inclusive storage model. Full seven-day acceptance and provider validation remain pending; earlier statements that both pilots were running describe the morning checkpoint.
