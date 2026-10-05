---
type: Design Section
title: "Implementation sequence and acceptance criteria"
description: "Phase 1–5 scope, dated status notes, exit criteria and required verification cases."
tags: [design, phases, acceptance]
status: stable
generated: { by: "codex/unknown", at: 2026-09-23T04:17:59Z }
verified: { by: "process:documentation-review", at: 2026-09-23T04:16:15Z }
---
# 10. Implementation sequence and acceptance criteria

## Phase 1: establish the source contract

**Current execution scope, September 22:** the selected DigitalOcean deployment is complete, including constrained Linux tests, canonical-archive restore, public HTTPS checks and a downloaded-backup restore. The Cloudflare free-tier criteria below are retained as the original alternative evaluation; they are not pending launch gates for the selected VM.

**Local observation review completed September 17, 2026:** see [Phase 1 status and measurements](../collection/phase-1-source-contract.md). All 290 expected slots in the 24-hour observed span were valid, HTML totals matched, and every pilot capture replayed from the durable archive. Eight IDs had corrected start times and 27 had coordinate changes; event identity and location remain provisional. Local storm benchmarks flag CPU risk for an ordinary free Worker. A free Durable Object and compressed originals with a 48-hour normalized cache remain candidates. The revised 10,000-feature reserve scenario is approximately **6.09 GB including retained HTML**, superseding the earlier incomplete 5.47 GB estimate; weather and provider account usage remain separate. At that September 17 checkpoint, the Cloudflare-specific gate remained open and the local trial continued. The subsequent VM deployment supersedes the hosting choice; it does not claim the unrun Cloudflare benchmark passed.

- Capture representative fixtures and measure feed updates for at least 24 hours at five-minute intervals.
- Verify source field meanings, timezone assumptions, ID stability, and completeness checks; compare the feed total with the HTML summary using independently recorded times.
- Measure payload bytes, compression, and Worker CPU on ordinary, 4,000-feature, and 10,000-feature inputs. The first stress case reflects the observed legacy peak; the larger is a headroom probe, not a prediction of maximum storms.
- Confirm that the protected year plus at least 30 days of offline-PC headroom, transfer staging, and cleanup grace fits free storage under the chosen cadence and storm model. Evaluate free-tier compute alternatives if Workers fails its CPU target.
- Validate the provisional five-minute cadence and storage model against measured captures. The provisional archive directory is recorded in the [requirements table](recommended-approach.md#confirmed-requirements-and-remaining-setup-choices); its installation capacity check belongs to Phase 4B. Audience, indefinite-detail intent, free-first priority, and irregular PC availability with 30 days of headroom are already settled.

**Original free-tier exit criterion:** the proposed free runtime and protected-year storage had to pass their measured limits. That $0 design was not accepted. The owner subsequently selected the paid VM, whose actual deployment checks are recorded separately; long-term storm growth and storage headroom still require observation.

## Phase 2: durable collection

**Local execution started September 16, 2026:** see [Phase 2 status](../collection/phase-2-durable-collection.md). Immutable gzip archives, parser-version replay, a compact SQLite index, leases/retries, bounded rollup maintenance and freshness/pressure reporting were implemented with 34 passing tests at that checkpoint. The September 17 review verified all 290 mirrored pilot captures and seven direct captures after a successful handoff, with 100% observed slot coverage and a 297-snapshot isolated restore. The September 18 continuation restored 602/602 captures at its 18:40 UTC cutoff. The local run was later stopped for cloud cutover on September 22, without a seven-day acceptance claim. Production restored 1,722 attempts / 1,635 snapshots before collecting on its independent continuous schedule. The local `collector:accept-trial` evaluator does not accept a handoff as trial completion.

- Implement versioned parsing, immutable filesystem capture, SQLite summaries, idempotency, bounded retries and freshness reporting.
- Deploy separate development and production resources with environment-specific bindings and narrow deployment credentials.
- Add incremental rollups, pressure-based retention configuration, and a replay path for archived captures. No unconditional one-year expiration.
- Run a seven-day collection pilot before relying on the service.

**Exit:** target at least 99% successful scheduled observations while the source is reachable, with no unexplained gap over 15 minutes. Report all gaps and source failures separately; this is an operating target, not a free-hosting SLA.

## Phase 3: dashboard and descriptive analysis

**Local implementation completed September 16, 2026:** see [Phase 3 status](../dashboard/phase-3-dashboard.md). The loopback dashboard provides linked historical maps/totals/charts, a density heatmap, Census block-group per-capita maps, bounded exports, explained anomaly rules and coverage indicators. That checkpoint had 67 passing tests and desktop/mobile-viewport checks; its dashboard changes were committed in `f9c42e3`. The 24-hour pilot completed, and the local collector subsequently handed off to the VM. September 17/18 preview sessions are historical. Public HTTPS serving was verified on DigitalOcean on September 22. Weather checkpoints and Phase 4A audit progress are recorded below; separate dashboard publication of legacy history completed September 18.

- Build the one-page dashboard, time-linked map/chart, historical retrieval, and bounded exports.
- Add the simple anomaly rules with visible explanations and coverage flags. Enable the robust baseline only after enough history exists.
- Preserve historical heatmap and Census per-capita views, provisional event identity, uncertainty and coverage semantics.
- Preserve the verified production boundary: raw archive/admin/write routes are unavailable publicly, and administration/backups use SSH. Recheck that boundary after server or proxy changes.

**Exit:** selecting a timestamp available to the serving archive reproduces its archived spatial state and totals; charts display failures as gaps; a desktop and mobile browser can use the page without downloading unbounded history. Public route checks against cloud-resident data passed at deployment and after the audit release. Browser automation was unavailable at the initial handoff; the later audit release passed four desktop/phone Playwright cases, with Windows/Linux CI now configured to run them.

## Phase 3A: local weather sources, radar replay and rainfall history

**Source/cache and dashboard checkpoints implemented September 16–17, 2026:** see [Phase 3A findings](../weather/phase-3a-weather-sources.md). Timestamped radar originals, numeric one-hour MRMS subsets, GHCNh station files and MEG warning samples replay through an isolated bounded local cache. Synchronized layers and a regional 24-hour temperature/wind plot passed desktop/phone checks and 86 tests at that checkpoint. Its GHCNh snapshot ended August 26; the later retained revision reaches September 9. Subsequent accumulation, period, quality and event checks are recorded below. Study preparation remains explicit and bounded; September 18 adds the separate rolling display-weather runner through the trial end. This stage depends on local Phase 3 interfaces, not cloud deployment, desktop transfer or legacy import.

**Earlier numeric rainfall checkpoint, September 17, 2026:** [48/72-hour results](../weather/rainfall-accumulation.md) reproduced 72 originals and 302,400 hourly cell values with an independent decoder, preserved missing intervals/cells, and validated native-cell area intersections for all 685 Census block groups. At that checkpoint one boundary area was partly outside the crop, 95 tests passed, and the cache used 134.0 MiB. The subsequent dashboard checkpoint below supersedes that extent, test count and cache size; the old measurements remain historical evidence.

**Rainfall dashboard checkpoint implemented September 17, 2026:** [results](../weather/rainfall-dashboard.md) close that boundary gap using saved originals, cover all 685 block groups, and expose prepared 24/48/72-hour rainfall with exact periods, coverage, native-cell inspection and a matching outage-history chart. At that checkpoint the sample had no imported outage captures; current-feed rainfall charts still show no captures for those historical dates, while separate legacy/comparison pages now supply regional totals. All 99 tests and desktop/phone checks passed; 345,600 expanded hourly cell values were independently verified. The cache used about 140.0 MiB at that cutoff. Broader period preparation, the prolonged-rain case, separate legacy publication, four Phase 5 cases and bounded automatic display-weather refresh subsequently completed.

**Broader weather checkpoint, September 17, 2026:** [period validation](../weather/weather-periods.md) adds selectable 24/48/72-hour windows, resumable bounded batches and atomic multi-period publication. A 72-hour Francine case has complete rainfall coverage for all 685 block groups, 42 wet hours across three UTC days and independent verification of 345,600 hourly values. Explicit station refresh preserves prior revisions; the newer 2026 GHCNh snapshot reaches September 9. Desktop/phone checks and 109 test entries passed at that checkpoint. Its roughly 223.5 MiB use under the original 256 MiB cap prompted the storage work below. Bounded station-quality, event/zone-warning checks and rolling weather refresh/retention subsequently completed. Additional source families remain open; the later deployment provides continuous cloud weather refresh.

**Storage implementation and pilot revalidation, September 17, 2026:** the [latest checkpoint](../weather/storage-and-pilot-revalidation.md) raises the weather cap to 1 GiB and stores station originals losslessly as gzip under unchanged source identities. Verified migration recovered 78.0 MiB, leaving about 145.7 MiB in use after offline replay. All 168 referenced weather originals verify and 115 test entries pass. The requested pilot revalidation confirms 290/290 valid observations over more than 24 hours; all 354 captures in the combined archive at the new cutoff replay and restore correctly. Existing download limits and source-evidence preservation remain in force. This is local validation; cloud and seven-day acceptance remain separate.

**Station quality checkpoint, September 17 around 7:02 PM CDT:** [station-quality results](../weather/station-quality.md) add source-specific temperature/dew-point, wind/gust and precipitation eligibility. Trace, missing and excluded readings remain distinct; nominal precipitation hours never sum intermediate reports. All 123 tests passed and independent provenance verification matched 641 records / 3,205 field-metadata sets. Unsupported recent source/QC combinations remain excluded from numeric comparisons. Cache use was 146.5 MiB of 1 GiB at that cutoff. The next event/zone-warning checkpoint subsequently completed below.

**Event/zone-warning checkpoint, September 17 around 8:00 PM CDT:** [event context results](../weather/event-context.md) complete the bounded source check for six cases, with separate county/forecast-zone identities, explicit CST-6 event times, retrospective warning status and observed archive-month limits. All 134 tests passed; independent checks reproduced 13 finalized events, eight warnings and their geometries. Offline replay reproduced 12 derivative hashes without requests. Cache use was 189.9 MiB of 1 GiB and the collector had 389 valid slots at that cutoff. Phase 4A audits subsequently completed; separate legacy dashboard integration and the initial matched comparisons subsequently completed.

- Validate the documented radar, MRMS, station and event/warning sources with bounded samples. Confirm actual archive coverage, valid-time conventions, projections, units, quality flags, product versions and reuse/caching conditions; record source manifests.
- Implement isolated weather retrieval, bounded local caches and numeric subset storage with checksums, retries and availability reporting. Weather failures must leave outage collection and replay intact.
- Add synchronized historical radar, opacity/legend controls and supported preceding rainfall totals. Label reflectivity separately from estimated rain depth, and display exact matched times/intervals and missing data.
- Add storm-period selection and synchronized rainfall/outage map comparison. Support the current archive first; do not require historic weather to be captured prospectively alongside each outage poll.
- Add a compact regional weather timeline using stations with adequate coverage, including temperature, wind/gusts and available precipitation-type observations. Retain event/warning context with explicit provenance; comprehensive condition comparisons remain Phase 5.
- Validate wet/dry periods, a frozen-precipitation example for interpretation/quality handling, a source outage, timestamps around DST and a multi-day rainfall window. Historical weather-only examples must not invent matching outage records.

**Exit:** selected outage captures and storm windows reproduce eligible weather images/numeric summaries with explicit timestamps, units, native resolution and coverage; missing frames cannot look like confirmed dry weather. Regional station data keeps its location/quality flags. Desktop and phone controls remain readable, weather storage/work stays bounded, and collector continuity is unaffected. Report a local checkpoint before broadening implementation scope.

## Phase 4: legacy history and desktop retention

Split this phase into independent tracks so weather analysis can use older local outages without waiting for cloud retention work.

### Phase 4A: legacy history import

**Current status:** [overlap/staging](../legacy/repository-audit.md), [timezone recovery](../legacy/timezone-recovery.md) and [bounded capture coverage](../legacy/coverage-audit.md) are complete. The verified catalog resolves 53,273 totals and all 18,906 grid snapshots. One consolidated timestamp and one additional nonempty original remain exceptions. The availability catalog inventories 53,679 captures across six selected trees; it is not an exhaustive scan of every commit. The [separate legacy dashboard](../legacy/legacy-dashboard.md) now serves all verified totals and grid snapshots with source boundaries, missing intervals and exclusions. Its read-only publication is independent of the live collector. Four regional rainfall/wind/cold/heat cases and original-grid cold summaries are complete in Phase 5; broader supported comparisons require additional compatible evidence.

- Import deduplicated legacy total-count observations and supported grid snapshots through a separate versioned adapter. Preserve original RDS/RData files and provenance; do not run the old scraper or copy its credentials/configuration into the new deployment.
- Populate historical storm comparisons with the measured 2022–2025 observations, explicitly marking gaps, unavailable geometry, and source-format differences. Do not assume the current checkout contains every older raw file referenced by the consolidated data.
- Audit totals and spatial coverage independently, reconcile timestamp/DST conventions, and expose the original grid geometry. Pair verified legacy periods with Phase 3A weather; total-only periods support regional comparisons only. Weather backfill does not fill outage gaps.

**Exit:** imported observations reproduce the preserved legacy totals and supported geometry without duplicated events, fabricated locations or hidden coverage gaps. Current-feed and legacy measures remain distinguishable. This local track can feed Phase 5 independently of Phase 4B.

### Phase 4B: verified desktop transfer and cloud retention

**Local transfer core and scheduled full cloud backups are implemented; automated offload remains uninstalled.** The [autonomous checkpoint](../weather/autonomous-continuation.md) implements bounded bundles, resumed downloads, hashes, SQLite receipts, restore, authenticated verification and non-executable retention eligibility, and replays an actual 89-capture transferred partition. Cloud archive access and an ACL-protected SSH key are available. The separate full-backup command has passed download and restore verification, runs through the installed Windows task and records verified backup receipts on the VM. Partition-offload receipt transactions, cleanup journals, a final long-term destination and installation of the offload worker remain future work. This is independent of local weather analysis.

- Install the Windows archive downloader, receipt protocol, cloud archive catalog, and pressure-triggered cleanup. Keep detailed historic maps available in the cloud while capacity permits.
- Exercise offline/resumed downloads, a full disk, corrupted parts, duplicate receipts, protected-year boundaries, and restoration of a transferred historical map before enabling cloud cleanup.

**Exit:** every removed cloud payload has a verified, readable desktop copy; the newest year stays cloud-resident; public charts retain long-term summaries and accurately identify PC-only detail.

## Phase 5: weather-condition comparisons and historical case studies

**Autonomous continuation, September 18:** [cold/heat comparisons, native-grid cold summaries and bounded weather maintenance](../weather/autonomous-continuation.md) are now implemented and independently verified. The bounded additional rainfall/wind screen found no eligible case without changing policy. Missing snow/ice coverage, one temperature case per category, regional station precision and the old archive gap limit broader conclusions. The earlier initial-case checkpoint below remains dated evidence.

**Earlier rainfall/wind checkpoint, September 18, 2026:** [two regional case studies](../weather/comparisons-initial.md) provide aligned hourly charts, backward-only 0/1/3-hour additional lags, condition groups, joint coverage, source hashes and downloads. The [matched reference checkpoint](../weather/matched-references.md) adds calendar/capture/weather selection independent of outage levels, paired snapshots, shared lag rules, visible exclusions and CSV exports. Both rainfall/wind cases lack outage geometry and sufficient interruption-burden coverage; those measures remain unavailable. The later continuation adds cold/heat studies and supported native-grid cold summaries. Additional independent storms, snow/ice cases and richer geographic analysis remain constrained by coverage and source compatibility. Phase 5 depends on Phase 3A weather and verified outage coverage. Phase 4A is required for legacy-period comparisons; sufficiently observed current-format episodes can be analyzed without it. Phase 4B and permanent cloud hosting are independent.

- Define and version episode boundaries, condition labels, lags, reference periods and joint coverage rules. Include heavy/prolonged rainfall, flash-flood episodes, wind, snow, ice/freezing rain, heat waves and cold without treating warning/derived labels as observed damage.
- Join native-resolution weather to the current point/grid history and the separate legacy polygons. Preserve Census population vintages and margins of error; do not redistribute legacy area customer totals into block groups without support.
- Compute newly reported event frequency, observed customer-hours and peaks over matched weather/outage periods, with exposure hours, per-capita context, existing-outage carryover and uncertainty. Apply the existing interruption-burden gap rules.
- Build condition/episode filters, aligned time-series comparisons, and area-by-condition maps or a compact comparison matrix. Start with rainfall/wind case studies, then winter and heat episodes as verified coverage allows.
- Validate results against saved inputs and manually checked cases. Test exposure-matched comparisons, sparse categories, multi-hazard episodes, denominator/vintage changes and the October 2020 MRMS product transition where relevant. Keep incompatible source formats separate.

**Exit:** a saved comparison is reproducible from its source manifests and metric versions; maps and summaries show weather/outage coverage, native resolution, population vintage and sample size. Sparse data remains a case study, and findings are presented as associations rather than verified causes or official utility reliability measures.

## Required verification

- Parser fixtures: empty valid feed, malformed JSON, missing/blank fields, duplicate IDs, invalid counts/coordinates, and schema changes.
- Time fixtures: explicit source format, Central daylight/standard time, ambiguous DST values, and missing restoration estimates.
- Pipeline cases: repeated slot, overlapping/delayed run, 429 backoff, failed archive write, failed SQLite commit, raw capture awaiting processing, and replay without double-counting.
- Analytics cases: unchanged observations, genuine zero, suspicious empty feed, an outage disappearing/reappearing, partial coverage, and correct customer-minute bucket boundaries.
- Operational checks: storm-size resource use, cost telemetry, stale-data banner and heartbeat detection, public-read quota protection, and a restore/replay exercise from archived data.
- Retention checks: desktop offline for 30 days under the storage-growth model, successful catch-up after it returns, partial downloads/deletions, checksum mismatch, expired machine credentials, payloads shared with protected observations, and preventing cleanup without a matching verified receipt.
- Weather source/time cases: unavailable versus dry pixels, invalid/late frames, matched-time tolerances, UTC/Central/DST, trace/missing precipitation, rate/depth unit conversion, rolling accumulation overlap, product revisions and failed numeric downloads.
- Weather spatial/analysis cases: raster CRS and partial-cell overlap, no extrapolation of station precision, legacy-grid versus current-point joins, incomplete joint coverage, interval-bounded event onset, carried-over outages, lag windows, overlapping hazard labels, exposure normalization, sparse independent episodes and reproducible saved comparisons.
- Weather operations/UI: isolated download/processing budgets, archive retention changes, cache misses without live-data substitution, no arbitrary upstream fetches, wet multi-day resource use, map-layer legends/opacity, synchronized views and phone layout, and proof that weather failures do not disrupt outage capture.

Future optional additions should be driven by use: one-minute storm collection, more detailed geographic comparisons, or notifications. Weather replay/analysis now has explicit planned stages. Indefinite detailed retention with verified desktop offload remains part of the planned production system. Preserve the small dashboard and reliable collection path as the core of the project.
