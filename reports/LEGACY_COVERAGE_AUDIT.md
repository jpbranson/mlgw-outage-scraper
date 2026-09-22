# Legacy capture coverage

**September 22 deployment update:** the [DigitalOcean deployment guide](DIGITALOCEAN_DEPLOYMENT.md) is authoritative for current operation. The VM now serves the dashboard and runs both collectors; local collectors are stopped. Runtime counts, preview sessions, trial deadlines and hosting gates below describe this earlier checkpoint. Its scientific findings and dated validation results are preserved.

Completed September 17, 2026, approximately 10:20 PM CDT / September 18 03:20 UTC. The bounded historical coverage checkpoint is complete. A separate verified availability catalog inventories **53,679 capture keys** and classifies all **2,212 captures without a matching consolidated observation**. The existing recovered totals and geometry catalog remains unchanged. The subsequent [legacy dashboard integration](LEGACY_DASHBOARD_STATUS.md) is complete.

## Originals retained in Git

The final commit of repository 1 [deleted its data directory](https://github.com/jpbranson/mlgw.outage/commit/a682acfbde35bac691363fa37545bceef7fdb06f). Its [immediate parent](https://github.com/jpbranson/mlgw.outage/tree/184f534274a1520ccdbdc0c58384b3715f5a9252/data) retains **32,818 capture keys and 65,635 individual files**. All 35,851 dated files inventoried at the December 2022 checkpoint also occur there with identical blob hashes. The earliest scheduled-scraper source revision, March 8, 2022, has no capture files.

The inventory includes CSV event tables and plain saved text as well as RData and text-RDS files. Earlier tip-only counts omitted the 159 plain-text counterparts in repository 2; all 10,394 of its captures have paired files.

| Repository | Capture keys | Parsed table plus saved text | Stored filename dates |
| --- | ---: | ---: | --- |
| `mlgw.outage`, before deletion | 32,818 | 32,817 | March 8, 2022–July 10, 2023 |
| `mlgw.outage.2`, pinned tip | 10,394 | 10,394 | April 26–September 9, 2024 |
| `mlgw.outage.3`, pinned tip | 10,467 | 10,467 | September 11, 2024–February 20, 2025 |
| **Total** | **53,679** | **53,678** | Mixed historical filename time conventions |

There are **107,357 distinct repository files**, represented by 94,160 distinct Git blobs. Across the inspected revisions there are no conflicting versions of the same repository capture file. **5,034 blobs recur at different capture keys**; identical content does not collapse those observations. The 143,208 revision/file references include the repeated December checkpoint and are not additional captures.

This is a complete inventory of **six selected trees**: three pinned tips, the pre-deletion parent, the December checkpoint and the first scheduled-scraper source. It is not an exhaustive walk of every historical commit or proof that an original never existed elsewhere. No full repository clone was needed.

## Captures and consolidated totals

**51,467 capture keys** have an unambiguous candidate relationship to a recovered total. Of these, 1,576 use the previous full-original-content matches; the others use the previously verified filename timezone convention and a unique total within one second. Those temporal associations establish availability, not a claim that every original table has now been downloaded and compared.

All **2,212 unmatched capture keys** are accounted for:

- **2,211 contain empty parsed event tables.** Eight distinct parsed-object blobs cover these captures. Their content was inspected in R, and equality of the inventoried blob hashes extends that classification to every copy.
- Of these, **2,209 also have saved head text verified to contain an empty event array and no polygon declarations**. Reused identical page blobs are retained as separate capture references.
- One has a **blank saved page**, stored `2022-11-05_15_53_42`. Another has a **“Request Rejected” page**, stored `2024-07-09_05_40_53`. These are explicit data-quality exceptions.
- One nonempty original, stored **`2024-04-28 15:54:57.669638`**, contains **7 reported outages / 201 affected customers** and seven event rows. Its paired saved page matches every event field and contains six polygon declarations. That timestamp is absent from the consolidated history. It is retained in the audit exceptions for source/time reconciliation, without adding a new observation to the recovered catalog.

The saved text is the page's **head excerpt**, not its body-level regional summary. Empty event arrays therefore do not establish zero reported outages or zero affected customers. The rejected request demonstrates why converting all empty tables to zero would be incorrect. None were converted to numeric zero.

Conversely, **1,807 consolidated observations have no candidate standalone original in these trees**: 1,806 early observations from February 8 through March 8, 2022, plus the existing unresolved April 26, 2024 timestamp. Their consolidated source records remain preserved. One other capture, `2022-12-24_00_59_31`, has an event object but no saved-page counterpart.

## Timeline coverage

The monthly coverage index includes months with zero recovered observations. **August 2023 through March 2024 have no resolved totals.** The largest interval between known numeric observations is **291 days, 8 hours, 48 minutes**, between July 10, 2023 at 13:34:36.616972 UTC and April 26, 2024 at 22:22:43.937077 UTC. The remaining unresolved April 26 record has no assigned position in this UTC timeline.

The audit records **1,793 total-observation intervals longer than one hour** and **870 grid-snapshot intervals longer than one hour**. These are intervals between known values, not outage duration, proven scraper downtime or an expected-slot success rate. Some numeric gaps contain saved empty event tables. Totals and spatial coverage remain separate; absence of an old grid snapshot must not produce an empty map or a fabricated location.

The subsequent dashboard checkpoint breaks detailed charts across missing coverage, exposes the known exceptions, distinguishes original-file availability from validated numeric observations, and keeps `legacy_html` separate from the current feed. Extending geometry from additional saved pages or importing the extra nonempty capture requires its own validation.

## Verification and resource use

- **219 file references across 110 selected captures** were verified against both Git blob SHA-1 and SHA-256. Selection covers month/format boundaries and every distinct unmatched object/page blob; it is deliberate coverage sampling, not a random statistical sample.
- Base R inspected all selected event objects. **91 nonempty captures match their consolidated event fields**: 63 exact field matches and 28 CSV matches after explicit outer-whitespace/empty-field normalization. Unmodified exported fields are retained. The remaining nonempty capture is the exception above.
- Python independently recounts all six trees and compares **107 paired saved-page event arrays** against the R/CSV event fields. The blank page, rejected request and missing page are separately recorded.
- **26 legacy Python tests and all 134 Node tests pass.** Cases include source-zone association, both DST transitions, observation-gap accounting, empty versus rejected pages, duplicate event indices and parsing archived JavaScript as data without execution.
- An offline replay makes **zero requests**, reproduces the capture manifest, selection and gap-list hashes, and leaves the recovered catalog hash unchanged. The compressed availability manifest is **4,558,141 bytes / 4.3 MiB**. The selected unique original files occupy **1,430,643 bytes / 1.4 MiB**, excluding retained tree metadata.
- At **03:12:32 UTC**, the live collector had **416/416 valid observed slots**, no gaps over ten minutes and healthy runner/storage status. Its existing seven-day trial continues.

The verified catalog is `data/legacy/coverage/catalog.json`. It links the capture manifest, interval lists, empty-capture classifications, totals without originals and independent verification. The machine-readable summary is `reports/legacy-coverage-audit.json`. All source originals and prior staging/recovery outputs remain intact; this checkpoint does not publish dashboard data.

## Reproduction

Use the prior pinned inventories and verified timezone-recovery catalog, Node 24+, base R and Python 3.11+ with IANA timezone data. From the repository root:

```powershell
node scripts/collect-legacy-coverage.mjs
python -B scripts/audit-legacy-coverage.py
node scripts/collect-legacy-coverage.mjs --samples
Rscript --vanilla scripts/inspect-legacy-coverage.R
python -B scripts/verify-legacy-coverage.py
python -B -m unittest discover -s test -p 'legacy*_test.py'
```

Check each command succeeds before proceeding. Acquisition is offline by default; add `--download` only for missing cached inputs. It accepts only the inventoried captures, uses four workers, verifies original blob hashes, and enforces 600 requests, ten minutes, 128 MiB per invocation and 2 MiB per capture file. It never sources archived scripts or loads credential/configuration objects. Coverage classification is marked verified only after the independent checks succeed; recorded data-quality exceptions remain visible.
