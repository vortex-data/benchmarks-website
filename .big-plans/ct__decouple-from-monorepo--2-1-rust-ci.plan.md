<!--
SPDX-License-Identifier: Apache-2.0
SPDX-FileCopyrightText: Copyright the Vortex contributors
-->

# Sub-phase 2.1 (rust-ci) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a standalone, credential-free Rust correctness workflow at `.github/workflows/rust-ci.yml` that runs `fmt --check`, `clippy -D warnings`, `build --locked`, `nextest run`, and `test --doc` on every push and pull request.

**Architecture:** One GitHub Actions workflow, one sequential job on `ubuntu-latest`. The job relies on the repo's `rust-toolchain.toml` (stable `1.91.0` + `rustfmt`/`clippy` components) for the toolchain — no second channel pin in the workflow, so it cannot drift from the toml. `Swatinem/rust-cache` caches the expensive bundled-DuckDB compile; `taiki-e/install-action` installs `cargo-nextest`. The steps are sequential (not parallel jobs) deliberately: DuckDB is a `bundled` C++ dependency, so splitting into N jobs would recompile it N times.

**Tech Stack:** GitHub Actions (YAML), Rust 1.91.0 (cargo, rustfmt, clippy), cargo-nextest, actionlint (validation only).

## Global Constraints

- **No monorepo back-references.** The workflow must NOT reference `../`, `vortex-bench/`, `../.github/`, `../scripts/`, `../CLAUDE.md`, or any monorepo path — severing that coupling is the project's goal. (Spine BAN: `monorepo coupling`.)
- **No secrets / no external creds.** This is correctness-only CI: no `secrets.*`, no OIDC, no deploy steps. (Spine Phase-2 scope: "no creds".)
- **SPDX header required** on the new file — the two YAML-comment lines: `# SPDX-License-Identifier: Apache-2.0` and `# SPDX-FileCopyrightText: Copyright the Vortex contributors`. (Spine BAN: `SPDX headers`.)
- **Toolchain source of truth is `rust-toolchain.toml`** (`channel = "1.91.0"`, components include `rustfmt`, `clippy`). Do NOT add a nightly toolchain and do NOT duplicate the channel pin in the workflow.
- **Workspace crates:** `vortex-bench-server` (in `server/`) and `vortex-bench-migrate` (in `migrate/`); `members = ["server", "migrate"]`, `resolver = "2"`, edition 2024.
- **Admin tests stay ignored.** The `#[ignore = "needs network to install the vortex DuckDB core extension"]` tests must NOT be un-ignored; default `cargo nextest run` skips them — keep it that way (no `--run-ignored`).
- **Scope is ONLY this workflow.** No `clippy.toml` (clippy already passes `-D warnings` standalone — adding config is unwarranted/YAGNI). `web-ci.yml` is sub-phase 2.2, not here.
- **Do not push.** Per the project's STACKING MODE, nothing is pushed in this sub-phase; verification is local (`actionlint` + re-running the underlying cargo commands). The `gh run list … success` half of the Phase-2 exit criterion is handled at the phase boundary, not by this plan.

---

### Task 1: Author and validate the Rust CI workflow

**Files:**
- Create: `.github/workflows/rust-ci.yml`
- Test: `actionlint .github/workflows/rust-ci.yml` (static validation) + local re-run of the underlying cargo commands

**Interfaces:**
- Consumes: the repo's existing `rust-toolchain.toml`, root `Cargo.toml` workspace, `rustfmt.toml` (all created in Phase 1 and already green).
- Produces: `.github/workflows/rust-ci.yml` — the first workflow in this repo's `.github/`. Sub-phase 2.2 will add `web-ci.yml` alongside it; the Phase-2 exit criterion globs `.github/workflows/*.yml` through `actionlint`.

- [ ] **Step 1: Create the workflow file**

Create `.github/workflows/rust-ci.yml` with exactly this content:

```yaml
# SPDX-License-Identifier: Apache-2.0
# SPDX-FileCopyrightText: Copyright the Vortex contributors

name: Rust CI

on:
  push:
  pull_request:

# Least privilege: correctness CI only reads the checkout — no writes, no creds.
permissions:
  contents: read

# Cancel superseded runs on the same ref (a push to a PR'd branch fires both
# `push` and `pull_request`).
concurrency:
  group: rust-ci-${{ github.workflow }}-${{ github.ref }}
  cancel-in-progress: true

env:
  CARGO_TERM_COLOR: always

jobs:
  rust:
    name: fmt, clippy, build, test
    runs-on: ubuntu-latest
    steps:
      - name: Checkout
        uses: actions/checkout@v4

      # rustup installs the pinned toolchain (channel + rustfmt/clippy components)
      # from rust-toolchain.toml on first cargo use; this step makes that explicit
      # and logs the resolved versions for debugging.
      - name: Show toolchain
        run: |
          rustup show active-toolchain
          cargo --version
          cargo fmt --version
          cargo clippy --version

      - name: Cache cargo build
        uses: Swatinem/rust-cache@v2

      - name: Install cargo-nextest
        uses: taiki-e/install-action@v2
        with:
          tool: cargo-nextest

      - name: Format check
        run: cargo fmt --all --check

      - name: Clippy
        run: cargo clippy --workspace --all-targets --locked -- -D warnings

      - name: Build
        run: cargo build --workspace --locked

      - name: Test (nextest)
        run: cargo nextest run --workspace --locked

      - name: Doctests
        run: cargo test --doc --workspace --locked
```

Notes for the implementer (do not put these in the file beyond the comments already shown):
- `--locked` is on clippy/build/nextest/doctest (not just `build`): a CI run that silently rewrites `Cargo.lock` is a defect, so every compiling command pins the lockfile. This is a deliberate, consistent strengthening of the scope line.
- nextest does not run doctests, so the separate `Doctests` step is required for `test --doc` coverage. If the crates currently have no doctests it passes trivially — keep it; it guards future doc examples.
- No `dtolnay/rust-toolchain` step: that would re-pin the channel and could drift from `rust-toolchain.toml`.

- [ ] **Step 2: Ensure actionlint is available**

Run: `actionlint --version`
Expected: prints a version. If it errors with "command not found", install it first:

```bash
brew install actionlint
```

(The dev host is macOS with Homebrew. If brew is unavailable, fall back to `go install github.com/rhysd/actionlint/cmd/actionlint@latest` and ensure `$(go env GOPATH)/bin` is on PATH.)

- [ ] **Step 3: Validate the workflow with actionlint**

Run: `actionlint .github/workflows/rust-ci.yml`
Expected: no output, exit code 0. If actionlint reports any error, fix the YAML and re-run until it exits 0. (This is the locally-checkable half of the Phase-2 exit criterion.)

- [ ] **Step 4: Confirm the underlying commands are green locally**

These are the exact commands the workflow runs; they were green at the Phase-1 gate, so re-running them confirms the workflow's command lines are correct (not just that the YAML parses). Run each from the repo root:

```bash
cargo fmt --all --check
cargo clippy --workspace --all-targets --locked -- -D warnings
cargo build --workspace --locked
cargo nextest run --workspace --locked
cargo test --doc --workspace --locked
```

Expected: every command exits 0. `cargo nextest run` reports the admin/network tests as skipped (`#[ignore]`) — that is correct; do NOT pass `--run-ignored`. If any command fails, the failure is a real regression — stop and surface it (do not edit the workflow to paper over it).

- [ ] **Step 5: Commit**

```bash
git add .github/workflows/rust-ci.yml
git commit -s -m "ci: add standalone Rust correctness workflow

Signed-off-by: Connor Tsui <connor.tsui20@gmail.com>

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

(`-s` adds the DCO sign-off line; the repo convention carries both `Signed-off-by` and `Co-Authored-By` trailers. The `ci:` area prefix follows the repo's `<area>: <scope>` convention.)

---

## Self-Review

**1. Spec coverage:** The scope line lists `fmt --check` (Format check step), `clippy --all-targets -- -D warnings` (Clippy step), `build --locked` (Build step), `nextest run` (Test step), `test --doc` (Doctests step), "on push/PR" (`on: push / pull_request`), "no creds" (`permissions: contents: read`, no `secrets.*`). The local exit criterion `actionlint .github/workflows/rust-ci.yml → 0` is Task 1 Step 3. All covered.

**2. Placeholder scan:** No TBD/TODO/"add error handling"/"similar to" — the full YAML and every command is spelled out.

**3. Type/name consistency:** Crate names (`vortex-bench-server`, `vortex-bench-migrate`) come from the workspace `members` and are exercised via `--workspace`; the toolchain channel matches `rust-toolchain.toml` (`1.91.0`); the file path matches the Phase Map task-plan-pointer's target workflow (`.github/workflows/rust-ci.yml`) and the Phase-2 exit-criterion glob.
