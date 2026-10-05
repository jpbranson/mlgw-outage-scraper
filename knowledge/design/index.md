# Design plan, in section order

* [Design plan: overview and status](overview.md) - Purpose and dated status of the design plan, reconciled after the September 22–23 deployment and audit release.
* [Recommended approach and confirmed requirements](recommended-approach.md) - Selected VM architecture, five-minute cadence, retention intent, audience, budget and the confirmed requirements table.
* [Source discovery: what is already verified](source-discovery.md) - Verified MLGW feed fields, legacy scraper measurements and documented historical weather sources with their limits.
* [Collection frequency and reliability](collection-reliability.md) - Polling cadence trade-offs and the deployed collection attempt, retry, lease and freshness rules.
* [Deployed cloud architecture](cloud-architecture.md) - Single DigitalOcean VM with systemd services, Caddy HTTPS, read-only dashboard, health timer and SSH backups, plus alternatives considered.
* [Storage and data model](storage-and-data-model.md) - Immutable gzip archive, SQLite schema-2 tables, storage budgets, backup implementation, planned desktop offload protocol and weather storage rules.
* [Time, outage identity and spatial meaning](time-identity-spatial.md) - UTC/Central time handling, provisional outage identity, disappearance semantics, spatial aggregation, per-capita and weather alignment rules.
* [Trends and anomaly detection](trends-and-anomalies.md) - Metric definitions, customer-minute estimation, anomaly rules, data-quality signals and weather-association principles.
* [A deliberately small dashboard](dashboard.md) - Map-led dashboard design, weather replay and comparison controls, read-only API routes and request limits.
* [Cost and capacity estimates](cost-and-capacity.md) - Selected VM capacity plus the historical September 16 Cloudflare pricing comparison and storage scenarios.
* [Implementation sequence and acceptance criteria](implementation-phases.md) - Phase 1–5 scope, dated status notes, exit criteria and required verification cases.
* [Open decisions and questions for the owner](open-decisions.md) - Settled choices and the remaining optional owner decisions with their defaults or triggers.
