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

**PHASE-4 SOURCING CORRECTION (Class B plan-assumption, 2026-06-18).** The Phase-1 sweep + design
spec (§ "CI to replicate", ~L107/L121) claimed the benchmarks-website Vercel deploy workflows
`web-deploy.yml` + `web-keep-warm.yml` live on the monorepo `ct/bench-v4` branch to "adapt from".
**VERIFIED FALSE** — neither exists anywhere in `vortex-data/vortex` (checked `origin/ct/bench-v4`
tree + full git history; the only `web.yml` there is the unrelated vortex-web→Cloudflare explorer).
The benchmarks-website v4 site currently deploys via Vercel's GIT INTEGRATION, not a committed
workflow. **Resolution (NO architecture/scope change — decision (d) already settled "NEW Vercel
project, git-integration off, CLI-keyed deploy"):** AUTHOR `web-deploy.yml` (Vercel CLI
`pull`/`build`/`deploy --prebuilt`) and `web-keep-warm.yml` (cron curl) FRESH per the design spec's
stated shapes; ADAPT `schema-deploy.yml` + bring in `scripts/migrate-schema.py` from the REAL sources
at `origin/ct/bench-v4` (convert its SHA-pinned actions → floating `@vN` tags per the accepted
floating-tags tradeoff). Reconcile `web-keep-warm.yml`'s purpose against the existing
`web/vercel.json` `/api/health` cron (every 2 min) rather than blindly duplicating it. This is the
Class-B finding for Phase 4 (within the 0–2/phase budget); no user gate needed — surfaced here for
the audit trail.

**Resume / handoff.** The spine is the durable contract. A fresh conversation takes over by
re-invoking `/spiral:big-plans` on the `ct/decouple-from-monorepo` branch — Phase 0 reads the
Current Position block below and resumes. Current state: **Phase 4 (Deploy + secrets/infra ownership)
ALL SUB-PHASES COMPLETE — 4.1 deploy-workflows (web-deploy/web-keep-warm/schema-deploy + vendored
migrate-schema.py; pr-3 accepted, 2 cycles), 4.2 secrets-runbook (`docs/runbooks/deploy-secrets-setup.md`
+ `.gitignore` `.vercel`; pr-2 accepted, 6 cycles), 4.3 v3-host-repoint (ops env/deploy.sh/install.sh
standalone-layout fixes + `docs/runbooks/v3-host-repoint.md`; pr-2 accepted, 5 cycles — OVER-INVESTED
on temp v3 scaffolding per user, stopped). NOW AT the Phase-4 boundary (Phase 3): Step 3.1 exit-criteria
→ Step 3.2 phase-4 gauntlet over the cumulative Phase-4 diff → Step 3.4 mandatory human gate. STACKING
MODE: no per-phase PR/merge; the gate's "proceed" (this is the FINAL phase) routes to Phase 4 wrap-up
(spine deletion + the single final PR for the whole branch). Externalized Phase-4 changes (Vercel/AWS/
GitHub console + the v3 host re-point) are user-gated and documented in the two runbooks — NOT executed
by this project. Exit-criteria note: the `vercel build` live check needs creds (user-confirmed at the
gate); `actionlint` + `runbook file exists` are machine-checkable and pass.**

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
phase: "4: Deploy + secrets/infra ownership"   # current phase name (matches Phase Map)
sub_phase: null                # current sub-phase name (matches Phase Map); null between sub-phases
task: null                     # ADVISORY-ONLY — SDD's internal task cursor; never routed on
status: reviewing              # planning | implementing | reviewing | fixing | awaiting-human-gate | done | aborted
last_gate: 2026-06-18T16:40:12Z   # ISO 8601 timestamp of the most recent human gate, or null
phase_entry_sha: 32fa175682f4eb1870dc69c863ed3bd5429bc9ec   # SHA of the phase-entry commit (Phase 4)
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

- **Phase 3 gauntlet cycle-2 should-fix (deferred)**, `server/src/ingest.rs:16` (the `//!` module-doc HTTP matrix), **should-fix** (found_by spec+maint): the in-code HTTP-matrix comment still conflates serde `Malformed` (400, body `{"error":"malformed"}`, **no** `record_index`) with per-record `Record` (400, body `{"error":"record","record_index":N}`) — the SAME conflation that sub-phase 3.1's fix (`0f374f4`) corrected in the new authoritative `CONTRACT.md`. **Runtime code is correct** (only the doc comment is stale); `ingest.rs` is NOT a Phase-3 artifact (Phase 3 never touched it). Deferred per gauntlet's "capture out-of-artifact findings as deferred, don't sprawl" — align `ingest.rs:16` with `CONTRACT.md` + `error.rs` when `ingest.rs` is next touched (or in a dedicated v3-doc pass). **Surfaced at the Phase-3 gate for the user's amend-vs-defer decision.**

- **Sub-phase 4.1 gauntlet cycle-1 should-fix/nits (deferred — vendored-upstream `scripts/migrate-schema.py`)**: gauntlet `pr-3` cycle 1 flagged minor quality items that live in the **byte-identical-vendored** `migrate-schema.py` (re-vendored from monorepo commit `c305985e5`, the generation matching this repo's `migrations/` + README; the cycle-1 **must-fix** — the missing `requires-superuser` preflight — was fixed by that re-vendor): (a) **should-fix** — `main()` catches only `FileNotFoundError`, so two other exceptions surface as a Python traceback instead of the clean stderr+exit path: an empty/whitespace-only migration file raises `ValueError` (operator-error edge), and the `requires-superuser` preflight raises `PermissionError` when a least-privilege `migrator` role hits a marked migration before the master bootstrap (a normal bootstrap-ordering scenario — the guard still fails loud + non-zero with no partial DDL, only the message is traceback-wrapped). Both flagged by gauntlet cycle-2 (fresh+correctness); both are upstream `c305985e5` behavior; (b) **should-fix** — `status()` summary counts `len(applied)` from the ledger, which includes orphaned (applied-but-deleted) rows, making the "N applied" line mildly misleading when orphaned>0; (c) **should-fix** — `apply()`'s docstring doesn't state the per-migration-transaction failure-isolation contract (a failure at migration N leaves 0..N-1 committed); (d) **nits** — single-use `_PARSER_DESCRIPTION` constant, `psycopg.connect("")` empty-DSN behavior undocumented, `discover()` `is_dir()` symlink edge. **Deferral rationale:** all exist verbatim in the proven upstream `c305985e5` version; the project's principle is **vendor byte-identical, don't gold-plate scaffolding** (the v3 / migration toolkit is temporary — see Architecture). Modifying the vendored script for cosmetic/edge-case quality would diverge from the proven generation for marginal benefit. None affects the build, the workflow YAML (`actionlint` clean), or the now-resolved preflight contract. Address if/when this repo takes ownership of the migration toolkit beyond a verbatim vendor.

- **Sub-phase 4.1 gauntlet cycle-2 should-fix (deferred — `schema-deploy.yml` header doc-clarity)**: the bootstrap header comment ("Every subsequent apply runs here as `migrator`") is imprecise — the 5 `requires-superuser` migrations (002/004/005/006/007) are applied **out-of-band by the master**, not via this workflow, so "every subsequent apply" via CI is migrator-only but the phrasing can be misread as "all migrations after the first run as migrator". The runtime preflight catches any real misconfiguration loudly. **Deferral rationale:** cosmetic doc-clarity on a gauntlet-ACCEPTED artifact (maint rated `amend_plan: no`); fixing post-accept would need a re-review cycle for a one-line comment. Tighten the header wording when `schema-deploy.yml` is next edited (e.g. in the Phase-4.2 runbook work, which documents the same bootstrap ordering).

- **Sub-phase 4.2 gauntlet cycle-6 residual should-fixes/nits (deferred — `docs/runbooks/deploy-secrets-setup.md` doc-precision)**: the runbook was gauntlet-ACCEPTED (pr-2, 6 cycles, 0 must-fix at accept; cycles 3–6 were all 0-must-fix, surfacing progressively finer precision tweaks on the bootstrap paragraph — the long tail). Residual non-blocking items the final cycle raised: (a) **should-fix** — D.5 step 1 says "see `migrations/README.md` for the connection procedure", but the concrete master-connection procedure (env vars, Secrets-Manager fetch, `PGSSLMODE=verify-full`, CA bundle, the `uv run … migrate-schema.py apply` invocation) lives in `infra/README.md` § One-time bootstrap — point D.5 step 1 there (the Overview already cross-refs `infra/README.md` correctly); (b) **should-fix** — the E.2 note slightly overstates the missing-`003` dry-run failure mode: a missing `migrator` role (`002`) fails loudly at connection, but a missing `003` ledger-grant makes the `status` SELECT raise a permission error that the workflow's `if/else` still exits `0` on (so it "passes" but the log shows the error) — tighten the wording to distinguish the two; (c) **nits** — D.5's intro "these migrations must be applied" could read as "only the marked subset" (step 2's full-apply instruction resolves it); the root `.gitignore` `.vercel` entry's dual purpose (repo-root build artifact + `web/.vercel/`) is undocumented; E.1's `read -rs` is bash/zsh syntax while the operator's shell may be fish (`read -s`). **Deferral rationale:** all are doc-precision on a gauntlet-accepted operator runbook; the load-bearing content (consumer table, secret handling, OIDC trust JSON, full-bootstrap-apply instruction, verification sequence) is correct; address when the runbook is next edited (e.g. alongside the actual external execution).

- **Sub-phase 4.3 — `ops/BOOTSTRAP.md` monorepo-layout cleanup (deferred)**: sub-phase 4.3 fixed the ops **scripts** for the standalone layout (`ops/deploy.sh` path filter → `server`/`migrate`; `ops/install.sh` `ops_dir` → `${REPO_DIR}/ops`, `REPO_DIR` default → `$HOME/benchmarks-website`, remote hint → `benchmarks-website.git`) so the v3-host re-point actually works. **`ops/BOOTSTRAP.md`** (the large from-scratch-install / disaster-recovery doc) still carries monorepo-layout references (`https://github.com/vortex-data/vortex.git`, `~/vortex`, `cd ~/vortex && git clone`, `./benchmarks-website/ops/install.sh`, `REPO_DIR=/home/ec2-user/vortex`). **`ops/README.md`** likewise has stale monorepo-layout bits the cycle-4 gauntlet surfaced: its § "Identifying the running build" says "three identifiers agree" (the binary symlink is a build-timestamp filename, not a commit SHA — only the stamp + health `build_sha` are comparable SHAs), and its "State on disk" table + architecture diagram show the old `<repo>/benchmarks-website/ops/` symlink target / `~/vortex/...` paths. **Deferral rationale:** v3 is temporary scaffolding (Architecture: "do not gold-plate"); the re-point runbook (`docs/runbooks/v3-host-repoint.md`) documents the standalone substitutions an operator needs (and its Step-4 verification block already states the symlink-is-a-timestamp caveat inline), so a wholesale rewrite of these v3 ops docs is disproportionate for docs that retire with v3. Rewrite (or delete) `ops/BOOTSTRAP.md` + refresh `ops/README.md`'s layout/identifier wording if/when v3 ownership deepens or at the v3 teardown.

- **Phase-4 phase-end gauntlet should-fixes (deferred — surfaced at the Phase-4 gate)**: the `phase-4` gauntlet (spec+correctness+maint+arch) ACCEPTED with 0 must-fix; these non-blocking should-fixes were raised (none in v3 ops-script code — the v3 work is done):
  1. **`web-deploy.yml` (v4)** — the Build/Deploy steps interpolate `${{ steps.target.outputs.env }}` directly into the `run:` shell, inconsistent with the injection-safe `env:` pattern the Resolve-target step uses. Injection-safe in practice (value is constrained to `preview`/`production`); pass via `env:` for consistency. [spec+arch]
  2. **`schema-deploy.yml`** — the client-side `PGPASSWORD` (RDS IAM token, ~15-min TTL) is not registered with `::add-mask::`; `set -x` is correctly avoided, but masking is defense-in-depth. [arch]
  3. **`web-keep-warm.yml`** — no explicit branch guard; the header says "scheduled runs fire only on the default branch" (true for `schedule:`, but `workflow_dispatch` fires from any branch). Add an `if:` guard or soften the comment. [arch]
  4. **Workflow-header phase jargon** — `web-deploy.yml`/`schema-deploy.yml` headers reference "Phase-4 decision (d)" / "4.1 only authors + actionlint-validates" / vague "Phase-4.2 runbook" without a path. Replace with permanent-state wording + the explicit `docs/runbooks/deploy-secrets-setup.md` path. [maint] (The `cycle-1` jargon in `migrate-schema.py`'s docstring is UPSTREAM/vendored-byte-identical — leave per the vendor principle.)
  5. **`deploy-secrets-setup.md` loop-not-closed** — Section D extends the OIDC trust but never tells the operator to then enable the `schema-deploy.yml` push trigger (the workflow's `TODO(phase-4.2)` points at the runbook); add that step to Section D/E. [maint]
  6. **`schema-deploy.yml` `PGSSLROOTCERT`** placement in the shell body (vs the `env:` block, because it depends on the runtime `RUNNER_TEMP`) is correct but undocumented — add a one-line inline comment. [maint]
  (Already-deferred items the gauntlet re-noted: `migrate-schema.py` `main()` `ValueError`/`PermissionError` traceback + `status()` orphaned-count [4.1 deferred]; `deploy-secrets-setup.md` D.5 cross-ref → `infra/README.md` [4.2 cycle-6 deferred]. The arch a-5 "`deploy.sh` `server` pathspec matches `server.js`" was VERIFIED FALSE — git pathspec `server` matches only `server/`.)

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
- **Design tradeoff (deliberate, see design spec decision (c) + Architecture):** the cross-language consistency check lives in the web vitest suite (auto-runs in `web-ci` on every push) rather than a neutral standalone script — a neutral script would need new CI workflow wiring (Phase-2 scope) to auto-run, which the user's minimal-review preference disfavors. Drift is still caught pre-merge. (Phase-3 gauntlet maint lens verdict on this tradeoff: **revisit-but-keep** — acceptable at current scale; add a companion `cargo test` check IF a Rust-only CI pipeline is added later.)

#### Phase 3 gate

- **Gauntlet:** phase-3 / accepted (cycles: 2) — 3 lenses (spec/correctness/maint), 0 must-fix at accept. **Cycle 1 = reject**: 1 must-fix (CONTRACT.md HTTP matrix conflated serde `Malformed` (400, no `record_index`) with per-record `Record` (400, with index) — verified against `server/src/error.rs`) + 2 should-fix (AGENTS.md omitted `vortex-bench/src/v3.rs` from the SCHEMA_VERSION coupled sites; durable docs leaked the plan-internal "sub-phase 3.2" term) + 1 nit (AGENTS.md 400→400/409); all fixed in `0f374f4`. **Cycle 2 = accept** (fix-commit attention pass, `prior_fix_commit_sha=0f374f4`): 0 must-fix; corrected matrix verified body-shape-exact vs `error.rs`; 1 new should-fix DEFERRED (`server/src/ingest.rs:16` — see Deferred work).
- **Human gate:** 2026-06-18T16:34:24Z — **abort** (user-requested). Phase 3 is complete + gauntlet-accepted; the user chose to stop at the boundary rather than proceed to Phase 4. Branch + spine intact, nothing merged/pushed.
- **Human gate (re-decision):** 2026-06-18T16:40:12Z — **proceed** (user re-invoked `/spiral:big-plans` and re-decided the Phase-3 boundary gate from abort → proceed). Advancing to Phase 4 on the same branch per STACKING MODE (no per-phase merge). The deferred should-fix `server/src/ingest.rs:16` (stale module-doc HTTP matrix; runtime correct) was left DEFERRED per the proceed decision (no amend). Phase 4 entails AWS + Vercel auth for its externalized changes (each gated on user confirmation).

### Phase 4: Deploy + secrets/infra ownership

#### Sub-phase 4.1: deploy-workflows

- **Shipped:** `.github/workflows/{web-deploy,web-keep-warm,schema-deploy}.yml` + `scripts/migrate-schema.py`. **web-deploy** = Vercel CLI `pull`/`build`/`deploy --prebuilt` to the NEW project (decision (d), git-integration off; keyed by `VERCEL_TOKEN`/`VERCEL_ORG_ID`/`VERCEL_PROJECT_ID`), push→prod + dispatch prod/preview, event-name+ref-keyed concurrency. **web-keep-warm** = external 10-min cron `curl` of `/api/health` (distinct from the in-app `vercel.json` cron). **schema-deploy** = adapted from `origin/ct/bench-v4`, `workflow_dispatch`-only (push-to-develop trigger `TODO(phase-4.2)`'d pending OIDC trust), OIDC-assumes `migrator`, runs `migrate-schema.py apply|status`. **migrate-schema.py** re-vendored byte-identical from monorepo `c305985e5` (the 7-migration generation matching this repo's `migrations/` + README, incl. the `requires-superuser` master-capability preflight). Floating action tags; SPDX on all; no secret values; `actionlint .github/workflows/*.yml` → 0.
- **Gauntlet:** pr-3 / accepted (cycles: 2). **Cycle 1 = reject** (1 must-fix: `migrate-schema.py` had been vendored from the monorepo's *current* preflight-stripped 4-migration generation, contradicting this repo's README+migrations contract → re-vendored from `c305985e5`; plus cheap should-fix/nits applied to the authored workflows — event-name concurrency key, injection-safe `env:` passthrough, `dry_run` drift-not-error, apply-job `name:`, `TODO(phase-4.2)` marker). **Cycle 2 = accept** (0 must-fix; 2 should-fix DEFERRED — `PermissionError`/`ValueError` uncaught in vendored `main()`, and the `schema-deploy.yml` header doc-clarity — see Carry-forward > Deferred work).
- **Deferred:** vendored-script upstream minors + `schema-deploy.yml` header imprecision (see Carry-forward > Deferred work). 0 blocking.

#### Sub-phase 4.2: secrets-runbook

- **Shipped:** `docs/runbooks/deploy-secrets-setup.md` — the operator runbook for the external setup that gives this repo deploy/secrets ownership: (A) create the NEW Vercel project (Root Directory `web/`, git-integration off) + (step 5) its API token; (B) the Vercel project env vars (`BENCH_DB_*`, `BENCH_REVALIDATE_TOKEN`); (C) this repo's GitHub Actions secret (`VERCEL_TOKEN`) + vars (`VERCEL_ORG_ID`/`VERCEL_PROJECT_ID`/`BENCH_SITE_BASE_URL`/`GH_BENCH_SCHEMA_ROLE_ARN`/`RDS_BENCH_*`) with correct per-workflow consumer mapping; (D) the AWS IAM OIDC trust EXTENSION to `repo:vortex-data/benchmarks-website:*` (additive; keeps the monorepo entry) + the full-bootstrap-apply caveat; (E) verification (E.1 local build, E.2 schema dry-run, E.3 web-deploy end-to-end, E.4 keep-warm). Plus `.vercel` added to the top-level `.gitignore`. No secret VALUES committed; external execution is USER-GATED (the runbook guides it). `runbook file exists` exit-criterion satisfied.
- **Gauntlet:** pr-2 / accepted (cycles: 6). Cycle 1 reject (3 must-fix: consumer-table mappings + the false BENCH_REVALIDATE_TOKEN auto-redirect claim); cycle 2 reject (1 must-fix: §A had no Vercel-token-creation step); cycles 3–6 all accept (0 must-fix), each refining the bootstrap-guidance precision (the long tail). All cycle-{1,2} must-fix + cheap should-fix applied; cycle-{3,4,5,6} should-fixes applied through cycle 5, cycle-6 residuals DEFERRED (see Carry-forward > Deferred work).
- **Deferred:** cycle-6 doc-precision residuals (D.5 cross-ref → infra/README.md; E.2 dry-run-003 failure-mode wording; 3 nits) — see Carry-forward > Deferred work. 0 blocking.

#### Sub-phase 4.3: v3-host-repoint

- **Shipped:** the v3 EC2 host can be re-pointed from the monorepo at this standalone repo. `ops/config/vortex-bench.env.example` REPO_DIR/DEPLOY_BRANCH updated for the standalone layout; **`ops/deploy.sh`** path filter fixed to repo-root-relative (`server`/`migrate` — was monorepo-prefixed `benchmarks-website/server`, which would have silently skipped ALL rebuilds after re-point); **`ops/install.sh`** fixed for the standalone layout (`ops_dir=${REPO_DIR}/ops`, `REPO_DIR` default `$HOME/benchmarks-website`, `benchmarks-website.git` remote hint, usage); `ops/systemd/vortex-bench-deploy.service` comment; and `docs/runbooks/v3-host-repoint.md` (operator re-point runbook: re-clone rationale, env, install, force-rebuild, verify, rollback, timer-quiesce). Live host re-point is USER-GATED.
- **Gauntlet:** pr-2 / accepted (cycles: 5). Cycle 1 reject (2 must-fix: the ops SCRIPTS were monorepo-bound — deploy.sh filter + install.sh layout — so the runbook documented a non-functional re-point; fixed the scripts, not just docs). Cycles 2–5 accept (0 must-fix), refining runbook prose. **OVER-INVESTED: 5 cycles on temporary v3 scaffolding is gold-plating against the "do not gold-plate v3" Architecture decision — user flagged this (2026-06-18); stopped at the cycle-5 accept, cycle-6 polish discarded.** The script fixes themselves are correct + necessary for a working standalone re-point.
- **Deferred:** `ops/BOOTSTRAP.md` + `ops/README.md` monorepo-layout cleanup (see Carry-forward > Deferred work). 0 blocking.

#### Phase 4 gate

- **Gauntlet:** phase-4 / accepted (cycles: 1) — 4 lenses (spec/correctness/maint/arch), 0 must-fix. Should-fixes (v4-workflow + doc polish; none in v3 ops code) DEFERRED — see Carry-forward > Deferred work; surfaced at the gate for the user's amend-vs-defer decision. The arch a-5 "deploy.sh server pathspec matches server.js" finding was verified FALSE.
- **Exit criteria:** `actionlint .github/workflows/*.yml` → 0 **PASS**; `test -f docs/runbooks/*.md` (runbook exists) **PASS**. `(cd web && vercel build --token=$VERCEL_TOKEN)` → 0 is the user-confirmed-at-gate live-infra sub-criterion (needs creds; per Phase Map "live cutovers user-confirmed at the gate").
