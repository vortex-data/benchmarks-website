<!--
SPDX-License-Identifier: Apache-2.0
SPDX-FileCopyrightText: Copyright the Vortex contributors
-->

# decouple-from-monorepo — big-plans spine

<!-- Link to the brainstorming design spec rather than duplicating it. -->
**Design spec:** `.big-plans/ct__decouple-from-monorepo-design.md` (written by brainstorming in Phase 1 Step 1.2)
**Planning seed:** `.big-plans/decoupling-brief.md`
**Work shape:** migration

## Goal

Make the `benchmarks-website` repository fully self-sufficient — standalone build, its own CI,
its own secrets/deploy ownership, and a documented emitter→ingester contract — so the site iterates
without the `vortex-data/vortex` monorepo's CI. Retiring the monorepo copy and pruning legacy
generations are explicitly **future work**, not this project.

## Architecture & key decisions

<!-- A few bullets summarising the design. Full detail lives in the design spec — do not restate
     it here. Resolved decisions first, then the load-bearing findings the sweep confirmed. -->

**Resolved decisions** (see design spec for rationale):

- **Scope = make self-sufficient only.** Re-point deploys at this repo; touch nothing in the
  monorepo; defer all in-repo legacy pruning. v3 teardown + monorepo-copy retirement are future work.
- **v3 is temporary scaffolding** (kept because vortex lacks native emitters+ingestion). Keep it
  building/testing/deploying, do not gold-plate it, keep its seams clean for a future removal.
- **Decision (a) lints — pragmatic.** `clippy -D warnings` (+ `clippy.toml` if cheap); do NOT port
  the monorepo's heavy `[workspace.lints]` deny-list initially.
- **Decision (b) `migrations/` home — repo root** (`/migrations/`); fix the now-wrong relative paths
  in `migrate/tests` + `web/lib/test-harness.ts`.
- **Decision (c) contract versioning — `SCHEMA_VERSION`-anchored.** A contract doc + a CI consistency
  check across the TWO in-repo anchors (`server/src/schema.rs` + `web/lib/schema-version.ts` — NOT
  `migrate/src/lib.rs`, which has no such const; grill-me found that lockstep claim stale). The
  monorepo `post-ingest.py` consumer is documented, not cross-repo-tested.
- **Decision (d) Vercel — NEW project (grill-me).** This repo deploys to a new Vercel project it
  owns, not the monorepo's; deploys are CLI-keyed by `VERCEL_PROJECT_ID` and the monorepo's
  `web-deploy.yml` still fires, so sharing the project would race. A new project is the only
  race-free, monorepo-untouched path.
- **Decision (e) fmt — stable-compatible (grill-me).** Use a `rustfmt.toml` without nightly-only
  options so `cargo fmt --check` runs on stable 1.91.0; do not add a nightly toolchain just for fmt.
- **Verified pins (grill-me):** `hashbrown = "0.17.1"`, `reqwest = "0.13.0"` (copy features verbatim).
  DuckDB is `bundled` → default `cargo nextest run` is offline; the `#[ignore]`'d admin tests need
  network for the vortex extension and stay ignored in CI.
- **Phase order:** build → CI → contract doc → deploy/secrets (lowest external risk first, external
  infra last).

**Findings the sweep confirmed:**

- **Repo carries three generations side by side, all live.** Legacy Node/React v2 (top-level `server.js`,
  `src/`, `index.html`, `vite.config.js`, `public/`); Rust+DuckDB v3 (`server/`, `migrate/`, `ops/`,
  EC2/systemd, being retired); Next.js+Postgres v4 (`web/`, Vercel + RDS Postgres, the current
  forward path). v4 runs behind a dev-only Vercel domain pending a separate Phase-5 v3→v4 cutover.
- **Standalone Rust build is the gating blocker (workstream A).** No root `Cargo.toml`/`Cargo.lock`/
  `rust-toolchain.toml` exists here; `server/` + `migrate/` carry monorepo `{ workspace = true }`
  deps. The monorepo pins `channel = "1.91.0"`, `edition = "2024"`, `resolver = "2"`. The only
  monorepo-*internal* crate dep is `vortex-utils` (3 import sites, only `hashbrown` HashMap/HashSet
  aliases) — sever by depending on `hashbrown` directly. No vortex core crates are used.
  See design spec § Standalone workspace for the proposed root manifest.
- **The current (v4) CI lives only on the monorepo's unmerged `ct/bench-v4` branch**, not `develop`:
  `web-deploy.yml`, `web-keep-warm.yml`, `schema-deploy.yml`, `migrations/*.sql`, and
  `scripts/migrate-schema.py`. This repo has no `.github/` at all. That branch is the canonical CI
  to replicate here.
- **Two ingest contracts (workstream C).** v3 (`POST /api/ingest` → Rust server, hard-required,
  bearer auth, `SCHEMA_VERSION`-gated) is the old path. The v4 forward path is direct Postgres
  dual-write by monorepo CI (the `bench_ingest` RDS role via `GitHubBenchmarkIngestRole` OIDC)
  against the `migrations/` schema, followed by `POST /api/revalidate` (bearer
  `BENCH_REVALIDATE_TOKEN`) — currently best-effort (`continue-on-error: true`). The contract to
  version+document spans the records wire-shape, the `migrations/` DDL, and the revalidate token.
- **`migrations/` is the most-referenced missing directory** — needed by migrate tests, web tests,
  infra bootstrap, schema-deploy, and the v4 ingest schema. It lives only in the monorepo; its
  canonical home in this repo is an open design question.
- **Secrets split across three systems.** Vercel project env (the `bench_read` static password +
  `BENCH_DB_*` + `BENCH_REVALIDATE_TOKEN`), monorepo GitHub Actions secrets/vars (`VERCEL_TOKEN`,
  `VERCEL_ORG_ID/PROJECT_ID`, `INGEST_BEARER_TOKEN`, RDS connection vars), and AWS IAM (OIDC roles
  trust-pinned to `vortex-data/vortex`). See design spec § Secrets inventory for the full table.

## Out of scope

<!-- Bulleted, explicit. The gauntlet spec-adherence lens cross-references this list. -->

- **No pruning of ANY generation in this repo.** v2, v3, and v4 all stay — all three are live in
  different states. No legacy deletion in this project.
- **No changes to the monorepo.** No workflow trimming, no `benchmarks-website/` deletion, no
  freezing. All monorepo-side retirement is future work.
- **No v3 teardown.** v3 (`server/`/`migrate/`/`ops/`) stays as the ingestion bridge; its removal
  waits for native vortex emitters+ingestion (future work).
- No work that duplicates the monorepo's in-flight `ct/bench-v4 → develop` merge or the v3→v4
  Phase-5 production cutover — those are handled separately by the user; this project sequences
  around them.
- No re-authoring of the benchmark-*producing* logic — the emitter workflows (`bench`,
  `sql-benchmarks`, the `v3-commit-metadata` ingest step) stay in the monorepo; this project owns
  only the ingest *contract*, not the benchmark runs.
- No changes to monorepo crates (`vortex-utils`, `vortex-bench`, vortex core) beyond severing this
  repo's dependency on them.

## Risks

<!-- Numbered. For each: probability, impact, mitigation. -->

1. **Cutover entanglement.** The v4 CI/contract lives only on the unmerged monorepo `ct/bench-v4`
   branch, and all three generations are live. P=high; impact=severe; mitigation: this project
   touches nothing in the monorepo and defers all retirement/pruning, so it sequences around the
   cutovers rather than colliding with them.
2. **`vortex-utils` severance regressions.** Replacing the alias imports could subtly change hashing
   behavior. P=low; impact=moderate; mitigation: match the monorepo `hashbrown` pin exactly; verify
   `measurement_id` golden tests still pass.
3. **Missing `migrations/` breaks tests on arrival.** migrate/web tests `include_str!`/`readdirSync`
   a non-existent `migrations/`. P=med; impact=moderate; mitigation: bring `migrations/` in (decide
   canonical home) as part of the build/test phase, not deferred.
4. **Secrets migration has externalized side-effects** (Vercel, AWS IAM, GitHub secrets).
   P=med; impact=severe; mitigation: inventory-first (names only); every externalized change is a
   pre-action confirmation with the user; never copy secret values into the repo.
5. **SCHEMA_VERSION / wire-shape lockstep spans repos.** A shape or version bump must touch monorepo
   sites this project cannot see. P=low (this project shouldn't bump shapes); impact=severe;
   mitigation: BAN shape/version bumps as part of decoupling work (see Reviewer context).
6. **Toolchain/lint drift.** The crates don't inherit the monorepo's strict `[workspace.lints]`;
   "green" standalone may be looser. P=med; impact=minor; mitigation: decided — pragmatic lints
   (`clippy -D warnings`, no heavy deny-list port); match the `1.91.0` toolchain.
7. **Re-pointing live deploys.** All three generations are live, so re-pointing Vercel / the v3 EC2
   host risks disrupting live traffic. P=med; impact=severe; mitigation: Phase 4 re-points are
   validated / parallel where possible and gated on user confirmation; never a blind cutover.
8. **Cross-repo Vercel deploy race.** P=med; impact=moderate; mitigation: resolved by Decision (d) —
   a new, independently-owned Vercel project means this repo's CLI deploys cannot collide with the
   monorepo's deploys to its project.

---

## Current Position

```yaml
phase: "1: Standalone build foundation"   # current phase name (matches Phase Map)
sub_phase: "1.3 green-build"   # current sub-phase name (matches Phase Map); null between sub-phases
task: null                     # ADVISORY-ONLY — SDD's internal task cursor; never routed on
status: reviewing              # planning | implementing | reviewing | fixing | awaiting-human-gate | done | aborted
last_gate: null                # ISO 8601 timestamp of the most recent human gate, or null
phase_entry_sha: 5de7864b2ccace2ad42f17eb2e96a0787d1cac08   # SHA of the phase-entry commit (Phase 1)
```

---

## Phase Map

<!-- Each Phase = one squash-merged PR in THIS repo. Sub-phases run autonomously (no separate PRs).
     Exit criteria are machine-checkable (command → 0/non-0); Phase 4's live-infra sub-criteria are
     user-confirmed at the gate (noted in scope) on top of the machine-checkable command below.
     Task-plan pointers name the JIT writing-plans output generated in Phase 2 Step 2.1. -->

| Phase | Sub-phase | Scope (one line) | Exit criteria (command → expected) | Sub-phase gauntlet | Phase gauntlet | Task-plan pointer |
|---|---|---|---|---|---|---|
| 1: Standalone build foundation | 1.1 workspace | Root `Cargo.toml` workspace (`members = ["server","migrate"]`, resolver 2, `[workspace.package]`, `[workspace.dependencies]` inlined at exact monorepo pins incl. `hashbrown = "0.17.1"` + `reqwest = "0.13.0"` features); copy `rust-toolchain.toml`; sever `vortex-utils` → `hashbrown::{HashMap,HashSet}` (3 imports); `cargo generate-lockfile` | (phase-level — see phase row) | pr-3 | | `.big-plans/ct__decouple-from-monorepo--1-1-workspace.plan.md` |
| *(phase 1 cont.)* | 1.2 migrations-and-refs | Bring `migrations/` (7 SQL + README) to repo root + the `measurement_id` golden fixture; fix in-repo monorepo-relative refs (`server/build.rs` `.git` path; `include_str!` paths in `migrate/tests`; `server/tests/measurement_id_golden.rs`; `web/lib/test-harness.ts`) | | pr-2 | | `.big-plans/ct__decouple-from-monorepo--1-2-migrations-and-refs.plan.md` |
| *(phase 1 cont.)* | 1.3 green-build | Stable-compatible `rustfmt.toml` (no nightly-only opts); make `cargo build`/`nextest`/`web pnpm build` all green standalone | | pr-2 | | `.big-plans/ct__decouple-from-monorepo--1-3-green-build.plan.md` |
| *(phase 1 exit)* | *(all sub-phases)* | Repo builds + tests standalone | `cargo build --workspace --locked` → 0; `cargo nextest run -p vortex-bench-server -p vortex-bench-migrate` → 0; `(cd web && pnpm install --frozen-lockfile && pnpm build)` → 0 | | phase-4 | |
| 2: Own correctness CI | 2.1 rust-ci | `.github/workflows/rust-ci.yml` — `fmt --check`, `clippy --all-targets -- -D warnings`, `build --locked`, `nextest run`, `test --doc`; on push/PR; no creds | (phase-level — see phase row) | pr-2 | | `.big-plans/ct__decouple-from-monorepo--2-1-rust-ci.plan.md` |
| *(phase 2 cont.)* | 2.2 web-ci | `.github/workflows/web-ci.yml` — `pnpm format:check`/`lint`/DB-free `build`/`test` (with `docker info` guard); on push/PR; no creds | | pr-2 | | `.big-plans/ct__decouple-from-monorepo--2-2-web-ci.plan.md` |
| *(phase 2 exit)* | *(all sub-phases)* | CI green on the branch | `actionlint .github/workflows/*.yml` → 0; `gh run list --branch ct/decouple-from-monorepo --workflow rust-ci.yml -L1 --json conclusion -q '.[0].conclusion'` → `success`; same for `web-ci.yml` | | phase-3 | |
| 3: Emitter→ingester contract | 3.1 contract-doc | Write the versioned contract doc (v3 `POST /api/ingest` + v4 direct-Postgres dual-write + `POST /api/revalidate`, pinned to `SCHEMA_VERSION`); fix the stale `migrate/src/lib.rs` lockstep refs in `schema-version.ts` / `schema.rs` docstring / `AGENTS.md` | (phase-level — see phase row) | pr-2 | | `.big-plans/ct__decouple-from-monorepo--3-1-contract-doc.plan.md` |
| *(phase 3 cont.)* | 3.2 version-check | Add a consistency check asserting the TWO in-repo anchors agree (`server/src/schema.rs` ↔ `web/lib/schema-version.ts` ↔ the doc) | | pr-2 | | `.big-plans/ct__decouple-from-monorepo--3-2-version-check.plan.md` |
| *(phase 3 exit)* | *(all sub-phases)* | Contract documented + version-consistent | `test -f CONTRACT.md` → 0; the schema-version consistency check (test/script) → 0 | | phase-3 | |
| 4: Deploy + secrets/infra ownership | 4.1 deploy-workflows | `web-deploy.yml` (NEW Vercel project, git-integration off) + `web-keep-warm.yml` + `schema-deploy.yml` in `.github/`; bring `scripts/migrate-schema.py` in | (phase-level — see phase row) | pr-3 | | `.big-plans/ct__decouple-from-monorepo--4-1-deploy-workflows.plan.md` |
| *(phase 4 cont.)* | 4.2 secrets-runbook | Runbook for the external setup (create new Vercel project + env; this repo's GitHub secrets/vars; extend AWS IAM OIDC trust to this repo); execute external changes gated on user confirmation | | pr-2 | | `.big-plans/ct__decouple-from-monorepo--4-2-secrets-runbook.plan.md` |
| *(phase 4 cont.)* | 4.3 v3-host-repoint | Re-point the v3 EC2 host (`REPO_DIR`/`DEPLOY_BRANCH`) at this repo (ops config + docs); gated on user confirmation | | pr-2 | | `.big-plans/ct__decouple-from-monorepo--4-3-v3-host-repoint.plan.md` |
| *(phase 4 exit)* | *(all sub-phases)* | This repo owns its deploy + secrets (machine-checkable parts; live cutovers user-confirmed at the gate) | `actionlint .github/workflows/*.yml` → 0; `(cd web && vercel build --token="$VERCEL_TOKEN")` → 0; runbook file exists | | phase-4 | |

---

## Reviewer context

### Project-specific BANS — constraints gauntlet reviewers MUST ENFORCE

<!-- Extracted by the Phase 1 conventions-extraction sweep (Slot 6) from AGENTS.md, the monorepo
     CLAUDE.md, lint config, and the decoupling goal. A violation in the artifact under review is an
     immediate must-fix. -->

- **`monorepo coupling`**: do NOT add NEW references that point back into the monorepo (`../`,
  `vortex-bench/`, `../.github/`, `../scripts/`, `../CLAUDE.md`) — severing this coupling is the
  whole point; new back-references regress the goal. Existing ones are the cleanup target, not a
  precedent.
- **`v2 production files`**: do NOT edit the top-level v2 site (`server.js`, `src/`, `index.html`,
  `vite.config.js`, `package.json`, `package-lock.json`, `public/`, top-level `Dockerfile`,
  `docker-compose.yml`) or `publish-benchmarks-website.yml` outside the explicit legacy-prune phase —
  they remain production until cutover (AGENTS.md).
- **`SPDX headers`**: do NOT add a new source file (`.rs`, `.ts`, `.tsx`, `.js`, `.mjs`, `.py`,
  `.sh`, `.sql`, `.toml`, `.md`) without the two-line `SPDX-License-Identifier: Apache-2.0` +
  `SPDX-FileCopyrightText: Copyright the Vortex contributors` header (vendored Chart.js bundles
  exempt).
- **`wire shapes`**: do NOT change a record/wire shape in `server/src/records.rs` without changing
  the producer (`vortex-bench/src/v3.rs`), the migrator classifier (`migrate/src/classifier.rs`,
  until cutover), AND the snapshot fixtures in the SAME commit — the sites must agree or ingest 400s.
- **`SCHEMA_VERSION`**: do NOT bump `SCHEMA_VERSION` in `server/src/schema.rs` without bumping the
  hardcoded literal in `scripts/post-ingest.py` (and `web/lib/schema-version.ts`) in lockstep — a
  mismatch makes every CI ingest run 400.
- **`measurement_id`**: do NOT put `measurement_id` on the wire — it is a server-internal
  deterministic hash computed in `server/src/db.rs`; the migrator copies it verbatim, never
  recomputes it.
- **`?n=` cap`**: do NOT raise/remove the `MAX_NUMERIC_COMMIT_WINDOW` clamp (1000) in
  `server/src/api/window.rs`, and do NOT re-introduce a server-side cap on the `?n=all` escape
  hatch — `?n=all` is uncapped, downsampling is client-side LTTB.
- **`live-ingest classifier`**: do NOT write a server-side classifier for live ingest — the emitter
  produces v3-shape records directly; `migrate/src/classifier.rs` is one-time v2 translation that
  retires at cutover.
- **`client stack`**: do NOT reach for WASM — the client is SSR + a thin hydration script in
  `server/static/chart-init.js`.
- **`CI ingest`**: do NOT re-add `continue-on-error: true` to the v3 "Ingest results to v3 server"
  step in `bench.yml` / `sql-benchmarks.yml` / `v3-commit-metadata.yml` — v3 ingest is fail-loud
  (gated on `vars.V3_INGEST_URL != ''`).
- **`chart refetch`**: do NOT refetch on every pan/zoom/slider/range change — scope changes rebuild
  in place via in-memory LTTB; the only sanctioned hop is the latest-100→full-history `?n=all`
  lazy-fetch, fired once.
- **`tooltip`**: do NOT flip the tooltip predecessor walk from `idx - 1` to `idx + 1` (`commits[]`
  is oldest-first), and do NOT set `pointer-events: auto` on the tooltip host (causes a flicker
  loop); keep `pointer-events: none`.
- **`slider`**: do NOT use `change` events on the slider — use throttled `input` events.
- **`admin listener`**: do NOT mount `/api/admin/*` on the public listener or allow a non-loopback
  admin bind — the admin listener is loopback-only and public `/api/admin/*` must 404.
- **`admin SQL`**: do NOT widen `/api/admin/sql` beyond read-only (`SELECT`/`WITH`/`PRAGMA`/`SHOW`/
  `DESCRIBE`/`EXPLAIN` inside `BEGIN TRANSACTION READ ONLY`).
- **`secret values`**: do NOT commit any secret value — the secrets workstream is inventory + name
  only; values move via Vercel/AWS/GitHub settings out of band.

### Carry-forward (DO NOT re-flag)

#### Accepted tradeoffs

- (none yet)

#### Deferred work

- **Sub-phase 1.1**, `server/src/read_model.rs:36` / `server/src/app.rs:41` / `migrate/src/migrate/accum.rs:30`, **nit**: the new `use hashbrown::{HashMap,HashSet}` imports landed at the end of the extern-crate group rather than in alphabetical position. Deferral rationale: sub-phase 1.3 adds the stable-compatible `rustfmt.toml` and `cargo fmt` (with `imports_granularity`/`group_imports`) reorders these automatically — fixing by hand now would be undone/duplicated by the formatter.

---

## Verdict / Completion Ledger

### Phase 1: Standalone build foundation

#### Sub-phase 1.1: workspace

- **Shipped:** standalone root `Cargo.toml` workspace (`members = ["server","migrate"]`, resolver 2, `[workspace.package]` + `[workspace.dependencies]` inlined at exact monorepo pins); `rust-toolchain.toml` (stable 1.91.0); `vortex-utils` severed → direct `hashbrown 0.17.1` at 3 import sites; `Cargo.lock` generated; `/target` gitignored. `cargo build --workspace --locked` green.
- **Gauntlet:** pr-3 / accepted (cycles: 3)
- **Deferred:** 1 item (import ordering of the new `hashbrown` imports — see Carry-forward > Deferred work; sub-phase 1.3 rustfmt resolves it)

#### Sub-phase 1.2: migrations-and-refs

- **Shipped:** vendored `migrations/` (7 SQL + README, byte-identical from monorepo) + `scripts/measurement_id_golden.json`; re-rooted 4 in-repo monorepo-relative path refs (`server/build.rs` `.git`, `migrate/tests/postgres_e2e.rs` `include_str!` ×3, `web/lib/test-harness.ts`, `server/tests/measurement_id_golden.rs`). `cargo nextest` green (229 passed, 4 Docker-gated skips).
- **Gauntlet:** pr-2 / accepted (cycles: 1) — diff narrowed past the 200KB ceiling by excluding the generated `Cargo.lock` + planning docs (validated separately by `cargo build --locked`).
- **Deferred:** 0 items (3 dismissed nits in vendored files: Phase-4 forward-refs in `migrations/README.md` + golden JSON note, and a monorepo-prefixed path string in the golden note — trivial, self-resolving or in verbatim fixtures).
