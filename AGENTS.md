# Agent instructions

Project knowledge lives in `knowledge/`, an Open Knowledge Format (OKF) v0.2 bundle. Read `knowledge/index.md` and `knowledge/project-status.md` before planning work.

- Record new findings, checkpoints, audits, guides and decisions as concepts in `knowledge/`, following `knowledge/maintaining-this-bundle.md`. Update the directory `index.md`, `knowledge/log.md` and, when operating state changes, `knowledge/project-status.md`.
- Never add Markdown to `reports/`; it holds Git-ignored machine evidence that concepts cite in their `sources`.
- Treat checkpoint reports as dated evidence: add a dated note pointing to newer evidence rather than rewriting their measurements.
- Run `npm run knowledge:check` after editing the bundle; `npm test` runs the same checks.
