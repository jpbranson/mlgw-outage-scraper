---
type: Checkpoint Report
title: "Derived outage-location dataset: feasibility verified"
description: "September 21, 2026 verified local SQLite/GeoJSON location prototype, source provenance and append-stability checks; its rules drive the Locations view."
tags: [locations, dataset, sqlite]
status: stable
generated: { by: "codex/unknown", at: 2026-09-22T16:41:52Z }
verified: { by: "process:documentation-review", at: 2026-09-23T04:16:15Z }
sources:
  - id: build-verification
    resource: "../../data/derived/location-feasibility-2026-09-21/verification.json"
    title: "Build verification and provenance (local, ignored by Git)"
    last_modified: 2026-09-21T17:56:36Z
  - id: independent-verification
    resource: "../../data/derived/location-feasibility-2026-09-21/independent-verification.json"
    title: "Independent source reconstruction (local, ignored by Git)"
    last_modified: 2026-09-21T18:01:58Z
  - id: extension-verification
    resource: "../../data/derived/location-feasibility-extension-2026-09-21/extension-verification.json"
    title: "Append-stability verification (local, ignored by Git)"
    last_modified: 2026-09-21T18:00:03Z
---
# Derived outage-location dataset: feasibility verified

September 21, 2026. A working local prototype was built and independently verified against the original captures. Exact recurring locations, source-record histories, observed customer-count distributions, and coordinate/count changes can be derived. Actual service-group membership and geographic footprints remain unverified.

## Delivered prototype

The first build uses the same cutoff as the [point-location audit](point-location-audit.md): September 16 at 11:37:51 AM through September 21 at 12:00:19 PM CDT.

| Derived content | Verified result |
| --- | ---: |
| Accepted source captures | 1,417 |
| Traceable feature observations | 12,100 |
| Distinct source outage records | 766 |
| Exact reporting locations | 773 |
| Locations used by different source IDs | 45 |
| Pairs of different source IDs sharing an exact location | 92 |
| Source-record changes, including count/start/location edits and collection breaks | 170 |
| Coordinate changes within those transitions | 67 |
| Candidate nearby record replacements within 250 m | 20, all unconfirmed |

Files:

- Queryable SQLite dataset: `data/derived/location-feasibility-2026-09-21/locations.sqlite`
- Reporting-location GeoJSON: `data/derived/location-feasibility-2026-09-21/locations.geojson`
- Build verification and provenance: `data/derived/location-feasibility-2026-09-21/verification.json`
- Independent source reconstruction: `data/derived/location-feasibility-2026-09-21/independent-verification.json`

The build took **2.83 seconds** on this PC. The SQLite file is **6,045,696 bytes (5.77 MiB)** and the GeoJSON is **302,884 bytes (296 KiB)**. These are prototype measurements for the observed five-day sample, not long-term capacity or storm-load forecasts. The original captures and running collector were opened read-only. Generated data is separate under `data/derived/` and ignored by Git.

## What the dataset makes available

| Table or view | Meaning |
| --- | --- |
| `captures` | Capture time, original totals, body/manifest/parser hashes, and comparison/coverage status |
| `observations` | One row per capture and source outage ID, with exact location reference, count, source start time, impact/status, and geometry issues |
| `sites` | Stable IDs based on exact numeric longitude/latitude, with no rounding or inferred area |
| `record_summary` | First/last observation, coordinate count, observation count, count range, and start-time versions for each source ID |
| `site_records` | Which source records appeared at each exact location and their observed count ranges |
| `site_customer_distribution` | Poll-frequency histogram of customer counts, plus distinct source-record counts for each bin |
| `site_summary` | Recurrence counts, first/last observation, count ranges, and peak simultaneous customer/record totals |
| `episodes` | Observed continuity segments split by absence or a collection break |
| `transitions` | Observed changes within a source ID with both supporting capture references and continuity flags |
| `exact_recurrences` | Pairs of distinct source IDs at the same exact location, retaining whether their observed spans overlap and whether they co-occurred |
| `candidate_turnovers` | A disappearing ID and a newly appearing nearby ID in comparable adjacent captures; always labeled unconfirmed |
| `metadata` | Dataset version, definitions, distance/continuity parameters, input cutoff and provenance digest |

Source start-time corrections do not create additional source records. Collection gaps split observed continuity; they do not prove restoration. Repeated polls do not increase the number of distinct source records or exact recurrence pairs. The customer histogram is explicitly poll-weighted, so longer-lasting records contribute more observations. Per-record ranges and distinct-ID bin counts are also available; a record may occur in multiple bins. Peak customer totals sum only within one capture before taking the peak.

The public feed does not identify individual customer accounts. No field in this dataset should be interpreted as a count of unique people, households, or customers across time.

Example query for recurring locations:

```sql
SELECT site_id, latitude, longitude, source_record_count,
       min_customers_per_record, max_customers_per_record,
       peak_simultaneous_customers
FROM site_summary
WHERE source_record_count > 1
ORDER BY source_record_count DESC, site_id;
```

To inspect the location reused for the 91- and 92-customer records:

```sql
SELECT source_id, first_ms, last_ms, observation_count,
       min_customers, max_customers
FROM site_records
WHERE site_id = 'point:-90.08499,35.0485'
ORDER BY first_ms;
```

Stored numeric timestamps are Unix milliseconds in UTC. The source's raw timestamps and parsed timestamp status are retained separately.

## Inferred relationships have a clear limit

Exact-coordinate reuse and within-ID changes are directly observed relationships. They do not establish that records share a transformer, feeder, customer set, cause, or service area.

The prototype also tests temporal proximity: an ID disappears and a different ID first appears in the next comparable capture. Adding spatial tolerances produces:

| Maximum distance | Candidate pairs |
| --- | ---: |
| Exact same coordinate | 3 |
| 10 m | 3 |
| 25 m | 3 |
| 50 m | 4 |
| 100 m | 4 |
| 250 m | 20 |

The 250 m threshold is an exploratory setting, not a documented resolution or an estimated outage radius. All candidate alternatives are retained. The strong sensitivity to tolerance is a reason to keep candidates separate from observed recurrence and to avoid automatically joining records into physical service groups. The feed alone cannot verify which candidates are real replacements, splits, or merges.

## Validation and updating

Seven focused tests pass. They cover repeated polls, corrected source starts, simultaneous counts, moving records, absent records, collection gaps, failed-attempt boundaries, competing nearby candidates, missing/out-of-area geometry, stable identities when appending observations, and rejected invalid inputs.

A separate Python verifier reconstructed the dataset directly from **all 1,417 hash-verified original feeds**. It compared every observation, customer histogram, exact recurrence pair, material transition, candidate turnover, continuity-segment count, and exported coordinate. Per-capture totals reconcile, foreign-key checks report no errors, and SQLite integrity checks pass.

A second build extended the cutoff to **12:55:31 PM CDT**. It contains **1,428 captures, 12,207 observations, 772 source IDs, and 779 locations**. It took **2.56 seconds**. The extension retained all original capture rows, observations, location IDs, and transitions through the first cutoff unchanged. Existing continuity-segment identities were retained while their last-seen times could advance. Extension verification: `data/derived/location-feasibility-extension-2026-09-21/extension-verification.json`.

This proves that the dataset can be refreshed from additional archived captures. The prototype rebuilds into a new directory; incremental database updates, automatic refresh, and dashboard integration are not implemented by this feasibility task.

## Reproduction

Implementation: [builder CLI](../../scripts/build-location-dataset.mjs), [dataset module](../../src/analysis/location-dataset.mjs), [independent verifier](../../scripts/verify-location-dataset.py), and [tests](../../test/location-dataset.test.mjs).

```powershell
node --test test/location-dataset.test.mjs
node scripts/build-location-dataset.mjs 2026-09-21T17:00:19.255Z data/derived/location-feasibility-rebuild
& 'C:\Users\jpbra\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe' scripts/verify-location-dataset.py data/derived/location-feasibility-rebuild
```

Use a fresh output directory; the builder refuses to overwrite an existing dataset. Omitting arguments uses the history available at invocation and a timestamped output directory. It requires only the existing Node runtime and local archive. All required source reads verify body, manifest, and parser hashes before publication; a verification failure aborts rather than silently dropping captures.
