<!--
SPDX-License-Identifier: Apache-2.0
SPDX-FileCopyrightText: Copyright the Vortex contributors
-->

# Phase 4.3 — v3 EC2 Host Re-point Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make this repo own the v3 EC2 host's deploy source — provide the ops-config + a runbook so an operator can re-point the host's poll-and-build autopilot from the monorepo (`vortex-data/vortex`) at THIS standalone repo (`vortex-data/benchmarks-website`).

**Architecture:** The v3 host already polls `origin/$DEPLOY_BRANCH` and builds on-host via `ops/deploy.sh` (a systemd timer) — there is NO monorepo CI dependency. "Re-pointing" is therefore an ops-config change: the host's git remote → this repo, `REPO_DIR`/`DEPLOY_BRANCH` set for the standalone layout, and a re-clone (the monorepo checkout has unrelated history). This sub-phase ships the env-example guidance + a re-point runbook; the actual host change is operator-executed (user-gated).

**Tech Stack:** systemd timer + `ops/deploy.sh` (bash); git remote/branch config; markdown runbook.

## Global Constraints

- **STACKING MODE:** commit locally only; do NOT `git push`.
- **No live host changes while authoring** — this sub-phase writes config-example + docs. The actual EC2 re-point (edit `/etc/vortex-bench.env`, re-clone, force-rebuild) is USER-GATED.
- **No secret VALUES** committed (ENFORCED BAN) — the env example keeps secret fields blank as today.
- **SPDX header** on any new file (markdown HTML-comment form; the env example already has it).
- **Do not edit v2 production files** (ENFORCED BAN). `ops/` is v3 scaffolding — editing it is in scope.
- **No NEW monorepo back-references** — the runbook NAMES `vortex-data/vortex` as the OLD source (a fact), but introduces no `../`-style filesystem coupling.
- **Standalone-layout facts (verbatim):** this repo's ops scripts live at `ops/` (repo root), NOT `benchmarks-website/ops/` (the monorepo subpath); the Cargo workspace is at the repo root, so `ops/deploy.sh`'s `${REPO_DIR}/target/release/vortex-bench-server` build path resolves directly when `REPO_DIR` is a checkout of THIS repo. Re-point remote: `https://github.com/vortex-data/benchmarks-website.git`. `DEPLOY_BRANCH=develop` (this repo's main after the decouple merge).
- **Scope boundary (deferred):** `ops/BOOTSTRAP.md` + `ops/install.sh` carry many monorepo-layout references (`vortex-data/vortex.git`, `~/vortex`, `./benchmarks-website/ops/install.sh`). A wholesale rewrite of that v3 bootstrap doc is OUT of this sub-phase (v3 is temporary scaffolding — don't gold-plate). The re-point runbook documents the standalone differences an operator needs; record the broader BOOTSTRAP.md/install.sh layout cleanup as deferred.

**Sources to read first:** `ops/config/vortex-bench.env.example` (REPO_DIR/DEPLOY_BRANCH at L53-59); `ops/deploy.sh` (the poll/build/restart autopilot — `REPO_DIR`, `DEPLOY_BRANCH`, the `${REPO_DIR}/target/release/vortex-bench-server` build path); `ops/README.md` § "The deploy autopilot"; the design spec `.big-plans/ct__decouple-from-monorepo-design.md` § "Secrets / infra inventory (Phase 4)" (the "v3 EC2 deploy already polls a git repo… re-pointing is an ops-config change" note).

---

### Task 1: Re-point guidance in the env example

**Files:**
- Modify: `ops/config/vortex-bench.env.example` (the `REPO_DIR` / `DEPLOY_BRANCH` block, L53-59)

- [ ] **Step 1: Update the `REPO_DIR` + `DEPLOY_BRANCH` comments for the standalone repo.**

Keep the keys and the default values working, but update the surrounding comments so an operator setting up (or re-pointing) a host knows the checkout is now THIS standalone repo, not the monorepo. Replace the `REPO_DIR` comment block + the `DEPLOY_BRANCH` comment so they read (preserving the existing `REPO_DIR=...` / `DEPLOY_BRANCH=...` lines):

```
# Repo checkout the deploy timer pulls and builds from. Owned by the
# same user as the systemd services so `git pull` and `cargo build` don't
# need sudo. This is a checkout of THIS standalone repo
# (https://github.com/vortex-data/benchmarks-website.git) — its Cargo
# workspace is at the repo root, so deploy.sh builds
# `${REPO_DIR}/target/release/vortex-bench-server` directly, and the ops
# scripts live at `${REPO_DIR}/ops/` (NOT `${REPO_DIR}/benchmarks-website/ops/`,
# the old monorepo layout). To re-point an existing monorepo-checkout host,
# see docs/runbooks/v3-host-repoint.md (a re-clone, not a remote swap).
REPO_DIR=/home/ec2-user/benchmarks-website

# Branch the deploy timer tracks (this repo's main line).
DEPLOY_BRANCH=develop
```

(The `REPO_DIR` default changes from `/home/ec2-user/vortex` to `/home/ec2-user/benchmarks-website` to reflect the standalone checkout; `DEPLOY_BRANCH=develop` is unchanged.)

- [ ] **Step 2: Verify + commit.**

```bash
cd /home/connor/spiral/vortex-data/benchmarks-website
grep -nE 'REPO_DIR=|DEPLOY_BRANCH=|benchmarks-website.git' ops/config/vortex-bench.env.example
head -2 ops/config/vortex-bench.env.example | grep -q 'SPDX-License-Identifier' && echo "SPDX intact"
# no secret values introduced (the secret fields stay blank):
grep -nE '^(INGEST_BEARER_TOKEN|ADMIN_BEARER_TOKEN)=.+' ops/config/vortex-bench.env.example && echo "FAIL secret value" || echo "secrets still blank OK"
git add ops/config/vortex-bench.env.example
git commit -m "ops: point v3 host env example at this standalone repo (REPO_DIR/DEPLOY_BRANCH)"
```
Expected: the REPO_DIR/DEPLOY_BRANCH block reflects the standalone repo; SPDX intact; secrets blank.

---

### Task 2: Author the v3-host re-point runbook

**Files:**
- Create: `docs/runbooks/v3-host-repoint.md`

- [ ] **Step 1: Write the runbook.**

Create `docs/runbooks/v3-host-repoint.md` with the SPDX HTML-comment header, then sections:

- `# Re-point the v3 EC2 host at this repo` + **Overview**: the v3 host runs a poll-and-build autopilot (`ops/deploy.sh` via a systemd timer) that fetches `origin/$DEPLOY_BRANCH`, builds `vortex-bench-server`, and restarts. It currently tracks the monorepo (`vortex-data/vortex`). This runbook re-points it at THIS repo. It is operator-executed (touches a live host) — **user-gated**; nothing here runs as part of authoring.
- **Why a re-clone, not a remote swap:** the existing host checkout (`~/vortex`) is the monorepo; this repo has unrelated git history, so `git remote set-url` + `git pull` will not fast-forward (and the monorepo working tree's layout differs — ops at `benchmarks-website/ops/` vs this repo's root `ops/`). The clean path is a fresh clone of this repo into a new `REPO_DIR`, then flip the env + timer to it.
- **Procedure (numbered, operator-run):**
  1. **Clone this repo on the host:** `cd /home/ec2-user && git clone https://github.com/vortex-data/benchmarks-website.git` (HTTPS remote, matching the v3 convention of HTTPS-not-SSH for the deploy user). Result: `REPO_DIR=/home/ec2-user/benchmarks-website`.
  2. **Point the env at the new checkout:** in `/etc/vortex-bench.env` set `REPO_DIR=/home/ec2-user/benchmarks-website` and `DEPLOY_BRANCH=develop` (see `ops/config/vortex-bench.env.example`). Keep all other values (secrets, paths) unchanged.
  3. **Re-run install from the new checkout** (the ops scripts are now at the repo root): `cd /home/ec2-user/benchmarks-website && ./ops/install.sh` — note the path is `./ops/install.sh`, NOT `./benchmarks-website/ops/install.sh` (that monorepo subpath does not exist in this standalone repo). This refreshes the systemd units to reference the new `REPO_DIR`.
  4. **Force a rebuild from the new source:** `sudo systemctl start vortex-bench-deploy.service` (or `./ops/force-rebuild.sh`) so the host builds the new tip within ~60s rather than waiting for the timer. Confirm via `journalctl -u vortex-bench-deploy -f` and the running-build check in `ops/README.md` § "Identifying the running build".
  5. **Verify** the service is healthy on the new source: `curl -fsS http://127.0.0.1:3000/health` returns OK, and the deploy log shows it fetched `origin/develop` from the benchmarks-website remote.
- **Rollback:** the old `~/vortex` checkout is untouched by the above; to revert, set `REPO_DIR=/home/ec2-user/vortex` + `DEPLOY_BRANCH=develop` back in `/etc/vortex-bench.env` and re-run install from there. The re-point is reversible until the old checkout is removed.
- **Note on `ops/BOOTSTRAP.md` / `ops/install.sh`:** those v3 docs/scripts still contain monorepo-layout references (`vortex-data/vortex.git`, `~/vortex`, `./benchmarks-website/ops/`). They are being left as-is for now (v3 is temporary scaffolding); follow THIS runbook's standalone paths where they differ. (Tracked as deferred cleanup in the spine.)

- [ ] **Step 2: Verify + commit.**

```bash
cd /home/connor/spiral/vortex-data/benchmarks-website
test -f docs/runbooks/v3-host-repoint.md && echo "file OK"
head -4 docs/runbooks/v3-host-repoint.md | grep -q 'SPDX-License-Identifier: Apache-2.0' && echo "SPDX OK"
# the standalone ./ops/ path (not benchmarks-website/ops/) is documented:
grep -q './ops/install.sh' docs/runbooks/v3-host-repoint.md && echo "standalone ops path OK"
# the re-point remote is this repo:
grep -q 'benchmarks-website.git' docs/runbooks/v3-host-repoint.md && echo "re-point remote OK"
# no secret values:
! grep -nE '(PASSWORD|TOKEN|SECRET|BEARER)[[:space:]]*[:=][[:space:]]*[A-Za-z0-9/_+-]{12,}' docs/runbooks/v3-host-repoint.md && echo "no secret values OK"
git add docs/runbooks/v3-host-repoint.md
git commit -m "docs: add v3-host re-point runbook (4.3)"
```
Expected: `file OK`, `SPDX OK`, `standalone ops path OK`, `re-point remote OK`, `no secret values OK`.

---

## Self-Review

**1. Spec coverage:**
- Re-point REPO_DIR/DEPLOY_BRANCH at this repo (ops config) → Task 1 ✓
- Re-point procedure documented (the "+ docs" half) → Task 2 ✓
- Live execution gated on user confirmation → both tasks author only; the runbook is operator-run ✓
- Standalone-layout reality (root `ops/`, re-clone vs remote-swap, build path) → captured accurately ✓

**2. Placeholder scan:** No TBD/TODO/"handle X". Paths, the remote URL, the env keys, and the procedure commands are concrete. The deferred BOOTSTRAP.md/install.sh layout cleanup is explicitly out-of-scope and recorded, not a hidden placeholder.

**3. Consistency:** `REPO_DIR=/home/ec2-user/benchmarks-website` + `DEPLOY_BRANCH=develop` + remote `vortex-data/benchmarks-website.git` + `./ops/install.sh` (root layout) are consistent across Task 1 and Task 2, and match `ops/deploy.sh`'s `${REPO_DIR}/target/release/vortex-bench-server` build path (workspace at repo root).

**Note:** ops-config + documentation deliverable — no code logic, no tests. Acceptance = config/doc accuracy + SPDX + no secret values; live re-point is user-gated. big-plans fires a `pr-2` gauntlet on the diff after these tasks.
