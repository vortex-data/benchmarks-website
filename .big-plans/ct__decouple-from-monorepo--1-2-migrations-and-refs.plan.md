<!--
SPDX-License-Identifier: Apache-2.0
SPDX-FileCopyrightText: Copyright the Vortex contributors
-->

# Sub-phase 1.2 (migrations-and-refs) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bring the missing `migrations/` DDL + the `measurement_id` golden fixture into this repo, and fix the in-repo monorepo-relative path references, so the Rust test suite and the `web/` vitest suite compile and run standalone.

**Architecture:** Vendor the two missing directories from the monorepo `ct/bench-v4` checkout (verbatim copies — they already carry SPDX headers), then drop one `../` level from each of the four dangling monorepo-relative references (they assumed `benchmarks-website/` was one directory deeper inside the monorepo).

**Tech Stack:** Rust (`cargo nextest`, `include_str!`), Next.js/vitest (`fileURLToPath`/`new URL`), SQL DDL, `build.rs`.

## Global Constraints

- Stable toolchain 1.91.0; no nightly.
- Every NEW file carries the two-line SPDX header in its comment syntax. The copied `migrations/*.sql` (`-- …`) and `migrations/README.md` (`<!-- … -->`) ALREADY carry it in the source — preserve it; do not strip or duplicate. JSON fixtures (`scripts/measurement_id_golden.json`) carry NO header (JSON has no comment syntax; matches the monorepo).
- Do NOT modify v2 legacy files (`server.js`, `src/`, `index.html`, `vite.config.js`, `package.json`, `public/`, top-level `Dockerfile`, `docker-compose.yml`).
- Do NOT add any NEW reference pointing into the monorepo. Vendoring files INTO this repo is the opposite of a back-reference — it removes the monorepo dependency. After this sub-phase, no in-repo path may escape the repo root via `../` past the root.
- Source of truth for the vendored files: the monorepo `ct/bench-v4` checkout at `/Users/connor/spiral/vortex-data/vortex4/` (verified present).

---

### Task 1: Vendor `migrations/` and the `measurement_id` golden fixture into the repo

**Files:**
- Create: `migrations/001_initial_schema.sql`, `migrations/002_iam_db_user.sql`, `migrations/003_migrator_ledger_grant.sql`, `migrations/004_ingest_role.sql`, `migrations/005_read_role.sql`, `migrations/006_read_path_perf.sql`, `migrations/007_summary_covering_index.sql`, `migrations/README.md` (copied verbatim from `/Users/connor/spiral/vortex-data/vortex4/migrations/`)
- Create: `scripts/measurement_id_golden.json` (copied verbatim from `/Users/connor/spiral/vortex-data/vortex4/scripts/measurement_id_golden.json`)

**Interfaces:**
- Produces: `migrations/` at the repo root (consumed by `migrate/tests/postgres_e2e.rs` `include_str!` and `web/lib/test-harness.ts` after Task 2's path fix) and `scripts/measurement_id_golden.json` at the repo root (consumed by `server/tests/measurement_id_golden.rs:43`'s existing `../../scripts/measurement_id_golden.json` path — NO test edit needed, the path already resolves once the file is here).

- [ ] **Step 1: Copy the migrations directory verbatim**

```bash
cd /Users/connor/spiral/vortex-data/benchmarks-website
mkdir -p migrations
cp /Users/connor/spiral/vortex-data/vortex4/migrations/*.sql \
   /Users/connor/spiral/vortex-data/vortex4/migrations/README.md \
   migrations/
```

- [ ] **Step 2: Copy the golden fixture verbatim**

```bash
cd /Users/connor/spiral/vortex-data/benchmarks-website
mkdir -p scripts
cp /Users/connor/spiral/vortex-data/vortex4/scripts/measurement_id_golden.json scripts/
```

- [ ] **Step 3: Verify the files landed with SPDX headers intact**

Run:
```bash
cd /Users/connor/spiral/vortex-data/benchmarks-website
ls migrations/ scripts/
head -2 migrations/001_initial_schema.sql        # expect the two-line `-- SPDX…` header
head -2 migrations/README.md                     # expect `<!--` then `SPDX-License-Identifier: Apache-2.0`
for f in migrations/*.sql; do head -1 "$f" | grep -q 'SPDX-License-Identifier: Apache-2.0' || echo "MISSING SPDX: $f"; done
```
Expected: `migrations/` lists the 7 `.sql` files + `README.md`; `scripts/` lists `measurement_id_golden.json`; the `head` lines show the SPDX headers; the loop prints nothing (no MISSING). If any `.sql` is missing the header, add the two-line `-- SPDX-License-Identifier: Apache-2.0` / `-- SPDX-FileCopyrightText: Copyright the Vortex contributors` header at its top.

- [ ] **Step 4: Confirm no v2 legacy file was touched and the copies are the only additions**

Run: `git status --short`
Expected: only `??  migrations/` and `??  scripts/` (untracked additions); no `M` on any v2 file.

- [ ] **Step 5: Commit**

```bash
cd /Users/connor/spiral/vortex-data/benchmarks-website
git add migrations/ scripts/
git commit -m "build: vendor migrations/ DDL and measurement_id golden fixture from monorepo" \
  -m "Signed-off-by: Connor Tsui <connor.tsui20@gmail.com>" \
  -m "Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 2: Fix the four in-repo monorepo-relative path references

**Files:**
- Modify: `server/build.rs:31-32`
- Modify: `migrate/tests/postgres_e2e.rs:43-45`
- Modify: `web/lib/test-harness.ts:35`

**Interfaces:**
- Consumes: `migrations/` and `scripts/measurement_id_golden.json` at the repo root (Task 1).
- Produces: a workspace whose tests compile (the `include_str!` paths resolve) and whose `web/` test-harness resolves the migrations dir.

- [ ] **Step 1: Fix the `build.rs` git paths (`../../.git/` → `../.git/`)**

`build.rs` runs with CWD = the crate dir (`server/`), so `.git` at the repo root is one level up. The monorepo layout had it two levels up. In `server/build.rs` change:

```rust
    println!("cargo:rerun-if-changed=../../.git/HEAD");
    println!("cargo:rerun-if-changed=../../.git/refs/heads");
```

to:

```rust
    println!("cargo:rerun-if-changed=../.git/HEAD");
    println!("cargo:rerun-if-changed=../.git/refs/heads");
```

(First Read `server/build.rs` in full to confirm these are the only `.git`-relative references and that the build SHA itself comes from a `git rev-parse` command, not these paths — these two lines are only `rerun-if-changed` cache-invalidation hints.)

- [ ] **Step 2: Fix the `postgres_e2e.rs` include_str paths (`../../../migrations/` → `../../migrations/`)**

From `migrate/tests/`, the repo-root `migrations/` is two levels up. In `migrate/tests/postgres_e2e.rs` change the three lines:

```rust
    include_str!("../../../migrations/001_initial_schema.sql"),
    include_str!("../../../migrations/006_read_path_perf.sql"),
    include_str!("../../../migrations/007_summary_covering_index.sql"),
```

to:

```rust
    include_str!("../../migrations/001_initial_schema.sql"),
    include_str!("../../migrations/006_read_path_perf.sql"),
    include_str!("../../migrations/007_summary_covering_index.sql"),
```

- [ ] **Step 3: Fix the `web/lib/test-harness.ts` migrations path (`../../../migrations` → `../../migrations`)**

From `web/lib/`, the repo-root `migrations/` is two levels up. In `web/lib/test-harness.ts:35` change:

```ts
const MIGRATIONS_DIR = fileURLToPath(new URL('../../../migrations', import.meta.url));
```

to:

```ts
const MIGRATIONS_DIR = fileURLToPath(new URL('../../migrations', import.meta.url));
```

- [ ] **Step 4: Re-verify no other dangling monorepo-escaping references remain**

Run:
```bash
cd /Users/connor/spiral/vortex-data/benchmarks-website
git grep -nE "\.\./\.\./\.\./|\.\./\.\./scripts|\.\./\.\./\.\./migrations" -- server migrate web ':(exclude).big-plans' || echo "no escaping refs"
git grep -nE "\.\./\.\./\.git" -- server migrate || echo "no two-level .git refs"
```
Expected: no matches that escape the repo root (the only legitimate `../../` remaining is `migrate/tests` → repo-root/migrations and `server/tests` → repo-root/scripts, both of which stay inside the repo). If a match escapes the root, fix it the same way (drop one `../`).

- [ ] **Step 5: Verify the Rust tests compile and run**

Run: `cd /Users/connor/spiral/vortex-data/benchmarks-website && cargo nextest run -p vortex-bench-server -p vortex-bench-migrate 2>&1 | tail -30`
Expected: tests COMPILE (the `include_str!` paths resolve — no "couldn't read … No such file or directory" build error) and the suite runs. `migrate/tests/postgres_e2e.rs` self-skips when Docker is absent (it only fails-loud when `CI` is set) — a skip is acceptable here; the bar is that it COMPILES. The `server/tests/measurement_id_golden.rs` golden test should now find `scripts/measurement_id_golden.json` and pass. If a DuckDB-extension network test surfaces, it is `#[ignore]`'d by default — fine. Report the pass/skip counts.

- [ ] **Step 6: Verify the web test-harness path resolves**

Run: `cd /Users/connor/spiral/vortex-data/benchmarks-website/web && pnpm install --frozen-lockfile >/dev/null 2>&1 && pnpm exec tsc --noEmit 2>&1 | tail -20`
Expected: `tsc --noEmit` typechecks clean (the `MIGRATIONS_DIR` path is a runtime `new URL`, so tsc won't catch a wrong path, but it confirms the edit didn't break types). If a full `pnpm test` is run, the Postgres testcontainer suite needs Docker; without Docker that suite errors on the daemon guard — that is environmental, NOT a path-resolution failure. The path-resolution bar is met if `migrations/` now exists at the repo root and the `new URL('../../migrations', …)` resolves to it (sanity-check: `node -e "console.log(require('url').fileURLToPath(new URL('../../migrations', require('url').pathToFileURL('web/lib/test-harness.ts'))))"` prints the repo-root `migrations` path).

- [ ] **Step 7: Commit**

```bash
cd /Users/connor/spiral/vortex-data/benchmarks-website
git add server/build.rs migrate/tests/postgres_e2e.rs web/lib/test-harness.ts
git commit -m "fix: re-root in-repo paths after monorepo extraction (.git, migrations)" \
  -m "Signed-off-by: Connor Tsui <connor.tsui20@gmail.com>" \
  -m "Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Self-Review

**Spec coverage** (sub-phase 1.2 scope → tasks):
1. Bring `migrations/` (7 SQL + README) to repo root, SPDX intact → Task 1 Steps 1, 3. ✓
2. Bring the `measurement_id` golden fixture to `scripts/` so the existing test path resolves → Task 1 Steps 2-3 + Task 2 (no test edit needed). ✓
3. Fix `server/build.rs` `.git` path → Task 2 Step 1. ✓
4. Fix `migrate/tests/postgres_e2e.rs` include_str paths → Task 2 Step 2. ✓
5. Fix `web/lib/test-harness.ts` migrations path → Task 2 Step 3. ✓
6. Re-verify no other dangling refs → Task 2 Step 4. ✓
7. Acceptance: `cargo nextest` compiles+runs; web path resolves → Task 2 Steps 5-6. ✓

**Placeholder scan:** No TBD/TODO; every path, line number, and old→new string is concrete. ✓

**Type consistency:** `migrations/` repo-root location is consistent between Task 1 (creates it) and Task 2 (the `../../migrations/` references that consume it from `migrate/tests/` and `web/lib/`). The golden fixture at `scripts/measurement_id_golden.json` matches the UNCHANGED `../../scripts/…` reference in `server/tests/measurement_id_golden.rs`. ✓

**Scope:** Vendoring + path re-rooting only; no logic changes, no v2 edits, no new monorepo references. ✓
