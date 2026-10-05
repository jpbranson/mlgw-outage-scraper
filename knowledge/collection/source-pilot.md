---
type: Guide
title: "Source pilot and parser files"
description: "Local 24-hour source pilot behavior, resume and backoff rules, and the parser, capture and analysis files."
tags: [collection, pilot, parser]
status: stable
generated: { by: "codex/unknown", at: 2026-09-23T04:17:59Z }
verified:
  - { by: "process:documentation-review", at: 2026-09-23T04:16:15Z }
  - { by: "claude-code/claude-opus-5-5", at: 2026-10-05T02:45:24Z }
sources:
  - id: contract
    resource: "../../src/contract.mjs"
    title: "Portable parser and meaningful-change comparison"
    last_modified: 2026-09-16T16:39:37Z
  - id: pilot-io
    resource: "../../src/pilot-io.mjs"
    title: "Bounded HTTP capture"
    last_modified: 2026-09-23T03:45:42Z
  - id: pilot
    resource: "../../scripts/pilot.mjs"
    title: "Pilot runner"
    last_modified: 2026-09-16T16:45:02Z
---
# Source pilot

`pilot` captures the public GeoJSON and HTML summary every five minutes for a 24-hour window, then stops after a final observation at/after the end. It records each request's own UTC timestamps. `pilot:once` captures one observation while respecting any existing next-due/backoff time. The process must remain running and the PC must stay awake and connected. It does not change Windows power settings, install a service, or start at boot. Network access may need sandbox approval.

The pilot window began September 16, 2026 at 11:37:51 AM CDT and **completed September 17 at 11:40 AM CDT** with its final observation after the 24-hour boundary. The scheduled 12:15 PM CDT review verified **290/290 observed slots**, matching HTML totals and exact archive replay; see [the completed source review](phase-1-source-contract.md). The seven-day collector then continued directly at the 11:45 AM CDT slot. `data/pilot/state.json` preserves the completed window and historical PID; do not restart it as a new pilot. `reports/pilot*.stdout.log` and `reports/pilot*.stderr.log` contain its background output. Verify a PID's identity before stopping any process because PIDs can be reused.

If interrupted before the end of its window, `npm run pilot` resumes from its state, skipping missed slots. It does not fabricate past observations. An expired/completed window must be reviewed before beginning a new one; preserve its directory and reports rather than deleting evidence. A stale process lock is reclaimed only if its owner PID no longer exists. A restriction response (401/403) stops collection and requires source-access review. A 429 pauses both source requests until at least `Retry-After`; transient failures back off. All accepted HTTP bodies are saved before parsing; oversized/time-out responses are recorded as failures.

## Files

- `src/contract.mjs`: portable parser, explicit Central-time assumption with DST ambiguity handling, and meaningful-change comparison.
- `src/pilot-io.mjs`: bounded HTTP capture, selected response headers, hashes, gzip measurements and immutable per-attempt evidence.
- `scripts/analyze.mjs`: observed span/coverage, gaps, byte versus meaningful changes, totals comparisons, ID changes and size distributions.
- `scripts/benchmark.mjs`: ordinary/4,000/10,000-feature tests and reproducible storage scenarios. Windows process CPU is a local diagnostic; it does not establish a Cloudflare CPU pass.
- `scripts/storage-alternative.mjs`: byte-exact gzip/replay verification for all fixture sizes and a capacity model for compressed originals plus a 48-hour normalized cache.
- `test/fixtures/`: a saved public source fixture and its provenance. Tests run without network access.
- `data/discovery/`: initial page, feed and robots responses with retrieval metadata.
- `data/pilot/`: private local capture evidence, attempt records, normalized diagnostic output and state.
- `data/fixtures/`: generated synthetic storm fixtures. They must not be imported as observed outages.
- `reports/benchmark.json`, `reports/pilot-summary.json`: regenerated machine-readable measurements, excluded from version control along with raw pilot data.

The parser emits null totals on invalid IDs/counts or duplicate IDs. It flags invalid/out-of-area geometry without discarding counts. Unknown fields and raw timestamps survive in the original archive. The public display excludes cause text. Production uses pinned parser versions and the versioned SQLite schema described in the [collector guide](collector-guide.md); count-valid captures retain data-quality warnings in the selected-capture note.
