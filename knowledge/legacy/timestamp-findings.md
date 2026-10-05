---
type: Audit Report
title: "Legacy timestamp evidence"
description: "September 17, 2026 historical timezone changes, absolute RData epochs, eight verified capture/commit anchors and the automatic resolution approach."
tags: [legacy, timezone, audit]
status: stable
generated: { by: "codex/unknown", at: 2026-09-22T16:41:52Z }
verified: { by: "process:documentation-review", at: 2026-09-23T04:16:15Z }
sources:
  - id: timestamp-audit
    resource: "../../reports/legacy-timestamp-audit.json"
    title: "Legacy timestamp audit (local, ignored by Git)"
    last_modified: 2026-09-18T01:49:00Z
  - id: setup-r
    resource: "https://github.com/r-lib/actions/blob/eca3a03e465a9b7f54231f4dc18c22738a065967/setup-r/src/installer.ts#L674"
    title: "r-lib setup-r exports TZ=UTC"
  - id: central-switch
    resource: "https://github.com/jpbranson/mlgw.outage.2/commit/15c24fa1a7eb2c8530468a8e340920f4d194b54e"
    title: "April 28, 2024 switch to America/Chicago"
  - id: character-switch
    resource: "https://github.com/jpbranson/mlgw.outage/commit/cd7c8dc719be6e8a865b2ad4ad016a40e4b4892d"
    title: "December 24, 2022 switch to character timestamps"
  - id: with-tz
    resource: "https://lubridate.tidyverse.org/reference/with_tz.html"
    title: "lubridate with_tz documentation"
---
# Legacy timestamp evidence

**September 22 deployment update:** the [DigitalOcean deployment guide](../operations/digitalocean-deployment.md) is authoritative for current operation. The VM now serves the dashboard and runs both collectors; local collectors are stopped. Runtime counts, preview sessions, trial deadlines and hosting gates below describe this earlier checkpoint. Its scientific findings and dated validation results are preserved.

**Subsequent implementation:** [timezone recovery is complete](timezone-recovery.md) for 53,273 total observations and all 18,906 grid snapshots, including full original-epoch verification. One total observation remains unresolved. The findings below preserve the preceding sample-based investigation, not the latest recovery status.

September 17, 2026, approximately 8:45 PM CDT / September 18 01:45 UTC. The user's suggestion that GitHub Actions used UTC was tested against historical code, original captures and commit timestamps. **Automatic recovery is feasible using source-version rules and original timestamps. A single UTC assumption would misinterpret part of this archive.** This checkpoint verifies the rules and samples; it does not bulk rewrite the staged data.

## Findings supported by originals

The historical [R setup action](https://github.com/r-lib/actions/blob/eca3a03e465a9b7f54231f4dc18c22738a065967/setup-r/src/installer.ts#L674) explicitly exports `TZ=UTC`. The saved outage workflows call `r-lib/actions/setup-r`, run the R scraper and commit its output. All 33 available revisions of `R/job.R` and `.github/workflows/schedule-commit.yaml` across the three pinned repositories were inspected. Thus the earlier UTC interpretation has evidence beyond the runner's presumed location or default timezone. The workflow uses mutable action references; the historical setup implementation is corroborating evidence, not a retained log identifying every executed action revision.

The scraper then [explicitly switches timestamp creation to `with_tz("America/Chicago")` on April 28, 2024 at 21:04:20 UTC](https://github.com/jpbranson/mlgw.outage.2/commit/15c24fa1a7eb2c8530468a8e340920f4d194b54e). The [library's documented behavior](https://lubridate.tidyverse.org/reference/with_tz.html) preserves the instant and changes its timezone representation. Later `as.character()` output drops the visible timezone. Summer and winter original captures corroborate offsets of five and six hours respectively.

An earlier transition matters too: the scraper stored actual POSIXct datetime objects in RData beginning December 2, 2022, then [started storing character timestamps on December 24 at 07:10:24 UTC](https://github.com/jpbranson/mlgw.outage/commit/cd7c8dc719be6e8a865b2ad4ad016a40e4b4892d). Two original December 2 objects retain absolute numeric epoch timestamps; their consolidated text values match Central time six hours earlier and omit fractional seconds. The exact consolidation operation that rendered these strings is not retained in the reviewed code. This conversion is established for the samples, and is a rule to validate across that period rather than assume for every row.

| Stored consolidated value | Verified interpretation | Original capture's UTC instant | UTC commit time |
| --- | --- | --- | --- |
| `2022-12-02 09:31:05` | Sample already rendered in Central; original RData contains epoch | `2022-12-02 15:31:05.726143Z` | `15:31:06Z` |
| `2022-12-24 07:12:13` | UTC character string | `2022-12-24 07:12:13Z` | `07:12:16Z` |
| `2023-06-26 03:54:02.943589` | UTC character string | `2023-06-26 03:54:02.943589Z` | `03:54:18Z` |
| `2024-04-28 20:54:22.222655` | UTC immediately before switch | `2024-04-28 20:54:22.222655Z` | `20:54:56Z` |
| `2024-04-28 16:05:55.281641` | Central immediately after switch | `2024-04-28 21:05:55.281641Z` | `21:06:06Z` |
| `2024-09-12 13:32:57.90667` | Central daylight time | `2024-09-12 18:32:57.906670Z` | `18:33:10Z` |
| `2025-02-20 14:43:41.006461` | Central standard time | `2025-02-20 20:43:41.006461Z` | `20:43:54Z` |

Eight original RData captures were checked, including another December 2 sample. Source counts match the consolidated records. Each original verifies its Git blob and SHA-256; each correctly interpreted timestamp falls 0.27–33.78 seconds before its associated `GitHub Actions` data commit. Four saved page/text companions were retained, but they contain the extracted page head and do not provide a verified independent publication-time anchor in this checkpoint.

The June 2023 peak sample therefore occurred at **10:54:02 PM CDT on June 25**, even though its stored UTC date is June 26. This is a capture timestamp, not the beginning of that outage or storm. Existing historical maxima described by stored dates remain dated evidence; weather alignment needs the resolved instant.

## Automatic recovery approach

1. Preserve every source string and provenance reference. Prefer the numeric epoch in an original POSIXct RData object; it identifies an instant without guessing a timezone and can restore precision lost from the consolidated string.
2. For character values, apply the timestamp convention of the source version that produced the capture. Verify at code-change boundaries using added-file metadata and UTC commits; do not classify the April 28 overlap by clock text alone. The source clock moves backward approximately five hours when the representation changes, and nearby test/manual additions need separate treatment.
3. Resolve Central values using `America/Chicago` and its historical DST rules. Never use a permanent five- or six-hour offset. The audit enumerates both fall-back candidates and rejects nonexistent spring-forward times; an independent capture/commit anchor can resolve a repeated hour.
4. Check coverage, provenance, chronology and conflicting aliases after conversion, then publish a separate legacy timeline. Outage start times embedded in page/event fields and geographic-grid filename times need their own source-specific validation.

The planning inventory divides the 53,274 total observations into **17,519 explicit UTC values; 1,568 early RData-conversion-period values; 14,499 later UTC-character-period values; 186 values on the April 26–28 transition days; and 19,502 values after the explicit Central-code transition**. These are source-era counts, not a claim that every record has been independently resolved. All 19,502 later Central values have exactly one valid DST-aware candidate; the known fall-back interval contains no ambiguous values in this subset of the consolidated totals. That does not establish full raw-capture coverage during that interval.

The proposed versioned resolver and geometry-time reconciliation subsequently completed in [timezone recovery](timezone-recovery.md), with per-record evidence and one unresolved total. The [capture-coverage audit](coverage-audit.md) then classified empty/failed originals and identified one additional nonempty capture outside the recovered catalog. The [separate legacy dashboard publication](legacy-dashboard.md) subsequently completed; these earlier planning counts remain dated evidence.

## Reproducible local checks

Saved evidence is under ignored `data/legacy/time-evidence/`; the machine-readable result is `reports/legacy-timestamp-audit.json`. The existing deduplicated staging archives were not changed. The scripts below default to cached inputs; add `--download` to the three Node commands only for explicit missing-evidence acquisition. Downloads are bounded and no historical scraper code is executed.

```powershell
node scripts/collect-legacy-time-evidence.mjs --history-content
node scripts/collect-legacy-time-samples.mjs
node scripts/collect-legacy-time-captures.mjs
Rscript --vanilla scripts/inspect-legacy-time-samples.R
python -B scripts/audit-legacy-timestamps.py
python -B -m unittest discover -s test -p 'legacy*_test.py'
```

Python needs IANA timezone data: this runtime supplies Python's `tzdata` package; other Windows environments may need it. All **11 legacy Python tests passed at this checkpoint**, including five timestamp cases covering seasonal offsets, both DST transitions, commit disambiguation, stale/future anchors and epoch recovery. All three evidence-acquisition scripts replay offline without network requests. The original eight-capture audit is reproducible independently of the machine's local timezone; [current status](../project-status.md) records subsequent validation.
