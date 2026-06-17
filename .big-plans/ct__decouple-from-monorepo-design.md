<!--
SPDX-License-Identifier: Apache-2.0
SPDX-FileCopyrightText: Copyright the Vortex contributors
-->

# Decouple `benchmarks-website` from the monorepo — design spec

**Date:** 2026-06-17
**Branch:** `ct/decouple-from-monorepo`
**Work shape:** migration
**Status:** approved (brainstorming) — pending grill-me stress-test + spine decomposition
**Planning seed:** [`.big-plans/decoupling-brief.md`](decoupling-brief.md)
**Spine:** [`.big-plans/ct__decouple-from-monorepo.md`](ct__decouple-from-monorepo.md)

## Goal

Make the `benchmarks-website` repository fully self-sufficient — it builds, tests, deploys, and
ingests benchmark data on its own, without the `vortex-data/vortex` monorepo's CI. Retiring the
monorepo copy and pruning legacy generations are explicitly **future work**, not this project.

## Context

The repo is a squashed snapshot of the monorepo's `benchmarks-website/` directory. It carries three
generations of the site **all currently live in slightly different states**:

- **v2** — legacy Node/React (top-level `server.js`, `src/`, `index.html`, `vite.config.js`,
  `public/`; GHCR image published by the monorepo's `publish-benchmarks-website.yml`).
- **v3** — Rust + DuckDB (`server/` = `vortex-bench-server` axum+maud, `migrate/` =
  `vortex-bench-migrate`, `ops/` = EC2/systemd host-based deploy). The `server/`'s `POST /api/ingest`
  is the hard-required live ingest target in monorepo CI today.
- **v4** — Next.js + Postgres (`web/`, deployed to Vercel reading hosted RDS Postgres; behind a
  dev-only Vercel domain pending a separate Phase-5 v3→v4 cutover).

**Why v3 exists (load-bearing framing from the user):** v3 is *temporary scaffolding*. It is kept
only because vortex itself does not yet have native benchmark **emitters + Postgres ingestion**; the
`migrate/` tool (DuckDB→Postgres) is what keeps the v4 site's Postgres fed in the meantime. v3 is
designed to be **removed later**, once vortex ingests natively. Therefore the decoupling keeps v3
building/testing/deploying but does **not** gold-plate it, and keeps its seams clean for a future
removal.

This project is also entangled with two cutovers the user handles **separately**: the monorepo's
unmerged `ct/bench-v4 → develop` merge, and the v3→v4 Phase-5 production cutover. This project
sequences around them and touches neither.

## Scope

### In scope

1. **Standalone Rust build** — a root Cargo workspace so `server/` + `migrate/` compile without the
   monorepo.
2. **This repo's own correctness CI** — Rust (fmt/clippy/build/test) + `web/` (lint/format/build/
   test). No external credentials.
3. **This repo's own deploy + secrets/infra ownership** — Vercel re-point, GitHub Actions secrets/
   vars, AWS IAM OIDC trust extension, v3 EC2 host re-point.
4. **A versioned, documented emitter→ingester contract**, kept in this repo; the monorepo emitters
   are unchanged.

### Out of scope (deferred / future work)

- Pruning *any* generation in this repo — v2, v3, v4 all stay (all three are live).
- *Any* change to the monorepo — no workflow trimming, no `benchmarks-website/` deletion, no
  freezing. All monorepo-side retirement is future work.
- v3 teardown (waits for native vortex emitters/ingestion).
- The v3→v4 Phase-5 cutover and the `ct/bench-v4 → develop` merge.
- Re-authoring the benchmark-*producing* logic — the monorepo emitter workflows (`bench`,
  `sql-benchmarks`, the `v3-commit-metadata` ingest step) stay in the monorepo; this project owns
  only the ingest *contract*.

## Architecture & key findings

### Standalone build requirements (Phase 1)

- **No root `Cargo.toml` / `Cargo.lock` / `rust-toolchain.toml` exist here.** `server/Cargo.toml`
  and `migrate/Cargo.toml` are byte-identical to the monorepo v4 originals, including
  `{ workspace = true }` deps with no workspace to resolve them.
- **The only monorepo-internal crate dependency is `vortex-utils`**, used in exactly three sites,
  only for `hashbrown` HashMap/HashSet type aliases:
  - `server/src/read_model.rs:36` — `use vortex_utils::aliases::hash_map::HashMap;`
  - `server/src/app.rs:41` — `use vortex_utils::aliases::hash_set::HashSet;`
  - `migrate/src/migrate/accum.rs:30` — `use vortex_utils::aliases::hash_map::HashMap;`

  Sever by depending on `hashbrown` directly (the aliases are thin re-exports over `hashbrown`). No
  vortex *core* crates are used. Blast radius = one crate.
- **Monorepo pins** (from the `ct/bench-v4` branch, checkout `/Users/connor/spiral/vortex-data/vortex4`):
  `channel = "1.91.0"`, `edition = "2024"`, `rust-version = "1.91.0"`, `resolver = "2"`.
- **`migrations/` is the most-referenced missing directory** — `migrate/tests/postgres_e2e.rs:43-45`
  (`include_str!("../../../migrations/…")`), `web/lib/test-harness.ts:35`
  (`new URL('../../../migrations', …)`), `infra/` bootstrap, and the v4 ingest schema all need it.
  In the monorepo it lives at the *monorepo root* (hence `../../../` from `benchmarks-website/migrate/
  tests/`). Standalone, it moves to **this repo's root** (`/migrations/`) and the relative paths in
  `migrate/tests` + `web/lib/test-harness.ts` are fixed (one fewer `../`).
- **Other in-repo monorepo-relative references that break build/tests:** `server/build.rs:31-32`
  (`cargo:rerun-if-changed=../../.git/HEAD`) assumes the git dir two levels up; `server/tests/
  measurement_id_golden.rs:43` reads `../../scripts/measurement_id_golden.json` (`scripts/` absent
  here).
- **Recommended root manifest:** `members = ["server","migrate"]`, `resolver = "2"`,
  `[workspace.package]` edition/rust-version/license, `[workspace.dependencies]` inlined from the
  monorepo at the exact upstream pins, `vortex-utils` replaced by `hashbrown`. Copy
  `rust-toolchain.toml` verbatim; `cargo generate-lockfile`. Verify the exact `hashbrown` and
  `reqwest` feature pins against `vortex4/Cargo.toml` `[workspace.dependencies]`.

### CI to replicate (Phases 2 + 4)

- **This repo has no `.github/` directory.** All CI lives in the monorepo.
- **The current (v4) CI lives only on the unmerged monorepo `ct/bench-v4` branch:** `web-deploy.yml`,
  `web-keep-warm.yml`, `schema-deploy.yml`, `migrations/*.sql`, `scripts/migrate-schema.py`.
  `develop` has only the v3/legacy subset.
- **Correctness CI (Phase 2, no creds):** Rust — `cargo fmt --check` (the monorepo uses a *nightly*
  toolchain for fmt), `cargo clippy --all-targets -- -D warnings`, `cargo nextest run` (incl. the
  `--run-ignored only` admin tests that need network), `cargo test --doc`. `web/` — `pnpm
  format:check`, `pnpm lint`, a deliberately **DB-free** `pnpm build`, `pnpm test` (vitest; the
  Postgres suite needs Docker). Package manager is `pnpm@11.5.2`.
- **Deploy CI (Phase 4, external creds):** `web-deploy.yml` (Vercel CLI `pull`/`build`/`deploy
  --prebuilt`), `web-keep-warm.yml` (cron curl), `schema-deploy.yml` (OIDC-assume `migrator`, run
  `scripts/migrate-schema.py apply` against RDS — needs `migrations/` + the runner script, which move
  here too).

### The emitter→ingester contract (Phase 3)

Two paths exist; the contract documents both, pinned to `SCHEMA_VERSION` (currently `1`):

- **v3 (current, hard-required):** monorepo `scripts/post-ingest.py --server $V3_INGEST_URL` →
  `POST {server}/api/ingest`, `Authorization: Bearer $INGEST_BEARER_TOKEN`. Body = `Envelope`
  `{run_meta, commit, records}` (`server/src/records.rs`, `#[serde(deny_unknown_fields)]`).
  `validate_envelope` (`server/src/ingest.rs`) rejects `schema_version` mismatch (409 if newer, 400
  if older). `SCHEMA_VERSION` is duplicated as a Python literal in `post-ingest.py:69` and the Rust
  const `server/src/schema.rs:223`.
- **v4 (forward, best-effort):** monorepo `post-ingest.py --postgres` does a direct RDS
  `INSERT … ON CONFLICT (measurement_id) DO UPDATE` as the least-privilege `bench_ingest` role
  (IAM-auth, `sslmode=verify-full`), then optionally `POST $BENCH_SITE_BASE_URL/api/revalidate`
  (`Bearer $BENCH_REVALIDATE_TOKEN`) to flush the Next.js cache. Every v4 step is `continue-on-error:
  true`, gated on `vars.GH_BENCH_INGEST_ROLE_ARN != ''`. `measurement_id` is computed locally,
  mirroring the server-internal hash; it is **never on the wire**.
- **In-repo version anchors to keep in agreement:** `server/src/schema.rs` `SCHEMA_VERSION`,
  `web/lib/schema-version.ts` (asserted by `web/lib/schema-version.test.ts:13`). The doc records the
  monorepo consumers (`post-ingest.py`, `vortex-bench/src/v3.rs`) which cannot be tested cross-repo.

### Secrets / infra inventory (Phase 4)

| Name(s) | Purpose | Current home | Move entails |
|---|---|---|---|
| `BENCH_DB_PASSWORD` (`bench_read` static pw) + `BENCH_DB_{HOST,NAME,USER,PORT,REGION,SSL,CA,POOL_MAX,IDLE_TIMEOUT_MS}` | Vercel→RDS read auth/config | Vercel project env (Prod+Preview) | Re-add on the re-pointed Vercel project |
| `BENCH_REVALIDATE_TOKEN` | `POST /api/revalidate` bearer | Vercel env + monorepo emitter caller | Re-add as Vercel env; coordinate the value with the monorepo caller |
| `VERCEL_TOKEN` (secret), `VERCEL_ORG_ID`, `VERCEL_PROJECT_ID` (vars) | Vercel CLI deploy | Monorepo GitHub | Re-create as this repo's GitHub secret/vars |
| `INGEST_BEARER_TOKEN` | v3 `/api/ingest` auth | EC2 host `/etc/vortex-bench.env` + monorepo CI | Host stays operator-managed; CI side is monorepo's (v3 emitter stays there) |
| `bench_ingest` / `migrator` IAM roles (`GitHubBenchmarkIngestRole` / `…SchemaRole`) | OIDC roles for RDS ingest / schema-deploy | AWS IAM acct `245040174862`, OIDC trust pinned to `vortex-data/vortex` | **Extend the OIDC trust to this repo** so its CI can assume the schema role |
| `RDS_BENCH_{REGION,INSTANCE_ENDPOINT,DB_NAME}`, `GH_BENCH_SCHEMA_ROLE_ARN` | schema-deploy connection/role vars | Monorepo GitHub vars | Re-add as this repo's GitHub vars |

Server env contract (`ops/config/vortex-bench.env.example`): `INGEST_BEARER_TOKEN`,
`ADMIN_BEARER_TOKEN`, `VORTEX_BENCH_DB`, `VORTEX_BENCH_SNAPSHOT_DIR`, `VORTEX_BENCH_EXTENSION_DIR`,
`VORTEX_BENCH_BIND`, `VORTEX_BENCH_ADMIN_BIND` (loopback-only), `VORTEX_BENCH_LOG`, `PORT` fallback.
**Never copy secret values into the repo** — names + locations only.

The **v3 EC2 deploy already polls a git repo and builds on-host** (no monorepo CI dependency), so
"re-pointing" it is an ops-config change (`REPO_DIR` / `DEPLOY_BRANCH` to this repo), not a CI port.

## Phase plan

Each phase = one squash-merged PR in **this** repo. Ordering puts the lowest-external-risk work
first and the external-infra work last.

### Phase 1 — Standalone build foundation

Root `Cargo.toml` workspace; copy `rust-toolchain.toml`; sever `vortex-utils` → direct `hashbrown`;
generate `Cargo.lock`; bring `migrations/` into the repo root; fix the in-repo monorepo-relative
references that break the build/tests (`server/build.rs` git path; `include_str!`/`readdirSync` paths
in `migrate/tests` + `web/lib/test-harness.ts`; `server/tests/measurement_id_golden.rs`). No external
dependencies — unblocks everything else.

**Exit criteria:** `cargo build --workspace --locked` → 0; `cargo nextest run -p vortex-bench-server
-p vortex-bench-migrate` → 0; `cd web && pnpm install --frozen-lockfile && pnpm build` → 0.

### Phase 2 — Own correctness CI

Add `.github/workflows/` for Rust (fmt/clippy/build/nextest + doctests, mirroring the monorepo
`ci.yml` steps) and `web/` (prettier/eslint/`next build`/vitest, lifted from the `ct/bench-v4`
`web-deploy.yml` *test* job). Runs on push/PR; **no secrets or external creds.**

**Exit criteria:** workflow YAML validates; the latest CI run on the branch concludes `success`.

### Phase 3 — Emitter→ingester contract (versioned doc + consistency check)

Document the full contract (v3 `POST /api/ingest` + v4 direct-Postgres dual-write + `POST
/api/revalidate`), pinned to `SCHEMA_VERSION`. Add a check asserting the in-repo version constants
agree (`server/src/schema.rs` ↔ `web/lib/schema-version.ts` ↔ the doc). Pure docs + check; monorepo
emitters unchanged.

**Exit criteria:** the contract doc exists; the consistency check (a test or CI step) passes.

### Phase 4 — Deploy + secrets/infra ownership

`web-deploy.yml` + `web-keep-warm.yml` + `schema-deploy.yml` in this repo; re-point the Vercel
project at this repo (Root Directory `web/`); migrate Vercel env + GitHub secrets/vars; extend the
AWS IAM OIDC trust to this repo; re-point the v3 EC2 host to poll this repo. **All external
side-effects are gated on user confirmation** — big-plans produces the workflows/config/runbook; the
user executes console-side changes (Vercel/AWS/GitHub) or explicitly authorizes them.

**Exit criteria:** a deploy from this repo reaches Vercel (preview or prod); CI can assume the AWS
schema role; the v3 host builds from this repo; a runbook documents each external change. (Some
sub-criteria are user-confirmed rather than machine-checkable, given the external systems.)

## Key decisions

- **(a) Lints — pragmatic, not ported.** Start with `cargo clippy -- -D warnings` (+ copy
  `clippy.toml` if cheap); do **not** port the monorepo's heavy `[workspace.lints]` deny-list
  initially. Rationale: v3 is temporary; matching the strict deny-list is gold-plating and easy to
  add later if v3 outlives expectations.
- **(b) `migrations/` home — repo root.** `/migrations/`, matching the monorepo's layout after
  re-rooting; fix the now-wrong relative paths in `migrate/tests` + `web/lib/test-harness.ts`.
- **(c) Contract versioning — `SCHEMA_VERSION`-anchored.** Lean on the existing `SCHEMA_VERSION`
  (=1); a contract doc + a CI consistency check that the in-repo constants match. The monorepo
  `post-ingest.py` consumer is documented but not cross-repo-testable.

## Risks

1. **Cutover entanglement** (P=high, impact=severe) — mitigated by touching nothing in the monorepo
   and deferring all retirement; this project sequences around the cutovers.
2. **`vortex-utils` severance regressions** (P=low, moderate) — match the monorepo `hashbrown` pin;
   verify `measurement_id` golden tests pass.
3. **Missing `migrations/` breaks tests on arrival** (P=med, moderate) — bring it in during Phase 1,
   not deferred.
4. **Secrets migration has externalized side-effects** (P=med, severe) — inventory-first (names
   only); every external change is a pre-action confirmation; never copy values.
5. **SCHEMA_VERSION / wire-shape lockstep spans repos** (P=low, severe) — BAN shape/version bumps as
   part of decoupling work (see spine Reviewer context).
6. **Toolchain/lint drift** (P=med, minor) — decided: pragmatic lints (a), match toolchain.
7. **Re-pointing live deploys** (P=med, severe — all three generations are live) — Phase 4 re-points
   are validated/parallel where possible and user-confirmed; never a blind cutover of live traffic.

## References (load-bearing anchors)

- `server/Cargo.toml`, `migrate/Cargo.toml` — the `{ workspace = true }` deps to resolve.
- `server/src/read_model.rs:36`, `server/src/app.rs:41`, `migrate/src/migrate/accum.rs:30` — the
  three `vortex-utils` import sites.
- `server/build.rs:31-32`, `migrate/tests/postgres_e2e.rs:43-45`,
  `server/tests/measurement_id_golden.rs:43`, `web/lib/test-harness.ts:35` — the in-repo
  monorepo-relative references to fix.
- `server/src/records.rs`, `server/src/ingest.rs`, `server/src/schema.rs:223`,
  `web/lib/schema-version.ts` — the in-repo contract + version anchors.
- `infra/provision.sh`, `infra/README.md`, `ops/README.md`, `ops/config/vortex-bench.env.example`,
  `web/lib/db.ts`, `web/app/api/revalidate/route.ts` — infra/secrets surface.
- Monorepo `ct/bench-v4` checkout `/Users/connor/spiral/vortex-data/vortex4`: root `Cargo.toml`,
  `rust-toolchain.toml`, `.github/workflows/{web-deploy,web-keep-warm,schema-deploy}.yml`,
  `migrations/`, `scripts/{migrate-schema,post-ingest}.py` — the sources to mirror.
