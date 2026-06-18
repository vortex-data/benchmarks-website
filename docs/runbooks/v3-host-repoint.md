<!--
SPDX-License-Identifier: Apache-2.0
SPDX-FileCopyrightText: Copyright the Vortex contributors
-->

# Re-point the v3 EC2 host at this repo

## Overview

The v3 EC2 host runs a poll-and-build autopilot: `vortex-bench-deploy.timer` fires every 60 seconds,
triggers `ops/deploy.sh`, which fetches `origin/$DEPLOY_BRANCH`, builds `vortex-bench-server`, and
restarts the server. The autopilot currently tracks the `vortex-data/vortex` monorepo. This runbook
re-points it at `vortex-data/benchmarks-website` — this standalone repo.

**This runbook is operator-executed** (it touches a live host). Every step below must be run by a
human on the EC2 box over SSH or Session Manager. Nothing in this file executes as part of authoring
it, and nothing here runs automatically during a CI deploy.

**Secrets-handling rule:** never commit a secret value to the repository. Where a step mentions
`/etc/vortex-bench.env`, edit the file on the host; values stay on the host only.

---

## Why a re-clone, not a remote swap

The existing host checkout (`~/vortex`) is a clone of `vortex-data/vortex` (the monorepo). This
repo (`vortex-data/benchmarks-website`) has entirely unrelated git history — there is no common
ancestor. Running `git remote set-url origin https://github.com/vortex-data/benchmarks-website.git`
followed by `git pull` would fail: git cannot fast-forward unrelated histories, and `--allow-unrelated-histories`
would produce a merge commit that cannot track `origin/develop` cleanly going forward.

There is a second problem: the working-tree layout differs. In the monorepo checkout the ops scripts
live at `~/vortex/benchmarks-website/ops/`. In this standalone repo they live at the repo root —
`~/benchmarks-website/ops/`. Re-using the old checkout directory would leave stale monorepo-layout
paths that `install.sh` and the systemd units would resolve incorrectly.

The clean path is a fresh clone of this repo into a new directory (`~/benchmarks-website`), followed
by updating the env and re-running install from that new checkout.

---

## Procedure

All steps run on the EC2 host as `ec2-user`. Verify each step before moving to the next.

### Step 1 — Clone this repo on the host

```bash
cd /home/ec2-user
git clone https://github.com/vortex-data/benchmarks-website.git
```

This uses HTTPS (not SSH), matching the convention already established for the deploy user on this
host. The result is a new checkout at `/home/ec2-user/benchmarks-website` — this becomes the new
`REPO_DIR`.

Verify the clone landed:

```bash
ls /home/ec2-user/benchmarks-website/ops/deploy.sh
```

Expected: the file exists. If it does not, the clone failed or landed in a different path — do not
proceed.

### Step 2 — Point the env at the new checkout

Edit `/etc/vortex-bench.env` (mode `0600`, owned by `ec2-user`) and set the two re-point variables:

```bash
sudo nano /etc/vortex-bench.env   # or your preferred editor
```

Set these two values (see `ops/config/vortex-bench.env.example` for the full template):

```
REPO_DIR=/home/ec2-user/benchmarks-website
DEPLOY_BRANCH=develop
```

Leave all other values — `INGEST_BEARER_TOKEN`, `ADMIN_BEARER_TOKEN`, `VORTEX_BENCH_DB`,
`S3_BACKUP_PREFIX`, and the rest — exactly as they are. Only `REPO_DIR` and `DEPLOY_BRANCH` need to
change for the re-point.

### Step 3 — Re-run install from the new checkout

The ops scripts are at the repo root in this standalone repo. Run install from there:

```bash
cd /home/ec2-user/benchmarks-website
./ops/install.sh
```

> **Path note:** the correct path is `./ops/install.sh`, NOT `./benchmarks-website/ops/install.sh`.
> The monorepo layout put the ops directory one level deeper; that subdirectory does not exist in
> this standalone repo.

`install.sh` is idempotent — it updates the systemd units to reference the new `REPO_DIR`, refreshes
`/etc/sudoers.d/vortex-bench`, and reloads the daemon. Re-running it on an already-bootstrapped host
is safe.

Verify the units are loaded with the new path:

```bash
sudo systemctl cat vortex-bench-deploy.service | grep REPO_DIR
# or check the env file is being read from the updated location:
sudo systemctl show vortex-bench-deploy.service --property=EnvironmentFiles
```

### Step 4 — Force a rebuild from the new source

Kick the deploy service manually so the host builds the new-repo tip within ~60 seconds rather than
waiting for the next timer fire. Two equivalent paths:

```bash
# Option A: trigger the deploy service directly
sudo systemctl start vortex-bench-deploy.service

# Option B: use the force-rebuild helper (bypasses stamp and path filter)
./ops/force-rebuild.sh
```

Follow the deploy log in real time:

```bash
journalctl -u vortex-bench-deploy -f
```

Expected output: lines showing `git fetch`, `building <sha>`, `swapped symlink`, `deploy ok: <sha>`.
If the log shows errors (fetch failed, build failed) — do not proceed; see the rollback section.

To confirm the running build matches the new repo (see `ops/README.md` § "Identifying the running
build"):

```bash
# All three should show the same commit, from the benchmarks-website remote:
cat /var/lib/vortex-bench/last-deployed-sha
readlink /var/lib/vortex-bench/bin/vortex-bench-server
curl -fsS http://127.0.0.1:3000/health | python3 -m json.tool
# health response includes "build_sha" — confirm it matches the above
```

### Step 5 — Verify the service is healthy on the new source

```bash
curl -fsS http://127.0.0.1:3000/health
```

Expected: HTTP 200 with a JSON body containing `"status": "ok"` (or similar) and a `"build_sha"`
that matches a commit in `vortex-data/benchmarks-website` (not the old monorepo).

Also confirm the deploy log shows the fetch came from the right remote:

```bash
journalctl -u vortex-bench-deploy --since "5 minutes ago" | grep 'origin/develop'
```

The host is now tracking `vortex-data/benchmarks-website:develop`. The autopilot timer will continue
polling on the 60-second cycle from the new repo from this point forward.

---

## Rollback

The old `~/vortex` checkout is untouched by the steps above. To revert to the monorepo:

1. Edit `/etc/vortex-bench.env` and restore:
   ```
   REPO_DIR=/home/ec2-user/vortex
   DEPLOY_BRANCH=develop
   ```
2. Re-run install from the old checkout:
   ```bash
   cd /home/ec2-user/vortex/benchmarks-website
   ./ops/install.sh
   ```
3. Force a rebuild:
   ```bash
   sudo systemctl start vortex-bench-deploy.service
   ```
4. Verify `/health` returns OK.

The re-point is fully reversible as long as the old `~/vortex` checkout has not been removed. Do not
delete `~/vortex` until the new source has been verified healthy and the team has confirmed the
cutover is complete.

---

## Note on `ops/BOOTSTRAP.md` and `ops/install.sh`

`ops/BOOTSTRAP.md` and `ops/install.sh` still contain monorepo-layout references
(`vortex-data/vortex.git`, `~/vortex`, paths like `./benchmarks-website/ops/`). These files are
being left as-is for now — v3 is temporary scaffolding and the full audit of those references is
tracked as deferred cleanup in the project spine. Follow the standalone paths documented in **this
runbook** where they differ from what `BOOTSTRAP.md` or `install.sh` describe. Specifically:

- Clone target: `~/benchmarks-website` (not `~/vortex`)
- Remote: `https://github.com/vortex-data/benchmarks-website.git` (not the monorepo)
- Install path: `./ops/install.sh` from the repo root (not `./benchmarks-website/ops/install.sh`)
- `REPO_DIR`: `/home/ec2-user/benchmarks-website` (not `/home/ec2-user/vortex`)
