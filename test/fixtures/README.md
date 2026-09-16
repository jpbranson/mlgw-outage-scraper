# Source fixture

`ordinary.geojson` is the decoded response from https://outagemap.mlgw.org/geojson.php retrieved on 2026-09-16 at 16:30:49 UTC (HTTP 200). It contains 16 features and 278 affected customers. The original response and retrieval headers are retained locally in `data/discovery/`.

Tests mutate a copy to exercise invalid counts, IDs, geometry, missing fields, and schema drift. Empty and invalid collection cases are explicit inline fixtures. HTML tests use a minimal constructed representation of the observed desktop/mobile summary markup. Storm fixtures are generated deterministically by `src/stress.mjs` and explicitly labeled synthetic; they are not historical observations.
