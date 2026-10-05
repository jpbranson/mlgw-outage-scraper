---
type: Playbook
title: "Maintaining this knowledge bundle"
description: "Conventions for adding and updating project knowledge in this OKF v0.2 bundle: layout, frontmatter, provenance, trust, freshness, index and log rules."
tags: [knowledge, okf, conventions]
status: stable
generated: { by: "claude-code/claude-opus-5-5", at: 2026-10-05T02:33:01Z }
sources:
  - id: okf-spec
    resource: "https://raw.githubusercontent.com/GoogleCloudPlatform/open-knowledge-format/refs/heads/main/SPEC.md"
    title: "Open Knowledge Format specification, version 0.2"
  - id: doc-audit
    resource: "../reports/documentation-audit-release.json"
    title: "September 23 documentation audit receipt (local, ignored by Git)"
  - id: checker
    resource: "../src/knowledge/okf.mjs"
    title: "Bundle conformance checker"
---
# Maintaining this knowledge bundle

`knowledge/` is an Open Knowledge Format (OKF) v0.2 bundle.[^okf-spec] Every Markdown file other than `index.md` and `log.md` is a *concept*: YAML frontmatter followed by a Markdown body. Each directory's `index.md` lists its concepts for progressive disclosure, and [the bundle log](log.md) records changes. `npm run knowledge:check` validates the rules below; it also runs in `npm test` and CI.[^checker]

## Layout

| Location | Holds |
| --- | --- |
| [`project-status.md`](project-status.md) | Current operating state and remaining work. Read it first. |
| [`design/`](design/index.md) | The design plan, one concept per plan section. |
| [`operations/`](operations/index.md) | Production runbook, release records and dormant procedures. |
| [`collection/`](collection/index.md) | Source pilot and collector guides and checkpoints. |
| [`dashboard/`](dashboard/index.md) | Dashboard guide and checkpoints. |
| [`weather/`](weather/index.md) | Weather source, rainfall and comparison guides and checkpoints. |
| [`legacy/`](legacy/index.md) | Legacy scraper history audits, recovery and publication. |
| [`locations/`](locations/index.md) | Exact reporting-location evidence. |
| [`references/`](references/index.md) | Provenance of external data and assets stored in the repository. |

Machine-readable evidence (JSON, logs, screenshots) stays in the Git-ignored `reports/` directory and is cited from `sources`. Do not add Markdown to `reports/` or the repository root other than `README.md`, `AGENTS.md` and `CLAUDE.md`; the checker rejects it. A new topic gets its own directory with an `index.md`, plus an entry in the root index.

## Recording a checkpoint or finding

1. Create a concept in the matching topic directory. Use a short kebab-case filename and start the body with an H1 heading, normally the frontmatter title.
2. Start from this frontmatter:

   ```yaml
   ---
   type: Checkpoint Report
   title: "Rainfall case validation"
   description: "October 6, 2026 validation of ... (one sentence, starting with the checkpoint date)."
   tags: [weather, rainfall]
   status: stable
   generated: { by: "claude-code/claude-opus-5-5", at: 2026-10-06T15:00:00Z }
   sources:
     - id: validation
       resource: "../../reports/rainfall-example-validation.json"
       title: "Rainfall validation report (local, ignored by Git)"
   ---
   ```

3. Add the entry to the directory's `index.md` as `* [Title](file.md) - description`, copying the title and description exactly.
4. Add a dated entry at the top of [the log](log.md). Use one `## YYYY-MM-DD` heading per date, newest first, with list items below it.
5. Link related concepts. When current operating state changes, update [current project status](project-status.md) as well.
6. Run `npm run knowledge:check` and fix every error.

## Frontmatter profile

OKF requires only `type`. This bundle also requires `title`, a one-sentence `description` and `generated: { by, at }`, so every concept carries its provenance.

- **Types in use:** `Status Report`, `Runbook`, `Guide`, `Checkpoint Report`, `Audit Report`, `Design Section`, `Dataset Reference`, `Asset Reference` and `Playbook`. Reuse one of these when it fits. OKF's `Attested Computation` type is supported if a sanctioned computation is ever recorded.
- **Actors:** use `claude-code/<model>` or `codex/<model>` for agents, `human:jpbranson` for the owner and `process:<name>` for scripts. `codex/unknown` marks content written before October 2026 in commits without an AI co-author trailer. The documents themselves cite Codex runtimes and automations, but the model was not recorded.
- **`generated.at`** is the last meaningful content change in ISO 8601 form with an explicit offset. Moving a file, fixing links or reformatting does not change it. For migrated documents it came from Git history: the last commit touching each file, Git blame for sections split out of the former README and design plan, and the file time for the September 24 working-tree edits.
- **`verified`** is appended only when someone or something checks the content against its sources. `process:documentation-review` at 2026-09-23T04:16:15Z is the passing release documentation audit. It checked links, anchors, npm scripts, source and configuration paths, API routes and deployed comparison data for the 28 documents that existed then.[^doc-audit] An owner sign-off uses `human:jpbranson` and raises the trust tier to human-reviewed. `npm run knowledge:check` checks structure only and is never recorded as verification.
- **`status`:** `stable` by default; `deprecated` for superseded alternatives kept for history; `draft` for incomplete work.
- **`stale_after`:** concepts that describe live state ([current project status](project-status.md) and the [deployment runbook](operations/digitalocean-deployment.md)) get a date 30 days after their last verification. Refresh the facts, add a `verified` entry, then move the date forward. The checker warns once the date passes. Checkpoint reports and design sections are dated records and have no `stale_after`.
- **`sources`:** cite evidence files, configuration, code and external references. Local Git-ignored files are allowed and say so in their title. A per-claim footnote `[^id]` must use a `sources` id.
- **YAML subset:** the checker parses frontmatter without dependencies. It accepts `key: value` lines, quoted or plain scalars, `[a, b]` flow lists, `{ key: value }` flow maps, nested block mappings and block lists of mappings. Multi-line and block scalars are not accepted. Quote values that contain `: ` or start with punctuation; quoting every string is always safe.

## Writing conventions

These carry forward the project's existing documentation practice:

- Checkpoint reports are dated evidence. Do not rewrite their measurements, counts, PIDs or test totals. Add a bold dated note at the top that points to newer evidence instead.
- Give times in Central and UTC where they matter. Keep measured values separate from scenarios, and keep missing data explicit rather than writing zeros.
- Use relative links. They work both on GitHub and in OKF consumers, and the checker confirms each target file and heading anchor.
- Keep passwords, tokens, keys and preview URLs out of the bundle.

[^okf-spec]: Open Knowledge Format specification, version 0.2
[^checker]: Bundle conformance checker
[^doc-audit]: September 23 documentation audit receipt
