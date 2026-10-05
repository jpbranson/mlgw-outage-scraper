---
type: Design Section
title: "Recommended approach and confirmed requirements"
description: "Selected VM architecture, five-minute cadence, retention intent, audience, budget and the confirmed requirements table."
tags: [design, requirements, hosting]
status: stable
generated: { by: "codex/unknown", at: 2026-09-23T04:17:59Z }
verified: { by: "process:documentation-review", at: 2026-09-23T04:16:15Z }
---
# 1. Recommended approach

The selected production implementation uses Node 24, immutable compressed filesystem archives, SQLite and a static dashboard on a DigitalOcean Linux VM. Caddy terminates HTTPS and proxies the loopback dashboard; systemd manages the collectors. The original Cloudflare proposal and its unrun benchmark remain historical alternatives. Keep the parser and analytics portable.

Production uses **five-minute collection**; a future one-minute option requires source-frequency measurements and implementation changes, because the current production configuration rejects other cadences. Keep detailed observations indefinitely where practical. Retain them in the cloud while space permits. The planned long-term offload protocol would transfer detail older than one year to this Windows PC under storage pressure, verify it and then remove only those verified cloud copies. Keep the newest year in cloud storage and long-term summaries available to the dashboard. Current full backups preserve all canonical cloud history and do not enable this deletion protocol.

The dashboard is **accessible to anyone with its link**, with light expected use. The user selected the **$12/month DigitalOcean VM** after considering cloud options. Additional paid backup or storage products are not enabled automatically.

The useful first version answers:

- How many customers and reported outages are affected now?
- How has that changed over the last day, week, or month?
- Where are the current outages, and what did the map show earlier?
- Which increases, long-running outages, or recurring locations warrant a closer look?

The weather extension will also answer:

- Where was precipitation occurring as outages appeared, and how much rain fell during and before that period?
- Which areas had more newly reported outages or greater observed interruption burden during heavy rain, prolonged rainfall, high winds, flash-flood episodes, snow, ice and heat waves?
- Do those associations persist across comparable events, weather exposure and population denominators, with missing observations and source-format changes visible?

## Confirmed requirements and remaining setup choices

The audience, retention intent and 30-day offline-PC storage allowance retain the user's September 16 requirements. The September 22 choice of a $12/month DigitalOcean VM supersedes the original free-first hosting preference. Cloud deployment and recurring full PC backups are installed; long-term offload remains separate work. The 30-day allowance is a capacity-planning requirement, not a backup-freshness guarantee: private health degrades when the verified PC backup is over 36 hours old.

| Decision | Requirement or selected approach | Implementation implication |
| --- | --- | --- |
| Audience | Anyone with the link; mostly personal use | No viewer login. Cache public reads, bound traffic, and keep administrative/archive operations authenticated. An unlisted URL does not enforce privacy. |
| History | Preserve detail as long as possible; newest year always in the cloud | Move older detail to the PC only when storage pressure warrants it; verify local receipt before cloud deletion. |
| Cloud provider | DigitalOcean Linux VM, selected September 22 | Existing filesystem/SQLite implementation is deployed; use the public IPv4 address first. |
| Budget | Selected $12/month VM | No additional paid backup/storage products enabled; monitor growth and retain storage stop guards. |
| Scope | All reported MLGW electric outages; anomalies, historical heatmap, Census per-capita maps and prepared weather/rainfall views | Verified legacy history has separate dashboard views. Four rainfall/wind/cold/heat cases, matched references, native-grid cold summaries and bounded rolling weather refresh/retention are implemented. Additional supported source families, independent episodes and richer exposure analysis remain open. Automated notifications remain optional. |
| Validation and access now | Public HTTPS at https://64.225.60.118 | Linux tests, real archive restore, external route checks and certificate renewal rehearsal passed; earlier Quick Tunnel sessions are historical. |
| Weather scope | Radar, rainfall accumulation and historical conditions including flash flood, prolonged rain, snow, ice and heat | Include wind alongside rain; distinguish measurements, warnings, reported events and derived condition labels. Start with radar/rainfall, then comparative analysis. |
| Desktop setup | PC is on irregularly; reserve at least 30 days of offline headroom | Size the reserve from projected storage growth, including storm periods. The provisional archive folder is `C:\Developer\mlgw-outage-scraper\archive`; recheck capacity for Phase 4B. |
