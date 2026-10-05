---
type: Design Section
title: "Time, outage identity and spatial meaning"
description: "UTC/Central time handling, provisional outage identity, disappearance semantics, spatial aggregation, per-capita and weather alignment rules."
tags: [design, time, identity, spatial]
status: stable
generated: { by: "codex/unknown", at: 2026-09-22T16:41:52Z }
verified: { by: "process:documentation-review", at: 2026-09-23T04:16:15Z }
---
# 6. Time, outage identity, and spatial meaning

Store observation times as UTC instants; display them in `America/Chicago`. The current GeoJSON feed's outage start/repair strings lack explicit offsets; preserve them and record the provisional Central-time interpretation. Legacy capture timestamps follow the separately verified source-version/original-epoch rules, and must not inherit that blanket assumption. Use explicit format/time-zone parsing, retaining unresolved fall-back ambiguity rather than inventing an instant.

Use `(OUTAGE_NO, reported start time)` as a provisional event key. Test its stability across the pilot. If a start time is corrected or an ID disappears and reappears, retain the source observations and mark identity uncertain; do not silently invent a new confirmed event or merge unrelated incidents.

An outage disappearing from a complete snapshot means **no longer reported**, not a confirmed restoration. Optionally confirm disappearance on the next valid snapshot, but retain the first-absence observation time. Invalid/incomplete captures cannot close outages. The interval between last seen and first absent bounds the observed disappearance; actual restoration time remains unknown. Duration statistics should distinguish source-reported start time, first observation, last seen, first absent, and still-active events.

Validate GeoJSON coordinate order as `[longitude, latitude]` and normalize for the mapping library at the boundary. Preserve original point geometry and precision. These points are approximate reported locations; they are not customer addresses or outage-boundary polygons. If the feed later changes geometry type, archive it and flag the schema change before publishing unsupported geometry.

For spatial trends, aggregate reported point locations into a versioned grid of roughly 1 km cells, with consistent projected boundaries. Store the grid definition once. Label results as “reported outage activity near this location.” Do not infer service areas from marker circles or claim all affected customers reside inside a point's grid cell. Neighborhood/ZIP summaries can follow if trustworthy boundaries are selected; counts without customer-population denominators are not neighborhood reliability rates.

The implemented per-capita view uses 2020–2024 ACS B01003 population estimates, margins of error and matching 2024 Census block groups; see [reference provenance](../references/census-block-groups.md). It reports provisional events or peak simultaneous customers per 1,000 estimated residents. Utility accounts are not people, and approximate outage points may represent accounts across boundaries. These are location-based normalized counts, not official reliability rates or resident outage percentages. For older analyses, retain the population/boundary vintage and explicitly label any fixed modern denominator applied to earlier years.

Weather alignment must preserve its native precision. Join each radar frame to an eligible outage observation with both timestamps and the offset visible. Default replay to the latest available frame at or before the selected time, with a small product-specific tolerance established during source validation; never silently fall back to live imagery or an arbitrarily old frame. Distinguish a rainfall accumulation's start/end from a radar instant. Backward-looking weather windows must end at the analysis time, not include future rainfall.

Aggregate rainfall over an area's intersection with valid weather pixels and report coverage; a small block group does not gain finer-than-radar measurements. Keep station readings regional unless an explicit, validated interpolation is added. Preserve legacy grid polygons for weather joins; do not assign their customer totals to modern block groups by centroid or assume uniform distribution. Compare source formats separately unless a documented coarser common geography and compatible metric exist.
