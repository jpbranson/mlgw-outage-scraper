---
type: Guide
title: "Outage-location analysis"
description: "Where the point-location audit and location dataset prototype live, what they establish and what is not implemented."
tags: [locations]
status: stable
generated: { by: "codex/unknown", at: 2026-09-22T16:41:52Z }
verified:
  - { by: "process:documentation-review", at: 2026-09-23T04:16:15Z }
  - { by: "claude-code/claude-opus-5-5", at: 2026-10-05T02:45:24Z }
sources:
  - id: builder
    resource: "../../scripts/build-location-dataset.mjs"
    title: "Location dataset builder"
    last_modified: 2026-09-21T17:54:58Z
---
# Outage-location analysis

The September 21 [point-location audit](point-location-audit.md) measured exact recurrence and coordinate/count changes from hash-verified originals. The [location dataset prototype](location-dataset-feasibility.md) provides queryable SQLite and GeoJSON with provenance, and preserves stable identities when extended to later captures. It describes reporting locations and source records; physical service groups and footprints remain unverified. Generated datasets stay local under ignored `data/derived/`; automatic refresh and public dashboard integration are not implemented.
