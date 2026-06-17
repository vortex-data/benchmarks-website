<!--
SPDX-License-Identifier: Apache-2.0
SPDX-FileCopyrightText: Copyright the Vortex contributors
-->

# Sub-phase 1.3 (green-build) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a stable-compatible `rustfmt.toml` and reformat to it, bringing the repo to a fully green standalone bar (build + fmt + clippy + tests + the web build) — the Phase 1 exit criteria.

**Architecture:** The monorepo's `rustfmt.toml` is nightly-gated; this repo pins stable 1.91.0, so use the stable-accepted subset (`style_edition = "2024"`, `use_field_init_shorthand = true`) plus the stable default `reorder_imports = true` (which alphabetically sorts `use` lines within each blank-line-separated group — this resolves the deferred hashbrown import-ordering nit). Clippy and the web side are ALREADY green (verified during planning), so the only change is the new config + the `cargo fmt` reformat; the rest of the task is verifying the green bar.

**Tech Stack:** Rust (`cargo fmt`/`clippy`/`nextest`, rustfmt 1.8.0-stable), Next.js (`pnpm` prettier/eslint/`next build`).

## Global Constraints

- Stable toolchain 1.91.0; no nightly. The `rustfmt.toml` must contain ONLY stable-accepted options (verified: `style_edition`, `use_field_init_shorthand`). Do NOT add `unstable_features`, `group_imports`, `imports_granularity`, `format_macro_matchers`, `format_macro_bodies`, or `condense_wildcard_suffixes` — they error on stable rustfmt.
- New files carry the two-line SPDX header. `rustfmt.toml` (a `.toml` file) gets `# SPDX-License-Identifier: Apache-2.0` / `# SPDX-FileCopyrightText: Copyright the Vortex contributors` (same as the existing root `Cargo.toml`; `rust-toolchain.toml` already carries it — `.toml` is in the SPDX BAN's list).
- Do NOT modify v2 legacy files (`server.js`, `src/`, `index.html`, `vite.config.js`, `package.json`, `public/`, top-level `Dockerfile`, `docker-compose.yml`). NOTE: `cargo fmt --all` only formats the workspace members (`server/`, `migrate/`) — it does not touch the v2 top-level `src/` (that's the Vite SPA, not a Rust crate).
- No NEW monorepo back-references.
- The `cargo fmt --all` reformat is committed SEPARATELY from the config (its own mechanical commit) so a reviewer can approve the (potentially multi-file) reformat diff independently.

---

### Task 1: Add the stable `rustfmt.toml` and reformat the workspace to it; verify the full green bar

**Files:**
- Create: `rustfmt.toml`
- Modify (via `cargo fmt --all`): any `server/**/*.rs` + `migrate/**/*.rs` the reformat touches (at minimum the three `hashbrown` import sites whose ordering the deferred nit flagged: `server/src/app.rs`, `server/src/read_model.rs`, `migrate/src/migrate/accum.rs`).

**Interfaces:**
- Consumes: the standalone workspace (sub-phase 1.1) + vendored migrations/golden (sub-phase 1.2), both green for `cargo build`/`nextest`.
- Produces: a green standalone bar (`cargo fmt --all --check` → 0 on stable) and the resolved import-ordering deferred item.

- [ ] **Step 1: Create the stable `rustfmt.toml`**

Create `rustfmt.toml` at the repo root:

```toml
# SPDX-License-Identifier: Apache-2.0
# SPDX-FileCopyrightText: Copyright the Vortex contributors

# Stable-compatible subset of the monorepo's rustfmt.toml. This repo pins stable
# 1.91.0 (rust-toolchain.toml), so the monorepo's nightly-only options
# (unstable_features, group_imports, imports_granularity, format_macro_matchers,
# format_macro_bodies, condense_wildcard_suffixes) are intentionally omitted — they
# require a nightly toolchain. The stable default `reorder_imports = true` still
# sorts `use` statements alphabetically within each blank-line-separated group.
style_edition = "2024"
use_field_init_shorthand = true
```

- [ ] **Step 2: Verify the config is accepted on stable (no "unstable option" error)**

Run: `cd /Users/connor/spiral/vortex-data/benchmarks-website && cargo fmt --all --check 2>&1 | head -5; echo "rc=${PIPESTATUS[0]}"`
Expected: the output shows formatting DIFFS (e.g. the hashbrown imports being reordered) and `rc=1` — NOT an error like `Warning: can't set ... unstable`. A non-zero rc here is EXPECTED (the code isn't formatted to the config yet); a CONFIG error (unstable option) would mean an option must be dropped — if you see one, remove the offending option from `rustfmt.toml` and re-run.

- [ ] **Step 3: Commit the config (separate from the reformat)**

```bash
cd /Users/connor/spiral/vortex-data/benchmarks-website
git add rustfmt.toml
git commit -m "build: add stable-compatible rustfmt.toml" \
  -m "Signed-off-by: Connor Tsui <connor.tsui20@gmail.com>" \
  -m "Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

- [ ] **Step 4: Apply the reformat**

Run: `cd /Users/connor/spiral/vortex-data/benchmarks-website && cargo fmt --all`
Expected: no output, exit 0. This rewrites the workspace `.rs` files to the stable config (reordering the hashbrown imports + any minor `style_edition`/`use_field_init_shorthand` adjustments).

- [ ] **Step 5: Verify fmt is now clean**

Run: `cd /Users/connor/spiral/vortex-data/benchmarks-website && cargo fmt --all --check; echo "rc=$?"`
Expected: no diffs, `rc=0`.

- [ ] **Step 6: Confirm the hashbrown imports are now in alphabetical position (deferred nit resolved)**

Run: `cd /Users/connor/spiral/vortex-data/benchmarks-website && grep -n "use hashbrown" server/src/app.rs server/src/read_model.rs migrate/src/migrate/accum.rs`
Expected: each `use hashbrown::…` now sits in alphabetical order within its import group (e.g. before `use parking_lot` / `use vortex_bench_server`), not appended at the end of the group.

- [ ] **Step 7: Commit the reformat (mechanical, separate commit)**

```bash
cd /Users/connor/spiral/vortex-data/benchmarks-website
git add -- server migrate
git commit -m "style: cargo fmt --all to the stable rustfmt config" \
  -m "Mechanical reformat — reorders the hashbrown imports (resolves the deferred sub-phase 1.1 import-ordering nit) and applies style_edition 2024 + use_field_init_shorthand." \
  -m "Signed-off-by: Connor Tsui <connor.tsui20@gmail.com>" \
  -m "Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

- [ ] **Step 8: Verify the full Phase 1 green bar (the exit criteria)**

Run each; ALL must pass:
```bash
cd /Users/connor/spiral/vortex-data/benchmarks-website
cargo build --workspace --locked && echo "BUILD_OK"
cargo fmt --all --check && echo "FMT_OK"
cargo clippy --workspace --all-targets -- -D warnings && echo "CLIPPY_OK"
cargo nextest run -p vortex-bench-server -p vortex-bench-migrate 2>&1 | tail -5
( cd web && pnpm install --frozen-lockfile >/dev/null 2>&1 && pnpm format:check >/dev/null 2>&1 && echo "WEB_FMT_OK" && pnpm lint >/dev/null 2>&1 && echo "WEB_LINT_OK" && pnpm build >/dev/null 2>&1 && echo "WEB_BUILD_OK" )
```
Expected: `BUILD_OK`, `FMT_OK`, `CLIPPY_OK`, the nextest summary showing passed (with the Docker-gated `postgres_e2e` skipped if Docker is absent — a skip is acceptable; a FAIL is not), `WEB_FMT_OK`, `WEB_LINT_OK`, `WEB_BUILD_OK`. If clippy surfaces a warning (planning found none, but the reformat is mechanical so this is unlikely), fix it preserving behavior — prefer a real fix over `#[allow]`; if `#[allow]` is genuinely warranted, add a one-line justifying comment. If a web step fails, fix the underlying prettier/eslint issue (planning found web prettier already clean). Report the final status of every check.

---

## Self-Review

**Spec coverage** (sub-phase 1.3 scope → steps):
1. Stable-compatible `rustfmt.toml` (only stable options, SPDX header) → Step 1 (+ Step 2 guards against an unstable option). ✓
2. `cargo fmt --all` reformat + `--check` clean → Steps 4-5. ✓
3. `clippy -D warnings` green → Step 8 (planning verified already clean). ✓
4. Web green (format:check/lint/build) → Step 8 (planning verified prettier already clean). ✓
5. nextest still green after fmt → Step 8. ✓
6. Phase 1 exit criteria (build/fmt/clippy/nextest/web) → Step 8 runs all of them. ✓
7. Deferred import-ordering nit resolved → Step 6 confirms. ✓
8. fmt-reformat committed separately from config → Steps 3 (config) + 7 (reformat). ✓

**Placeholder scan:** No TBD/TODO; the exact `rustfmt.toml` content + every command is concrete. ✓

**Type consistency:** N/A (no new types; the rustfmt.toml options `style_edition`/`use_field_init_shorthand` were probe-verified stable during planning). ✓

**Scope:** Config + mechanical reformat only; no logic changes (clippy/web already green); no v2 edits (`cargo fmt --all` only touches workspace members server/ + migrate/). ✓
