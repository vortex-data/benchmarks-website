<!--
SPDX-License-Identifier: Apache-2.0
SPDX-FileCopyrightText: Copyright the Vortex contributors
-->

# Sub-phase 1.1 (workspace) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Create a standalone root Cargo workspace so `server/` and `migrate/` compile without the `vortex-data/vortex` monorepo, severing the one monorepo-internal dependency (`vortex-utils`).

**Architecture:** Add a root `/Cargo.toml` `[workspace]` whose `[workspace.dependencies]` inlines — at the exact monorepo pins — every dependency the two crate manifests reference via `{ workspace = true }`. Replace the monorepo-internal `vortex-utils` (used only for `hashbrown` type aliases at three sites) with a direct `hashbrown` dependency. Pin the toolchain with a copied `rust-toolchain.toml`.

**Tech Stack:** Rust (edition 2024, rust 1.91.0 stable), Cargo workspaces, DuckDB (`bundled`, compiled from source — first build is slow), axum/maud (server), DuckDB→Postgres (migrate).

## Global Constraints

- Toolchain is **stable 1.91.0** (`rust-toolchain.toml` `channel = "1.91.0"`). No nightly.
- Every NEW file gets the two-line SPDX header: `# SPDX-License-Identifier: Apache-2.0` then `# SPDX-FileCopyrightText: Copyright the Vortex contributors` (comment syntax per file type).
- Do NOT modify the v2 legacy files (`server.js`, `src/`, `index.html`, `vite.config.js`, `package.json`, `public/`, top-level `Dockerfile`, `docker-compose.yml`).
- Do NOT add any NEW reference that points back into the monorepo (`../`, `vortex-bench/`, `../.github/`, monorepo paths).
- Crate `[package].version` stays per-crate (`0.1.0-alpha.0`); only `edition`/`rust-version`/`license` are hoisted to `[workspace.package]`.
- Exact dependency pins (copied verbatim from the monorepo `ct/bench-v4` `Cargo.toml` `[workspace.dependencies]`) are listed in Task 1; do not paraphrase or bump them.

---

### Task 1: Root workspace manifest, toolchain pin, and `vortex-utils` severance in the manifests

**Files:**
- Create: `/Users/connor/spiral/vortex-data/benchmarks-website/Cargo.toml`
- Create: `/Users/connor/spiral/vortex-data/benchmarks-website/rust-toolchain.toml`
- Modify: `server/Cargo.toml` (remove the `vortex-utils` dep line; add `hashbrown`; hoist `[package]` fields)
- Modify: `migrate/Cargo.toml` (remove the `vortex-utils` dep line; add `hashbrown`; hoist `[package]` fields)

**Interfaces:**
- Produces: a resolvable workspace (`[workspace.dependencies]` names: `anyhow`, `arrow-array`, `arrow-buffer`, `arrow-schema`, `clap`, `dashmap`, `futures`, `hashbrown`, `insta`, `parking_lot`, `reqwest`, `rstest`, `serde`, `serde_json`, `tempfile`, `thiserror`, `tokio`, `tracing`, `tracing-subscriber`). Task 2 relies on `hashbrown` being a workspace dependency of both crates.

- [ ] **Step 1: Create the toolchain pin**

Create `rust-toolchain.toml` (verbatim copy of the monorepo's — no SPDX header; `rust-toolchain.toml` conventionally carries none and a stray comment can confuse some tooling):

```toml
[toolchain]
channel = "1.91.0"
components = ["rust-src", "rustfmt", "clippy", "rust-analyzer"]
profile = "minimal"
```

- [ ] **Step 2: Create the root workspace manifest**

Create `Cargo.toml` at the repo root:

```toml
# SPDX-License-Identifier: Apache-2.0
# SPDX-FileCopyrightText: Copyright the Vortex contributors

[workspace]
members = ["server", "migrate"]
resolver = "2"

[workspace.package]
edition = "2024"
rust-version = "1.91.0"
license = "Apache-2.0"

[workspace.dependencies]
# Inlined from the vortex monorepo (ct/bench-v4) [workspace.dependencies] at the
# EXACT upstream pins so the standalone build matches. `vortex-utils` (a
# monorepo-internal crate) is intentionally replaced by a direct `hashbrown`
# dependency — its only use here was the `hashbrown` HashMap/HashSet aliases.
anyhow = "1.0.97"
arrow-array = "58.3"
arrow-buffer = "58.3"
arrow-schema = "58.3"
clap = "4.5"
dashmap = "6.1.0"
futures = { version = "0.3.31", default-features = false }
hashbrown = "0.17.1"
insta = "1.43"
parking_lot = { version = "0.12.3", features = ["nightly"] }
reqwest = { version = "0.13.0", features = [
    "blocking",
    "charset",
    "http2",
    "rustls",
    "system-proxy",
], default-features = false }
rstest = "0.26.1"
serde = "1.0.220"
serde_json = "1.0.138"
tempfile = "3"
thiserror = "2.0.3"
tokio = { version = "1.52" }
tracing = { version = "0.1.41", default-features = false }
tracing-subscriber = "0.3"
```

- [ ] **Step 3: Sever `vortex-utils` and hoist package fields in `server/Cargo.toml`**

In `server/Cargo.toml`, change the `[package]` block's `edition`/`rust-version`/`license` to inherit from the workspace, and in `[dependencies]` remove the `vortex-utils` line and add `hashbrown`.

`[package]` becomes:

```toml
[package]
name = "vortex-bench-server"
version = "0.1.0-alpha.0"
edition.workspace = true
rust-version.workspace = true
license.workspace = true
description = "bench.vortex.dev v3 alpha server: HTTP API + HTML + DuckDB on local disk"
publish = false
```

In `[dependencies]`: delete the line `vortex-utils = { workspace = true }` and add (alphabetical placement, near `futures`):

```toml
hashbrown = { workspace = true }
```

Also delete the now-inaccurate comment block at lines 21-23 (`# ... the crate is intentionally outside the workspace.`) — the crate IS now a workspace member; leaving the comment would be a false statement a reviewer must flag.

- [ ] **Step 4: Sever `vortex-utils` and hoist package fields in `migrate/Cargo.toml`**

`[package]` becomes:

```toml
[package]
name = "vortex-bench-migrate"
version = "0.1.0-alpha.0"
edition.workspace = true
rust-version.workspace = true
license.workspace = true
description = "One-shot historical migrator from the v2 benchmarks S3 dataset to a v3 DuckDB file"
publish = false
```

In `[dependencies]`: delete the line `vortex-utils = { workspace = true }` and add:

```toml
hashbrown = { workspace = true }
```

(The existing comment at lines 17-19 already correctly says it "IS a workspace member" — leave it.)

- [ ] **Step 5: Verify the workspace resolves**

Run: `cd /Users/connor/spiral/vortex-data/benchmarks-website && cargo metadata --format-version 1 >/dev/null && echo METADATA_OK`
Expected: prints `METADATA_OK`. This resolves the workspace + all `[workspace.dependencies]` against crates.io (and writes an initial `Cargo.lock`). It does NOT compile, so the still-present `use vortex_utils` imports do not error here — they are fixed in Task 2. If `cargo metadata` errors with `vortex-utils was not found in workspace.dependencies`, a crate manifest still references it — re-check Steps 3-4.

- [ ] **Step 6: Commit**

```bash
cd /Users/connor/spiral/vortex-data/benchmarks-website
git add Cargo.toml rust-toolchain.toml Cargo.lock server/Cargo.toml migrate/Cargo.toml
git commit -m "build: add standalone root Cargo workspace; sever vortex-utils dep" \
  -m "Signed-off-by: Connor Tsui <connor.tsui20@gmail.com>" \
  -m "Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 2: Replace the three `vortex-utils` imports with `hashbrown`, then build the workspace green

**Files:**
- Modify: `server/src/read_model.rs:36`
- Modify: `server/src/app.rs:41`
- Modify: `migrate/src/migrate/accum.rs:30`
- Modify: `Cargo.lock` (regenerated by the build)

**Interfaces:**
- Consumes: `hashbrown = { workspace = true }` on both crates (Task 1). `hashbrown::HashMap` / `hashbrown::HashSet` default to `hashbrown::DefaultHashBuilder`, exactly what `vortex_utils::aliases::hash_map::HashMap` / `hash_set::HashSet` re-exported — so the call sites (`.new()`, `.insert()`, `.get()`, `.entry()`, etc.) are behaviorally identical drop-ins.

- [ ] **Step 1: Replace the `server` read_model import**

In `server/src/read_model.rs:36`, change:

```rust
use vortex_utils::aliases::hash_map::HashMap;
```

to:

```rust
use hashbrown::HashMap;
```

- [ ] **Step 2: Replace the `server` app import**

In `server/src/app.rs:41`, change:

```rust
use vortex_utils::aliases::hash_set::HashSet;
```

to:

```rust
use hashbrown::HashSet;
```

- [ ] **Step 3: Replace the `migrate` accum import**

In `migrate/src/migrate/accum.rs:30`, change:

```rust
use vortex_utils::aliases::hash_map::HashMap;
```

to:

```rust
use hashbrown::HashMap;
```

- [ ] **Step 4: Confirm no other `vortex_utils` / `vortex-utils` references remain**

Run: `cd /Users/connor/spiral/vortex-data/benchmarks-website && grep -rn "vortex_utils\|vortex-utils" server migrate Cargo.toml`
Expected: NO matches (empty output). If any active `use`/manifest line remains, replace/remove it the same way. (Doc-comment mentions, if any surface, should also be removed — they would be a stale reference a reviewer flags.)

- [ ] **Step 5: Build the workspace (locked)**

Run: `cd /Users/connor/spiral/vortex-data/benchmarks-website && cargo build --workspace --locked 2>&1 | tail -30`
Expected: `Finished` with no errors. NOTE: the first build compiles `duckdb` (`bundled`) from C++ source and takes several minutes — this is expected, not a hang.

**Contingency — `parking_lot` nightly feature.** The workspace pins `parking_lot = { features = ["nightly"] }` (copied from the monorepo, which builds it on this same stable 1.91.0). If — and only if — the build fails with an error attributing an unstable/`nightly`-only feature to `parking_lot` / `parking_lot_core` / `lock_api`, edit `Cargo.toml` to drop the feature:

```toml
parking_lot = { version = "0.12.3" }
```

then re-run the build. Record this deviation in the commit message if taken. (Do NOT add a nightly toolchain — stable is a hard constraint.)

- [ ] **Step 6: Re-verify the locked build after any lockfile change**

Run: `cd /Users/connor/spiral/vortex-data/benchmarks-website && cargo build --workspace --locked >/dev/null 2>&1 && echo BUILD_OK`
Expected: prints `BUILD_OK`. (If `--locked` complains the lockfile is stale after the contingency edit, run `cargo build --workspace` once to refresh `Cargo.lock`, then re-run this `--locked` check.)

- [ ] **Step 7: Commit**

```bash
cd /Users/connor/spiral/vortex-data/benchmarks-website
git add server/src/read_model.rs server/src/app.rs migrate/src/migrate/accum.rs Cargo.lock
git commit -m "refactor: use hashbrown directly in place of vortex-utils aliases" \
  -m "Signed-off-by: Connor Tsui <connor.tsui20@gmail.com>" \
  -m "Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Self-Review

**Spec coverage** (sub-phase 1.1 scope items → tasks):
1. Root `Cargo.toml` workspace with `[workspace]`/`[workspace.package]`/`[workspace.dependencies]` at exact pins → Task 1 Steps 2-4. ✓
2. Sever `vortex-utils` → `hashbrown` (manifests + 3 import sites) → Task 1 Steps 3-4 (manifests) + Task 2 Steps 1-3 (imports). ✓
3. Copy `rust-toolchain.toml` → Task 1 Step 1. ✓
4. Generate `Cargo.lock` → Task 1 Step 5 (`cargo metadata` writes it) + Task 2 Step 5 (`cargo build` finalizes it). ✓
5. Acceptance `cargo build --workspace --locked` succeeds → Task 2 Steps 5-6. ✓
6. `parking_lot` nightly risk resolved → Task 2 Step 5 contingency. ✓
7. SPDX header on new files → Task 1 Steps 1-2 (root `Cargo.toml` gets it; `rust-toolchain.toml` intentionally none). ✓

**Placeholder scan:** No TBD/TODO; every dep pin, file path, line number, import string, and command is concrete. ✓

**Type consistency:** `hashbrown::HashMap`/`HashSet` defaults match the severed `vortex_utils` aliases (same `DefaultHashBuilder`); the workspace-dep name `hashbrown` referenced by both crate manifests (Task 1) matches the import-side crate (`hashbrown::…`, Task 2). ✓

**Scope:** Buildable workspace only; test-green is sub-phase 1.3, deferred. ✓
