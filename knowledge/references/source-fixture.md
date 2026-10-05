---
type: Dataset Reference
title: "MLGW source fixture"
description: "Provenance of the saved September 16, 2026 MLGW GeoJSON test fixture and its distinction from synthetic storm data."
resource: "../../test/fixtures/ordinary.geojson"
tags: [references, fixture, collection]
status: stable
generated: { by: "codex/unknown", at: 2026-09-16T19:50:30Z }
verified: { by: "process:documentation-review", at: 2026-09-23T04:16:15Z }
sources:
  - id: mlgw-feed
    resource: "https://outagemap.mlgw.org/geojson.php"
    title: "MLGW outage GeoJSON feed"
  - id: stress
    resource: "../../src/stress.mjs"
    title: "Synthetic storm fixture generator"
    last_modified: 2026-09-16T16:37:02Z
---
# Source fixture

`ordinary.geojson` is the decoded response from https://outagemap.mlgw.org/geojson.php retrieved on 2026-09-16 at 16:30:49 UTC (HTTP 200). It contains 16 features and 278 affected customers. The original response and retrieval headers are retained locally in `data/discovery/`.

Tests mutate a copy to exercise invalid counts, IDs, geometry, missing fields, and schema drift. Empty and invalid collection cases are explicit inline fixtures. HTML tests use a minimal constructed representation of the observed desktop/mobile summary markup. Storm fixtures are generated deterministically by `src/stress.mjs` and explicitly labeled synthetic; they are not historical observations.
