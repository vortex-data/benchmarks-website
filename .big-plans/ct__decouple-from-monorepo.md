<!--
SPDX-License-Identifier: Apache-2.0
SPDX-FileCopyrightText: Copyright the Vortex contributors
-->

# decouple-from-monorepo — big-plans spine

<!-- Link to the brainstorming design spec rather than duplicating it. -->
**Design spec:** `.big-plans/ct__decouple-from-monorepo-design.md` (written by brainstorming in Phase 1 Step 1.2)
**Planning seed:** `.big-plans/decoupling-brief.md`
**Work shape:** migration

## Execution model & handoff — READ FIRST (overrides big-plans defaults)

**STACKING MODE (user decision, 2026-06-17).** This project does NOT squash-merge each
phase to `develop`. All phases stack on the single branch `ct/decouple-from-monorepo` and
merge **once at the very end**. Nothing needs to land on `develop` per-phase. This overrides
big-plans' default per-phase merge. Concretely, for a fresh conversation resuming this project:

- **At each phase-boundary gate (Phase 3 Step 3.4):** still run the phase-end gauntlet (Step 3.2)
  and still fire the gate AUQ. But **SKIP Step 3.3 (per-phase PR creation) and SKIP Step 3.5's
  shared merge-and-sync preamble** (no `gh pr create`, no `gh pr merge --squash`, no
  `git reset --hard origin/develop`). The user reviews the local diff + gauntlet verdict + the
  executive summary at the gate, not a per-phase GitHub PR.
- **On a "proceed" gate decision:** just advance to the next phase on the SAME branch via the
  phase-advance two-commit pattern, with `phase_entry_sha` = the current HEAD (the previous
  phase's tip). No merge, no branch reset — so `phase_entry_sha` simply chains down the branch.
- **At the FINAL phase (Phase 4) wrap-up:** land the spine-deletion commit, then open ONE PR for
  the whole branch and the user merges everything at once. (This is the only PR + the only merge.)
- **Pushing:** nothing has been pushed yet. Do not push until the user asks (the single final PR
  is when the push happens, unless the user requests an earlier push).

**PHASE-2 BATCHED REVIEW (user decision, 2026-06-17).** Phase 2's sub-phases (2.1 rust-ci, 2.2
web-ci) are small CI-config units; a full per-sub-phase gauntlet is disproportionate. For Phase 2
ONLY, the per-sub-phase gauntlet checkpoints (Step 2.3) are REPLACED by lightweight checks (SDD
per-task spec/quality review + `actionlint`) during each sub-phase, plus ONE consolidated gauntlet
(`phase-3`) over the full Phase-2 `.github/` diff at the phase boundary (Step 3.2) — reviewing both
workflows together, including the 2.1 cycle-1 gauntlet fixes (cache-ordering, concurrency key,
naming) that already landed. The 2.1 cycle-1 gauntlet already ran once and its must-fix items were
addressed (SHA-pin reverted to floating tags per the accepted tradeoff above); 2.1's authoritative
review is the consolidated Phase-2 gauntlet. (Other phases keep the default per-sub-phase cadence.)

**PHASE-3 BATCHED REVIEW (decision, 2026-06-18).** Per the recorded review-granularity preference
(user, 2026-06-17), Phase 3's deliverables are small (a `CONTRACT.md` doc + a schema-version
consistency check across two in-repo anchors) and do not each warrant a full multi-agent gauntlet.
For Phase 3 ONLY, the per-sub-phase gauntlet checkpoints (Step 2.3) for 3.1 (contract-doc) and 3.2
(version-check) are REPLACED by lightweight checks during each sub-phase (SDD per-task spec/quality
review + the phase exit-criteria commands — `test -f CONTRACT.md`, the consistency check), plus ONE
consolidated `phase-3` gauntlet over the full Phase-3 diff at the phase boundary (Step 3.2). (Other
phases keep the default per-sub-phase cadence; Phase 4 returns to per-sub-phase gauntlets given its
deploy/secrets risk.)

**Resume / handoff.** The spine is the durable contract. A fresh conversation takes over by
re-invoking `/spiral:big-plans` on the `ct/decouple-from-monorepo` branch — Phase 0 reads the
Current Position block below and resumes. Current state: **Phase 2 COMPLETE — both correctness
workflows shipped (`rust-ci.yml`, `web-ci.yml`), consolidated `phase-3` gauntlet ACCEPTED (0
must-fix), human gate = proceed (2026-06-17). Branch PUSHED to origin; CI CONFIRMED GREEN on HEAD
`8376223` (rust-ci + web-ci both `success`, 2026-06-18) — closes the deferred Phase-2 `gh run list`
exit criterion. NOW AT Phase 3 (Emitter→ingester contract) entry: sub-phase 3.1 (contract-doc),
Step 2.1 (generate the JIT task-plan via `writing-plans`). No work in flight; clean seam.**

**For the fresh conversation — review-granularity preference (user, 2026-06-17):** do NOT run a full
multi-agent gauntlet for every small (~60 LoC) change. Batch related small changes and review them
together, OR reserve the full gauntlet for substantive changes + phase boundaries. Phase 3's
deliverables (a `CONTRACT.md` + a schema-version consistency check) are small — consider the same
batched/consolidated review approach used for Phase 2 rather than a separate gauntlet per sub-phase.

See the Verdict/Completion Ledger for what shipped and Carry-forward for accepted tradeoffs + Phase-3
cleanup items.

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
phase: "3: Emitter→ingester contract"   # current phase name (matches Phase Map)
sub_phase: null                # current sub-phase name (matches Phase Map); null between sub-phases
task: null                     # ADVISORY-ONLY — SDD's internal task cursor; never routed on
status: reviewing              # planning | implementing | reviewing | fixing | awaiting-human-gate | done | aborted
last_gate: 2026-06-17T19:10:20Z   # ISO 8601 timestamp of the most recent human gate, or null
phase_entry_sha: a6a1861f8233441c821ed3c08fa8904170eeb513   # SHA of the phase-entry commit (Phase 3)
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
| *(phase 2 cont.)* | 2.2 web-ci | `.github/workflows/web-ci.yml` — `pnpm format:check`/`lint`/DB-free `build`/`test` (with `docker info` guard); on push/PR; no creds | | pr-2 | | *(no JIT plan — authored directly from the monorepo `web-deploy.yml` template under PHASE-2 BATCHED REVIEW)* |
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

- **Phase 2** (`.github/workflows/rust-ci.yml` AND `.github/workflows/web-ci.yml`), **third-party actions use floating `@vN` tags, not commit SHAs** (gauntlet u-1, must-fix → OVERRIDDEN by user decision 2026-06-17). Decision: USE floating tags across BOTH workflows — `actions/checkout@v4`, `Swatinem/rust-cache@v2`, `taiki-e/install-action@v2` (rust-ci) and `actions/checkout@v4`, `actions/setup-node@v4` (web-ci). The supply-chain risk of mutable tags is accepted in exchange for simpler maintenance and auto-tracking the latest `vN` release; both jobs are least-privilege (`permissions: contents: read`). This OVERRIDES the gauntlet correctness lens's must-fix and the monorepo's SHA-pin convention. DO NOT re-flag.
- **Phase 2** (`.github/workflows/rust-ci.yml` + `web-ci.yml`), **`push:` trigger has no `branches:` filter** (gauntlet u-3, should-fix). Decision: KEEP the bare `push:`. STACKING MODE opens no PR until the final wrap-up, so the Phase-2 exit criterion (`gh run list --branch ct/decouple-from-monorepo --workflow <wf>.yml → success`) can only be satisfied by a `push`-triggered run on the feature branch — a `branches:` filter that excluded `ct/decouple-from-monorepo` would make the exit criterion unsatisfiable. (Correction per the Phase-2 consolidated gauntlet finding c-1: the `push`+`pull_request` double-fire once a PR exists is NOT de-duped by the `concurrency` group — the two events carry different refs (`refs/heads/…` vs `refs/pull/N/merge`) and land in different groups — but the extra run is a minor, bounded cost and, under stacking mode, only occurs at the single final PR.) DO NOT re-flag.
- **Sub-phase 2.1** (`.github/workflows/rust-ci.yml`), **`cargo build --workspace --locked` overlaps `cargo clippy --all-targets`** (gauntlet u-4, should-fix). Decision: KEEP the explicit `Build` step — it is a spec-mandated check (Phase Map 2.1 scope lists `build --locked`) and serves as an explicitly-named build gate in the CI UI distinct from the lint step. The cached re-compile cost is negligible. DO NOT re-flag.
- **Sub-phase 2.1** (`.github/workflows/rust-ci.yml`), **clippy/nextest run without `--all-features`** (gauntlet u-6 / u-10, should-fix / nit). Decision: do NOT add `--all-features`. The spec scopes the checks to default features; the workspace crates (`vortex-bench-server`, `vortex-bench-migrate`) define no own feature matrix that needs coverage, and `--all-features` would pull non-default dependency feature combinations that were never built/tested in Phase 1 (risking spurious CI failures). DO NOT re-flag.

#### Deferred work

- **Sub-phase 1.1**, `server/src/read_model.rs:36` / `server/src/app.rs:41` / `migrate/src/migrate/accum.rs:30`, **nit**: the new `use hashbrown::{HashMap,HashSet}` imports landed at the end of the extern-crate group rather than in alphabetical position. Deferral rationale: sub-phase 1.3 adds the stable-compatible `rustfmt.toml` and `cargo fmt` (with `imports_granularity`/`group_imports`) reorders these automatically — fixing by hand now would be undone/duplicated by the formatter. **RESOLVED in sub-phase 1.3** (the `cargo fmt` reformat reordered them).
- **Phase 1 phase-end (→ Phase 3 cleanup)**, **nit cluster**: stale monorepo-perspective references in docs/comments — (a) the `benchmarks-website/`-prefixed path in the golden-JSON note (regenerated from `server/tests/measurement_id_golden.rs`'s note string), (b) `benchmarks-website/`-prefixed paths + monorepo PR numbers in vendored `migrations/*.sql` comments + `migrations/README.md`, (c) dead rustdoc links to `../../../vortex-bench/src/v3.rs` in `server/src/records.rs:123` + `server/src/schema.rs:218`, and the stale `migrate/src/lib.rs` lockstep-site mention in `web/lib/schema-version.ts:13`. Deferral rationale: Phase 3 (emitter→ingester contract doc) already owns stale-reference cleanup + the `schema-version.ts` lockstep-list fix; the vendored-SQL comments are frozen-post-apply (edit only when next touched); none affect the build/tests. Bundling the cleanup into Phase 3 avoids churning vendored files at the phase boundary. **(c) RESOLVED in sub-phase 3.1** (both dead `../vortex-bench` rustdoc links dropped; stale `migrate/src/lib.rs` mention removed; all cross-ref `CONTRACT.md`). **(a)+(b) remain deferred** per the frozen-vendored / self-resolving rationale — not in 3.1's scope, cosmetic, no build/test impact.

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

#### Sub-phase 1.3: green-build

- **Shipped:** stable-compatible `rustfmt.toml` (`style_edition = "2024"` + `use_field_init_shorthand = true`; nightly-only opts dropped); `cargo fmt --all` reformat (reordered the 3 hashbrown imports — resolves the deferred 1.1 nit). Full green bar: `build --locked`, `fmt --check`, `clippy -D warnings`, `nextest` (229 passed / 4 Docker-gated skip), web `format:check`/`lint`/`build` all green.
- **Gauntlet:** pr-2 / accepted (cycles: 1) — zero findings; diff narrowed past the 200KB ceiling (excluding generated `Cargo.lock` + planning docs).
- **Deferred:** 0 items. (The deferred 1.1 import-ordering nit is now RESOLVED by the fmt reformat.)

#### Phase 1 gate

- **Gauntlet:** phase-4 / accepted (cycles: 1) — 4 lenses (spec/correctness/maint/arch), 0 must-fix, 0 should-fix; nits deferred to Phase 3 stale-reference cleanup (see Carry-forward > Deferred work).
- **Exit criteria:** all PASS — `cargo build --workspace --locked`, `cargo nextest` (229 passed / 4 Docker-gated skip), web `pnpm build`; plus `cargo fmt --check` + `cargo clippy -D warnings` clean.
- **Human gate:** 2026-06-17T18:14:38Z — proceed (STACKING MODE: no per-phase merge; advance to Phase 2 on the same branch — see "Execution model & handoff" at the top of the spine).
- **Not merged:** per stacking mode, Phase 1 stays on `ct/decouple-from-monorepo`; it merges with everything else in the single final PR.

### Phase 2: Own correctness CI

#### Sub-phase 2.1: rust-ci

- **Shipped:** `.github/workflows/rust-ci.yml` — `fmt --check`, `clippy --all-targets -D warnings`, `build --locked`, `nextest`, doctests; on push/PR; least-privilege `contents: read`; no creds. Cycle-1 gauntlet (pr-2) fixes applied: cache-before-toolchain ordering, stable `rust-ci-${{ github.ref }}` concurrency key, job-name + doctest-split clarity. Action tags left floating (`@v4`/`@v2`) per accepted tradeoff.
- **Review:** lightweight (actionlint clean; cycle-1 gauntlet pr-2 ran once, must-fix items addressed). Authoritative adversarial review = the consolidated Phase-2 gauntlet (PHASE-2 BATCHED REVIEW).
- **Deferred:** see Carry-forward > Accepted tradeoffs (floating-tags + u-3/u-4/u-6/u-10 declines).

#### Sub-phase 2.2: web-ci

- **Shipped:** `.github/workflows/web-ci.yml` — adapted from the monorepo `ct/bench-v4` `web-deploy.yml` Check&Test job: pnpm 11.5.2, node 24, `install --frozen-lockfile`, `format:check`, `lint`, DB-free `next build`, `docker info`-guarded vitest (testcontainers Postgres); on push/PR; least-privilege; no creds. Verified locally: format/lint/build green, 301 tests pass.
- **Review:** lightweight (actionlint clean + full local command verification). Authoritative adversarial review = the consolidated Phase-2 gauntlet (PHASE-2 BATCHED REVIEW).
- **Deferred:** 0.

#### Phase 2 gate

- **Gauntlet:** phase-3 (consolidated, spec+correctness+maint) / accepted (cycles: 1) — 0 must-fix across all three lenses; verdict accept. Should-fix/nits applied in `f24b356` (concurrency-comment correctness fix in both workflows, `rust-ci` `timeout-minutes: 45`, node/components comment clarity) plus spine fixes (floating-tags tradeoff broadened to web-ci's `setup-node`, u-3 double-fire-de-dup-claim correction, 2.2 task-plan pointer de-dangled). Sub-phase 2.1's earlier pr-2 cycle-1 is subsumed here per PHASE-2 BATCHED REVIEW.
- **Exit criteria:** `actionlint .github/workflows/*.yml` → 0 **PASS**. The `gh run list … → success` criteria were deferred at the gate; the branch was pushed at the user's request immediately after, and both runs are now **CONFIRMED GREEN** on HEAD `8376223` (`rust-ci` + `web-ci` both `success`, observed 2026-06-18) — criterion SATISFIED. (All CI step-commands had also been verified green locally — rust: Phase-1 green bar incl. fmt/clippy/build/nextest/doctest; web: format/lint/build + 301 tests.)
- **Human gate:** 2026-06-17T19:10:20Z — **proceed** (STACKING MODE: no per-phase merge; advance to Phase 3 on the same branch). At the user's request the branch was **PUSHED to origin** (first push — carries Phase 1 + Phase 2; triggers `rust-ci` + `web-ci` on GitHub, which confirms the deferred `gh run list → success` exit criterion once the runs land). **CI CONFIRMED GREEN** on HEAD `8376223` (rust-ci + web-ci both `success`, 2026-06-18) — deferred criterion SATISFIED.

### Phase 3: Emitter→ingester contract

#### Sub-phase 3.1: contract-doc

- **Shipped:** repo-root `CONTRACT.md` — the versioned emitter→ingester contract (v3 `POST /api/ingest` envelope shape + records-by-`kind` + the full HTTP response matrix; v4 direct-Postgres dual-write + `POST /api/revalidate`; pinned to `SCHEMA_VERSION = 1`; in-repo anchors `schema.rs`/`schema-version.ts` vs cross-repo monorepo producer/consumer; bump procedure). Plus the Phase-3-owned stale/dead cross-repo ref cleanup: removed the stale `migrate/src/lib.rs` lockstep bullet from `web/lib/schema-version.ts` (that file has no such const) and de-prefixed/grouped its anchor list; dropped the two dead `../../../vortex-bench/src/v3.rs` rustdoc links in `server/src/records.rs` + `server/src/schema.rs`; added a `CONTRACT.md` cross-ref + the in-repo web anchor to `AGENTS.md`. `SCHEMA_VERSION` unchanged (= 1); docs/comments only, zero behavior change.
- **Review:** lightweight per **PHASE-3 BATCHED REVIEW** — SDD fresh-subagent-per-task spec+quality review (4/4 tasks Approved, 0 Critical/Important/Minor findings) + `test -f CONTRACT.md` → 0. Toolchain checks green: `cargo doc --no-deps`/`build --locked`/`clippy --all-targets -D warnings` clean (Task 3); web `vitest` (schema-version test pass) + `format:check` + `lint` clean (Task 2). Authoritative adversarial review = the consolidated Phase-3 gauntlet at the boundary (Step 3.2).
- **Deferred:** 0 new items. Resolves item (c) of the Phase-1→Phase-3 deferred stale-reference cluster (see Carry-forward > Deferred work); items (a)+(b) (golden-JSON note path; vendored `migrations/*.sql` comments) stay deferred per their frozen-vendored / self-resolving rationale.

#### Sub-phase 3.2: version-check

- **Shipped:** strengthened `web/lib/schema-version.test.ts` from a hardcoded `expect(SCHEMA_VERSION).toBe(1)` literal into a real cross-anchor consistency check — it reads `server/src/schema.rs` + `CONTRACT.md` from disk (`fileURLToPath`/`readFileSync`, the `test-harness.ts` sibling-read pattern) and asserts the three in-repo anchors agree (schema.rs Rust const ↔ imported TS `SCHEMA_VERSION` ↔ CONTRACT.md's quoted anchor declarations), throwing a named error on any missing/renamed anchor (loud fail, not silent pass). Auto-runs in `web-ci`. `SCHEMA_VERSION` unchanged (= 1); the three anchor files are read-only (verified `git status` clean post-task).
- **Review:** lightweight per **PHASE-3 BATCHED REVIEW** — SDD spec+quality review (Approved, 0 Critical/Important). Test teeth proven via a temporary-drift check (bump `schema.rs`→2 ⇒ the `matches server/src/schema.rs` test FAILS with `expected 2 to be 1`, then reverted). `cd web && pnpm vitest run lib/schema-version.test.ts` → 0 (3/3) + `format:check` + `lint` clean. Authoritative adversarial review = the consolidated Phase-3 gauntlet at the boundary.
- **Deferred:** 2 cosmetic Minor notes for the consolidated phase-3 gauntlet to triage (a transitive-coverage clarifying comment; an optional defensive `NaN` guard in the helper — unreachable given the `(\d+)` capture). Neither is a functional gap.
- **Design tradeoff (deliberate, see design spec decision (c) + Architecture):** the cross-language consistency check lives in the web vitest suite (auto-runs in `web-ci` on every push) rather than a neutral standalone script — a neutral script would need new CI workflow wiring (Phase-2 scope) to auto-run, which the user's minimal-review preference disfavors. Drift is still caught pre-merge.
