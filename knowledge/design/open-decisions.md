---
type: Design Section
title: "Open decisions and questions for the owner"
description: "Settled choices and the remaining optional owner decisions with their defaults or triggers."
tags: [design, decisions]
status: stable
generated: { by: "codex/unknown", at: 2026-09-23T04:17:59Z }
verified: { by: "process:documentation-review", at: 2026-09-23T04:16:15Z }
---
# 11. Open decisions and questions for the owner

The selected VM, public-IP access, five-minute outage cadence, 30-minute weather refresh, evidence retention, dashboard scope and daily/login PC backup schedule are settled. Cloud account access is configured and deployment is complete. External monitoring is prepared for later and remains unconfigured by choice. The former PC trial is stopped; its old deadline is not a future acceptance instruction. Both outage-event and peak-customer per-capita measures are implemented.

| Decision | Needed now? | Default or trigger |
| --- | --- | --- |
| Specific storms or weather categories to prioritize | Optional | Expand only when independent coverage and suitable references support another case. |
| Domain name | Optional | Continue using the verified public-IP HTTPS origin. |
| External alert delivery | Optional; deferred by choice | Heartbeat integration is prepared but has no configured endpoint/account. Health checks log on the VM; daily/login PC backups are already installed. |
| Final long-term archive directory, disk budget and second copy | Before automatic offload installation | Current verified backups use `data/deployment/backups`; the provisional long-term archive is `C:\Developer\mlgw-outage-scraper\archive`. Recheck destination capacity at that stage. |
| Additional paid storage or backup products | Only if needed and requested | The selected $12/month VM is active; further paid products are not automatically enabled. |

Source compatibility, geographic joins, sample size and storage growth remain implementation/validation work. A subsequent feature or automation stage remains separate from this documentation audit.
