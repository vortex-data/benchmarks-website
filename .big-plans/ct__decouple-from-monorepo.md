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
without the `vortex-data/vortex` monorepo's CI, then retire the monorepo's copy.

## Architecture & key decisions

<!-- A few bullets summarising the design evidence from the Phase 1 sweep. Full detail lives in
     the design spec once brainstorming runs — these are the load-bearing facts the sweep
     confirmed, plus candidate decisions to resolve in brainstorming. -->

- **Repo carries three generations side by side.** Legacy Node/React v2 (top-level `server.js`,
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

- No changes to the v2 legacy production files (`server.js`, `src/`, `index.html`, `vite.config.js`,
  `package.json`, `public/`, top-level `Dockerfile`, `docker-compose.yml`) except deletion during
  the explicit legacy-prune phase — they remain production until the cutover.
- No work that duplicates the monorepo's in-flight `ct/bench-v4 → develop` merge or the v3→v4
  Phase-5 production cutover — those are handled separately by the user; this project sequences
  around them.
- No re-authoring of the benchmark-*producing* logic — the emitter workflows (`bench`,
  `sql-benchmarks`, the `v3-commit-metadata` ingest step) stay in the monorepo; this project owns
  only the ingest *contract*, not the benchmark runs.
- No changes to monorepo crates (`vortex-utils`, `vortex-bench`, vortex core) beyond severing this
  repo's dependency on them.
- (Refine during brainstorming — e.g. whether v3 server/EC2 retirement is in or out of this
  project's scope vs. the separate Phase-5 cutover.)

## Risks

<!-- Numbered. For each: probability, impact, mitigation. -->

1. **Cutover entanglement.** The v4 CI/contract lives only on the unmerged monorepo `ct/bench-v4`
   branch; deletion of `benchmarks-website/` from the monorepo must reckon with code not yet on
   `develop`. P=high; impact=severe; mitigation: sequence the deletion phase last and gate it on the
   monorepo cutover state; coordinate explicitly with the user before any monorepo-side PR.
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
   "green" standalone may be looser. P=med; impact=minor; mitigation: decide in brainstorming whether
   to port `[workspace.lints]` + `clippy.toml` or accept plain `-D warnings`.

---

## Current Position

```yaml
phase: null                    # current phase name (matches Phase Map)
sub_phase: null                # current sub-phase name (matches Phase Map); null between sub-phases
task: null                     # ADVISORY-ONLY — SDD's internal task cursor; never routed on
status: planning               # planning | implementing | reviewing | fixing | awaiting-human-gate | done | aborted
last_gate: null                # ISO 8601 timestamp of the most recent human gate, or null
phase_entry_sha: null          # SHA of the phase-entry commit; null initially
```

---

## Phase Map

<!-- Decomposition is Phase 1 Step 1.4, after brainstorming + grill-me. Empty until then. -->

_(empty — populated in Phase 1 Step 1.4 after the design is built and stress-tested)_

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

- (none yet)

---

## Verdict / Completion Ledger

_(empty — grows as sub-phases and phases complete)_
