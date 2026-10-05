---
type: Audit Report
title: "Outage point recurrence and spatial resolution"
description: "September 21, 2026 exact-location recurrence, coordinate-change, precision and IMPACT-label evidence from 1,417 captures; no inferred service territories."
tags: [locations, audit, spatial]
status: stable
generated: { by: "codex/unknown", at: 2026-09-22T16:41:52Z }
verified: { by: "process:documentation-review", at: 2026-09-23T04:16:15Z }
sources:
  - id: point-audit
    resource: "../../reports/point-location-audit.json"
    title: "Point-location audit (local, ignored by Git)"
    last_modified: 2026-09-21T17:08:22Z
  - id: aggregation-check
    resource: "../../reports/point-location-aggregation-check.json"
    title: "Merge/split aggregation check (local, ignored by Git)"
    last_modified: 2026-09-21T17:06:23Z
  - id: independent-check
    resource: "../../reports/point-location-independent-check.json"
    title: "Independent Python check (local, ignored by Git)"
    last_modified: 2026-09-21T17:05:34Z
---
# Outage point recurrence and spatial resolution

Audit prepared September 21, 2026. The current feed contains recurring exact locations and locations that change as affected-customer counts change. The observed coordinates do not establish fixed outage footprints or a recoverable block-sized grid.

## Data and method

- Read-only analysis of **1,417 accepted captures**, September 16, 2026 at 11:37:51 AM through September 21 at 12:00:19 PM CDT (16:37:51.973Z through 17:00:19.255Z).
- **12,100 feature observations**, **766 distinct source outage IDs**, and **773 exact coordinate pairs**. No invalid/out-of-review-area geometries were excluded.
- The archive covers **1,417 of 1,446 expected five-minute slots (98.0%)**. There is one gap of about 150 minutes on September 20, from 1:05 PM to 3:35 PM CDT. Five-minute polling also misses events between polls.
- Each original feed was verified against its archived hash, its manifest against the database, and replayed through its archived parser to reconcile outage and customer totals.
- Locations are compared as exact numeric longitude/latitude pairs. No rounding or proximity clustering is used to claim exact recurrence.
- Source IDs are counted once even when their reported start times are revised. There are 796 ID/start pairs, demonstrating why counting those as independent outages would inflate this audit's distinct-record count.
- Different source IDs do not prove independent physical incidents: reopening, splitting, merging, or other source bookkeeping could generate another ID. No address, meter, transformer, feeder, or customer identities were inferred.

Reproduce the fixed cutoff with:

```powershell
node scripts/analyze-outage-locations.mjs 2026-09-21T17:00:19.255Z
```

The script opens SQLite and the archive read-only and writes `reports/point-location-audit.json`. Omitting the timestamp analyzes history available at invocation. No collector, dashboard, or source capture is changed.

## Exact location reuse

| Measurement | Result |
| --- | ---: |
| Exact coordinate pairs used by multiple outage IDs | 45 of 773 (5.8%) |
| Distinct IDs appearing at those reused locations | 104 of 766 (13.6%) |
| Most different IDs at one exact location | 8 |
| Reused sites with exclusively single-customer records | 25 |
| Reused sites with at least one multi-customer record | 20 |
| Reused sites with two IDs present simultaneously | 0 |
| Repeatedly observed IDs that stayed at one coordinate | 453 of 511 (88.6%) |

All first/last observed spans of different IDs at the same exact site were disjoint. These are distinct source records appearing at different observed times, rather than counting the same record in successive polls. This does not establish restoration between records.

There were 255 IDs seen in just one capture; these cannot establish within-record location stability. Across all IDs, 708 used one coordinate and 58 used multiple coordinates.

Two examples from the public source:

- **35.21910, -90.00509:** eight source IDs over about 34 hours, all reporting one affected customer. The repeated IDs are 1533752, 1533834, 1533839, 1533848, 1533860, 1533977, 1533981, and 1533985.
- **35.04850, -90.08499:** ID 1533274 was observed on September 16 with 91 customers; ID 1533973 was observed on September 18 with 92 customers. The identical point therefore recurs for a substantial group as well as for single-customer reports. It does not prove that the two customer sets are identical.

These observations support treating some coordinates as recurring reporting locations. They do not identify the locations as particular utility devices or reveal the area served.

## Coordinate changes and aggregation

**58 IDs changed coordinates**, producing **67 observed location transitions**. All 67 occurred between successive accepted captures no more than ten minutes apart, and **all 67 coincided with a customer-count change**. The median displacement was 104 m; the largest was 4,043 m.

There were 137 customer-count transitions overall in comparable adjacent observations. Seventy changed the count without changing the coordinate. Thus, a location can remain fixed through count changes, and some count changes move the point.

The largest move was ID **1533882**, on September 17 around 7:35 PM CDT:

| Observation | Customers | Latitude, longitude |
| --- | ---: | --- |
| 7:30:15 PM CDT | 2,413 | 35.01180, -89.83567 |
| 7:35:22 PM CDT | 5 | 35.02725, -89.87586 |

This is evidence that the source's representative location can change when the represented outage changes. It is not evidence that an outage traveled 4 km, nor an estimate of location error or footprint size.

An exploratory merge/split check looked for one or two disappearing/appearing records whose counts exactly explained a continuing ID's count change, then tested whether the points matched a customer-count-weighted center within 3 m. Five moving transitions had count-matching candidates; none matched that center criterion. This limited check does **not** recover MLGW's location algorithm or establish that customer-level centroids are impossible. The feed does not expose the customer sets needed for that conclusion. Details are retained in `reports/point-location-aggregation-check.json`.

## Published coordinate precision

Every observed coordinate is expressible in increments of **0.00001 degrees**. At Memphis latitude, that corresponds to approximately **0.91 m east/west and 1.11 m north/south**. Trailing zeroes explain the points printed with fewer decimal places.

This is numerical precision, not a one-meter accuracy guarantee. The 773 locations contain 756 distinct longitude values and 743 distinct latitude values. Integer coordinate differences have a greatest common divisor of one 0.00001-degree increment on each axis. The distribution does not support a common, coarser latitude/longitude grid. This does not rule out other undisclosed generalization or location-selection rules.

Nearest distinct-coordinate spacing ranges from 0.91 m to 6.30 km, with a median of 172 m. That spacing reflects the observed outage locations and some source revisions during this five-day window. It cannot be interpreted as a cell width, territory boundary, or service radius.

## Area descriptions appear to follow customer-count bands

The source's `IMPACT` labels have disjoint observed count ranges. Across all 12,100 observations, no customer count was associated with more than one label.

| Label | Observed affected-customer range |
| --- | ---: |
| Single Customer | 1 |
| Half a Block | 2–4 |
| One Block | 5–12 |
| A Couple of Blocks | 13–24 |
| A Few Blocks | 25–48 |
| A Neighborhood | 51–213 |
| A Couple of Neighborhoods | 444–498 |
| A Few Neighborhoods | 647–2,428 |
| Several Neighborhoods | 2,852 |

These are **observed ranges**, not proven thresholds for unobserved counts. The consistency suggests count-based descriptive categories; it does not prove source code behavior. The labels should not be used as measured spatial extents.

## What can reasonably be inferred

The data can support a catalog of recurring reporting coordinates, source-ID recurrence at each location, affected-customer distributions, and how locations change as counts change. Exact matching gives a conservative starting point; nearby-location grouping should be tested at several tolerances and kept separate from exact recurrence.

A longer history could help distinguish frequently reused reporting locations from occasional points. It would still not make the surrounding territory observable. Voronoi cells, equal-radius circles, and count-to-area conversions would introduce spatial assumptions. Actual footprints require additional evidence such as documented MLGW location semantics, affected-customer geography, or applicable network/service-area boundaries.

## Verification

A separate Python implementation independently read and SHA-256-verified all 1,417 selected originals and reproduced the observation count, distinct IDs, distinct coordinates, reused-site count, and IDs with multiple locations. It also independently confirmed the coordinate-axis counts and minimum common coordinate increments. Results are retained in `reports/point-location-independent-check.json`.
