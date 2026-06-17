# Decoupling planning brief

A planning **seed** for the big-plans project on branch `ct/decouple-from-monorepo` that finishes
splitting this repository out of the `vortex-data/vortex` monorepo.

It exists because the agent's cross-repo working context (the bench-v4 migration, AWS/RDS/Vercel
facts, sequencing) lives in a memory store tied to the monorepo checkout and does NOT auto-load in
a conversation rooted in this repo. Read this first. It is not the spine; big-plans Phase 1 creates
that. No secret values live here, only an inventory of what must move.

## What this repo is

A standalone snapshot of the monorepo's `benchmarks-website/` directory (the site behind
`bench.vortex.dev`), extracted as a single squashed commit. The tree carries several generations of
the site side by side: the legacy Node/React stack (top-level `server.js`, `src/`, `index.html`,
etc.), the Rust + DuckDB stack (`server/`, `migrate/`, `ops/`), and the current Next.js + Postgres
stack (`web/`, deployed to Vercel, reading from hosted RDS Postgres).

## Goal of the decoupling project

Make this repo fully self-sufficient so the site iterates without the monorepo's CI, then retire the
monorepo copy. Four workstreams plus cleanup.

## Cross-repo facts the planning needs

- **Source.** Extracted from `ct/bench-v4` HEAD in the monorepo (the modernized v4 site). That
  branch is NOT yet merged to the monorepo's `develop`.
- **Secrets / env to move** (inventory only, no values): the RDS `bench_read` role's static
  password (currently set in Vercel), `BENCH_REVALIDATE_TOKEN`, `BENCH_SITE_BASE_URL`, the Vercel
  project env (Production + Preview), and the `bench_ingest` IAM identity used for writes.
- **AWS / hosting.** Bench account `245040174862` (already public in `infra/`); hosted Postgres on
  RDS; the Vercel project lives under the `vortex-data` team with Root Directory `web/`.
- **Rust crates.** `server/` and `migrate/` were members of the monorepo Cargo workspace and need a
  root workspace here before `cargo build` works standalone.
- **Monorepo workflows that reference the site** (~7): `web-deploy`, `web-keep-warm`,
  `schema-deploy`, `publish-benchmarks-website`, `sql-benchmarks`, `bench`, `v3-commit-metadata`.
  The benchmark-PRODUCING ones (`bench`, `sql-benchmarks`) are the emitters and stay in the
  monorepo; the deploy/serve ones move here or retire.

## Sequencing and risks

- **Drift.** Declare the monorepo `benchmarks-website/` copy deprecated immediately so the two
  copies do not diverge while this project runs.
- **Emitter overlap.** The emitter workstream overlaps the monorepo's in-flight bench-v4 ingest
  cutover (same emitter wiring), which is gated on a monorepo develop-landing decision the user is
  handling. Sequence around it; do not duplicate that work.
- **Deletion ordering.** The phase that deletes `benchmarks-website/` from the monorepo must reckon
  with the code currently living only on `ct/bench-v4`, not on `develop`.

## Proposed phase shape (refine in the Phase 1 interview)

- **A. Standalone build + CI.** Root Cargo workspace so `server/` + `migrate/` compile; this repo's
  own CI (Rust build/test + the `web/` Next.js build); re-point the Vercel project at this repo.
- **B. Secrets / env migration.** Move the inventory above out of the monorepo's GitHub and Vercel
  settings into this repo.
- **C. Emitter to ingester contract.** Benchmark-producing workflows stay in the monorepo and POST
  to this site's ingest endpoint; version and document the API so the two repos stay in sync.
- **D. Retire from monorepo + prune.** Trim the monorepo workflows that deploy/serve the site,
  delete `benchmarks-website/` from the monorepo (PR vs `develop`), and prune the superseded legacy
  generations here.
