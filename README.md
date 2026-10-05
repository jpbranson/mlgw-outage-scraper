# MLGW outage collection

**September 23 release (deployed 07:45 UTC):** replay play/pause, custom shareable episodes, an exact-point **Locations** view, paired rainfall/outage maps with rolling 24-hour rainfall, and four more weather case studies (eight in total). See the [dashboard extensions](knowledge/dashboard/dashboard-extensions.md) and [case expansion](knowledge/weather/cases-expansion.md) checkpoints and the [deployment steps](knowledge/project-status.md#deploying-the-september-23-change-set).
**Technical audit implementation:** deterministic archive recovery, schema-2 rebuilds, durable publication, isolated request quotas, clearer data-quality warnings, Linux deployment rollback, CI/browser checks and daily verified PC backups are described in [the implementation record](knowledge/operations/technical-audit.md). Cloud monitoring is prepared but remains unconfigured by choice. Current operational results and recovery commands are in [the deployment runbook](knowledge/operations/digitalocean-deployment.md).

**September 22 cloud deployment:** the dashboard is live at **https://64.225.60.118** on the selected $12/month DigitalOcean VM. Five-minute outage collection and 30-minute rolling weather refresh now run under Linux services. The local collectors are stopped after a verified handoff of all 1,722 archived attempts, saved weather evidence, legacy history and four comparison cases. The PC can be offline while cloud collection continues. See [deployment, SSH, health checks and backup instructions](knowledge/operations/digitalocean-deployment.md).

Use `npm.cmd run deploy:verify` to check public access and `npm.cmd run deploy:backup` for an additional verified cloud backup. The installed **MLGW verified cloud backup** Windows task runs daily at **10 AM Central** and at user login; this PC must be online with the user signed in. Backups accumulate under ignored `data/deployment/backups/` without automatic deletion. Local `collector:status` and `weather:status` commands describe the stopped PC runners. Do not start a second local collector while cloud collection is active. The local trial ended by cloud handoff; it is not recorded as passing its original seven-day acceptance gate.

Implementation of [the design plan](knowledge/design/index.md): the source pilot, durable collector, historical outage dashboard and prepared weather/rainfall views. Start with [current project status and the documentation index](knowledge/project-status.md), reconciled after the September 22–23 audit release. Phase reports retain dated implementation evidence; their old counts, PIDs, timings and preview sessions are historical checkpoints.

DigitalOcean now hosts collection, archives and the public read-only dashboard. Existing local evidence remains intact. The September 18 Quick Tunnel and earlier local operating measurements in the operating guides are historical. The Cloudflare runtime probe remains an unused alternative. The latest audit release passed **203 Node tests on Windows and Linux**, TypeScript/build, four desktop/phone Playwright cases, 26 Python tests and 30 public HTTPS checks. Its production index rebuild preserved all 1,818 attempts and 1,731 snapshots at the cutover cutoff; these are deployment measurements, not current archive counts.

## Project knowledge

All project knowledge (design, operating guides, dated checkpoint evidence, audits and data provenance) lives in [`knowledge/`](knowledge/index.md) as an [Open Knowledge Format](https://github.com/GoogleCloudPlatform/open-knowledge-format) v0.2 bundle: Markdown documents whose YAML frontmatter records type, sources, generation, verification and freshness. Start with the [bundle index](knowledge/index.md) or [current project status](knowledge/project-status.md). [Maintaining this knowledge bundle](knowledge/maintaining-this-bundle.md) describes the conventions; `npm run knowledge:check` validates the bundle and also runs in `npm test`. Machine-readable evidence stays in the ignored `reports/` directory.

The operating guides formerly in this README:

| Guide | Location |
| --- | --- |
| Source pilot and parser files | [collection/source-pilot.md](knowledge/collection/source-pilot.md) |
| Local durable collector | [collection/collector-guide.md](knowledge/collection/collector-guide.md) |
| Dashboard views, API and design rules | [dashboard/dashboard-guide.md](knowledge/dashboard/dashboard-guide.md) |
| Weather controls, cache and rainfall preparation | [weather/weather-guide.md](knowledge/weather/weather-guide.md) |
| Historical weather comparisons | [weather/comparisons-guide.md](knowledge/weather/comparisons-guide.md) |
| Legacy history audit and staging | [legacy/legacy-guide.md](knowledge/legacy/legacy-guide.md) |
| Outage-location analysis | [locations/location-analysis-guide.md](knowledge/locations/location-analysis-guide.md) |
| Temporary phone preview (historical procedure) | [operations/temporary-preview.md](knowledge/operations/temporary-preview.md) |
| Cloud runtime probe (deferred Cloudflare alternative) | [operations/cloudflare-probe.md](knowledge/operations/cloudflare-probe.md) |

## Run locally

Requires Node.js 24 or later, including its built-in SQLite module. No packages need to be installed for the local pilot, collector or tests; building the frontend requires `npm ci`. Run commands from this directory. In Windows PowerShell, use `npm.cmd` if execution policy prevents `npm.ps1` from running. Captures, weather originals, credentials and generated builds are ignored by Git, so a fresh checkout does not contain the existing history or prepared weather. The commands below support local development and replay; collection now runs on the VM.

```powershell
npm test
npm run benchmark
npm run storage
npm run analyze
```
