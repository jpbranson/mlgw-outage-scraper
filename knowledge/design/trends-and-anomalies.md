---
type: Design Section
title: "Trends and anomaly detection"
description: "Metric definitions, customer-minute estimation, anomaly rules, data-quality signals and weather-association principles."
tags: [design, metrics, anomalies, weather]
status: stable
generated: { by: "codex/unknown", at: 2026-09-22T16:41:52Z }
verified: { by: "process:documentation-review", at: 2026-09-23T04:16:15Z }
---
# 7. Trends and anomaly detection

Start with transparent rules and aggregate statistics. Machine learning is unnecessary for the first version.

| Metric | Method and interpretation |
| --- | --- |
| Affected customers | Sum valid `CUR_CUST_AFF` values within one snapshot; never sum snapshots and call that unique customers |
| Active reported outages | Count source features, separate from affected customers and browser clusters |
| Change over time | Difference between comparable valid observations; suppress event comparisons across gaps or suspect snapshots |
| Customer-minutes | Integrate affected-customer counts over observed time; an estimate of interruption burden, not an official utility metric |
| Geographic recurrence | Count distinct provisional events by reported-location cell; separate frequency from duration and affected-customer burden |
| Restoration progress | Falling affected-customer totals during a selected period, without assuming every decrease is a verified restoration |

For customer-minutes, use a left-step estimate `sum(customers_i * elapsed_minutes_i)` between consecutive valid observations no more than 1.5 configured poll intervals apart. Split contributions at rollup boundaries. Longer gaps contribute unknown time, not zeros. Report covered minutes and coverage percentage alongside daily/hourly estimates; avoid extrapolating a partial day to a whole day. End the estimate at the last observation.

Initial anomaly rules, with configurable thresholds:

- **Sharp increase:** at least 100 additional affected customers and at least double the prior comparable count. The implemented local dashboard uses the stricter 7.5-minute continuity limit (1.5 five-minute poll intervals) and rejects comparisons across intervening failed/suspect attempts. Treat a rise from zero using the absolute threshold. Mark this as a heuristic.
- **Unusually high activity:** after 28 sufficiently observed days, compare the current count with a robust baseline from the preceding 28 days. Use one valid observation per five-minute baseline slot so faster storm polling does not overweight storm periods. Flag counts above the median plus the larger of 100 customers or six scaled median absolute deviations. Require at least 90% baseline coverage and handle zero spread with the absolute floor. Persist baseline/rule versions.
- **Long-running reported outage:** highlight a source-reported duration above six hours, with ambiguous/missing start times clearly labeled.
- **Recurring location:** rank grid cells by distinct reported events and estimated burden over 7/30 days. Present rankings initially; avoid a statistically confident hotspot claim from sparse history.

Separate source/data-quality anomalies from electrical-outage anomalies. Unexpected schema changes, duplicate IDs, invalid geometry, and a sudden empty collection after a large outage are data-quality signals. Preserve suspect captures and show the last trustworthy state with a warning. Confirm a suspicious zero using subsequent captures and, when useful, the separately retrieved HTML summary; do not permanently reject legitimate recovery to zero. Store each source's retrieval time because the two requests are not atomic.

Do not publish SAIDI/SAIFI or unique households affected from this feed. Those require identities, denominators, and interruption histories that these public snapshots do not establish.

## Weather associations — Phase 5

Use descriptive, reproducible comparisons before fitting a predictive model. A spatial or temporal association is not a verified outage cause. Rain, wind, vegetation, network layout and other factors may coincide; do not assign causal labels to individual outages from a weather overlay.

- Define an episode and comparison window explicitly. Show outages already present at its start separately from newly reported events. Preserve first-observed versus source-reported start-time uncertainty and the existing provisional identity rules.
- Compare rain during the episode, preceding 1/24/48/72-hour accumulation, temperature and gust observations, and relevant documented hazards where supported. The implemented rainfall/wind cases use the previous completed weather hour plus 0, 1 or 3 additional lag hours on both the case and reference. Concurrent or other lag windows would require a separate versioned extension; avoid selecting only the lag that looks strongest afterward.
- Measure distinct provisional events, observed peak customers and customer-hours (`customer-minutes / 60`), including area-level burden only where spatial data supports it. Keep the existing gap rules and end integration at the last trustworthy observation. Report joint weather/outage coverage rather than treating unavailable weather or outage data as zero.
- Support heavy rain, prolonged rainfall, flash-flood episodes, strong wind, snow, ice/freezing rain, heat waves and cold as overlapping condition tags. Preserve whether a label comes from an observation, warning, finalized event record or a documented derived rule. Rainfall alone does not establish a flash flood; below-freezing temperature alone does not establish ice accumulation.
- Compare areas exposed to similar weather severity/duration and suitable season/time baselines. Show per-episode counts and burden, exposure hours, event counts and population denominators; avoid ranking vulnerability from an unadjusted all-time outage count or applying a single station's gust to every neighborhood as local truth.
- Display sparse conditions as descriptive case studies. Show the number of independent episodes and completeness; choose and document sample/coverage thresholds before publishing comparative rankings, and use uncertainty intervals once there are enough independent episodes. A single storm or partial season cannot establish a stable neighborhood ranking.

Weather-condition thresholds, station selection, lag tolerances and statistical sufficiency are implementation/validation decisions to document, not questions the user must answer before work can begin. Begin with rainfall and wind, then winter conditions and heat; a named user-priority storm can change that order.
