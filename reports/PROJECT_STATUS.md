# Current project status

Documentation reviewed September 17, 2026 against the working tree, configuration, saved evidence and running services. Runtime figures below are timestamped observations; use the status commands for fresh results. This review updates documentation only and does not start another implementation phase.

## Implemented and operating

| Component | Verified state | Source of fresh status |
| --- | --- | --- |
| Phase 1 source pilot | Active at 11:17 UTC / 6:17 AM CDT; 225 attempts, no recorded failures. Window: September 16 16:37:51.713 UTC through September 17 16:37:51.713 UTC, with a final observation at/after the end. | `data/pilot/state.json`; `npm run analyze` recalculates the saved observation report. |
| Phase 2 durable collector | At 11:16:48 UTC: 225 valid captures, 100% slot coverage over the observed span, no gaps over ten minutes, no queued rollup days, healthy heartbeat and storage. Still mirroring the pilot. Seven-day window ends September 23 at 17:04:02.511 UTC / 12:04:02 PM CDT. These early results do not complete the seven-day acceptance test. | `npm run collector:status`; `data/collector/run-state.json`. |
| Dashboard | Local read-only server at `http://127.0.0.1:4173`. One capture, Heatmap, Per capita and Rainfall modes are implemented. Latest captured data and historical replay stay separate. | `/api/health`; background logs `reports/dashboard.rainfall.stdout.log` and `reports/dashboard.rainfall.stderr.log`. |
| Weather | Prepared radar, one-hour rainfall and a regional KMEM temperature/wind plot; manual preparation only. No continuous weather collector. Current outage captures can have no eligible prepared weather. | `/api/weather?at=<explicit-UTC-timestamp>`; ignored `data/weather/cache/published/catalog.json`. |
| Multi-day rainfall | Prepared 24/48/72-hour intervals ending June 27, 2023 at 00:00 UTC. Expanded 80 × 60 native grid covers all 685 Census block groups. No corresponding 2023 outage history has been imported; missing outage coverage is explicit. | `/api/weather/periods`; [rainfall dashboard checkpoint](RAINFALL_DASHBOARD_STATUS.md). |
| Remote access | September 17 Quick Tunnel closed at the user's request; shutdown verified at 12:29:59 UTC / 7:29:59 AM CDT. Supervisor and tunnel processes exited; the local dashboard remains healthy. | `npm run preview:status`; ignored `data/remote-preview/state.json`. |

The PC must remain awake and connected. No Windows service, startup task or power-setting change was installed. The source pilot, durable collector, dashboard and preview are separate processes; verify a PID's command line before stopping it.

## Temporary preview session

The September 16 session expired automatically. The replacement requested September 17 began at **5:57:53 AM CDT** (`10:57:53.318Z`) and was **closed at the user's request**, with shutdown verified at **7:29:59 AM CDT** (`12:29:59Z`). The supervisor records `owner_requested`, and both preview processes exited. Its originally scheduled 1:57:53 PM CDT expiry is no longer relevant to access. No replacement session was started.

Use `npm run preview:status` for the current URL and session state. Credentials remain in chat and ignored `data/remote-preview/credentials.json`; no password is stored in these documents. Use the URL and password from the same session. Login was verified in a browser on September 17, and the user confirmed it worked. `npm run preview:stop` stops only the gateway and its tunnel child.

The external verifier passed at **11:09:32 UTC**: password form/login, secure session cookie, anonymous API/asset denial, matching outage totals/geometry, blocked archive/admin/write routes, HTTPS redirection, and all three rainfall periods and PNGs. Browser sign-in also loaded live capture data without console warnings/errors. Evidence: ignored `reports/preview-verification.json`. The full operating procedure and login troubleshooting are in the [README](../README.md#temporary-phone-preview).

## Verification and documentation audit

- `npm test`: **99/99 passed** on September 17; output in ignored `reports/documentation-tests.log`.
- `npm run dashboard:typecheck`: passed. The preceding rainfall checkpoint also passed the frontend build and desktop/phone-viewport checks; this documentation-only review did not rebuild or restart the serving processes.
- Reviewed all **12 first-party Markdown documents**. Automated checks resolved **49 local links**, both referenced local anchors, **22 documented npm scripts** and seven explicit script-path references with no errors. API routes, port/environment settings, weather limits and preparation flags were also checked against their implementations. Automated results are in ignored `reports/documentation-audit.json`.
- Checked the saved Census reference metadata (685 areas, 919,173 residents, 587,705 compressed bytes), source fixture (16 features, 278 customers), local Inter font and bundled license. Their provenance READMEs remain accurate and were left unchanged; the license text was not altered.
- Verified the existing `review-mlgw-phase-1-pilot` follow-up configuration is active for **September 17 at 12:15 PM CDT**. It reviews the source pilot, durable collector and implemented dashboard in its existing Codex thread; it does not authorize another deployment or Phase 4. No automation settings changed in this review.

The audit distinguishes operating instructions from historical evidence and future design. Provider pricing/allowance tables and source-discovery measurements retain their stated September 16 research dates; this review did not repeat external pricing research or download source datasets. Recheck provider terms, quotas and runtime behavior before permanent cloud deployment. Local tests and a working Quick Tunnel do not establish cloud compute/storage feasibility.

## Documentation index

| Document | Purpose |
| --- | --- |
| [README](../README.md) | Current commands, prerequisites, local operation, weather preparation and temporary preview procedure. |
| [Design plan](../DESIGN_PLAN.md) | Confirmed requirements, implemented interfaces, future production design and acceptance criteria. |
| [Phase 1](PHASE1_STATUS.md) | Dated source contract, pilot, local benchmark and storage-feasibility evidence. |
| [Phase 2](PHASE2_STATUS.md) | Durable archive/index behavior, initial restore evidence and seven-day trial criteria. |
| [Phase 3](PHASE3_STATUS.md) | Chronological dashboard, preview, visual-design and spatial-map implementation checkpoints. |
| [Phase 3A](PHASE3A_STATUS.md) | Source/cache and single-capture weather findings; earlier crop/version measurements are historical. |
| [Rainfall accumulation](RAINFALL_WINDOW_STATUS.md) | Original 4,200-cell numeric/spatial checkpoint, superseded by the expanded extent. |
| [Rainfall dashboard](RAINFALL_DASHBOARD_STATUS.md) | Current 4,800-cell extent, 24/48/72-hour controls, verification and remaining weather work. |
| [Census reference](../reference/README.md) | Population/boundary vintages, provenance, joins and interpretation limits. |
| [Source fixture](../test/fixtures/README.md) | Saved fixture provenance and distinction from synthetic stress data. |
| [Font](../web/fonts/README.md) and [license](../web/fonts/OFL.txt) | Local Inter asset provenance and its original license. |

Ignored machine-readable reports may be overwritten when commands run again. Dated Markdown checkpoints preserve their measured counts, processing versions, cache sizes and timings; do not reinterpret those as current live readings. Use `git status` and `git log` for the current commit state; documentation verification alone does not imply changes have been pushed.

## Remaining work

1. Complete the 24-hour source review and the existing seven-day collector trial. Evaluate actual coverage, source behavior, gaps, storage growth and recovery rather than treating elapsed time alone as acceptance.
2. Broaden bounded rainfall-period preparation and validate a prolonged-rain case with resource, interruption and coverage checks. Station revision/refresh handling and broader event/quality validation remain Phase 3A work.
3. Import verified legacy outage history separately in Phase 4A before comparing older outages with weather. General weather-condition comparisons remain Phase 5; automatic weather collection is not implemented.
4. Keep permanent cloud hosting/collection/storage, provider runtime/quota validation, and Phase 4B desktop transfer/cleanup deferred until requested. Temporary Quick Tunnel access does not complete those stages.
