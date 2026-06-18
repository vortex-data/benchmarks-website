<!--
SPDX-License-Identifier: Apache-2.0
SPDX-FileCopyrightText: Copyright the Vortex contributors
-->

# Phase 4.1 — Deploy Workflows Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Author this repo's three deploy workflows (`web-deploy.yml`, `web-keep-warm.yml`, `schema-deploy.yml`) and bring in the `scripts/migrate-schema.py` runner, so the repo OWNS its deploy CI — pure in-repo authoring, no external console changes.

**Architecture:** `web-deploy.yml` deploys the Next.js v4 site (`web/`) to this repo's OWN new Vercel project via the Vercel CLI (`pull`/`build`/`deploy --prebuilt`), keyed by `VERCEL_*` secrets/vars (decision (d): git-integration OFF on that project so this repo's deploys never race the monorepo's). `schema-deploy.yml` is adapted from the real monorepo source (`origin/ct/bench-v4`): it OIDC-assumes the `migrator` RDS role and runs `migrate-schema.py apply|status` — shipped `workflow_dispatch`-only here (the push-to-`develop` auto-trigger is a post-cutover 4.2 enablement, because this repo's OIDC trust does not exist until 4.2). `web-keep-warm.yml` is an external scheduled `curl` against the public prod URL, distinct from the in-app Vercel cron in `web/vercel.json`.

**Tech Stack:** GitHub Actions YAML; Vercel CLI; AWS OIDC + RDS IAM auth; `uv` (PEP-723) Python runner; `actionlint` for validation.

## Global Constraints

- **STACKING MODE:** no PR/merge/push per phase — everything stacks on `ct/decouple-from-monorepo` and merges once at the final PR. **Do NOT `git push`** in this sub-phase.
- **No external side-effects in 4.1:** author files only. No Vercel/AWS/GitHub console changes (those are 4.2/4.3, user-gated). Reference all secrets/vars **by name only**.
- **NEVER commit a secret value** (ENFORCED BAN `secret values`). Workflows read `${{ secrets.* }}` / `${{ vars.* }}` — never literals.
- **SPDX header on every new file** (ENFORCED BAN `SPDX headers`): YAML/Python both use `#`-comment two-liner — `# SPDX-License-Identifier: Apache-2.0` then `# SPDX-FileCopyrightText: Copyright the Vortex contributors`.
- **No NEW monorepo back-references** (ENFORCED BAN `monorepo coupling`): no `../`, `vortex-bench/`, `../.github/`. (Copying `migrate-schema.py` INTO this repo is fine — it is no longer a back-reference.)
- **Do not edit v2 production files** (ENFORCED BAN `v2 production files`).
- **Floating action tags, not SHAs** (Accepted tradeoff — apply, do not re-flag): third-party `uses:` reference floating tags. Match this repo's existing convention (`actions/checkout@v4`, `actions/setup-node@v4` in `web-ci.yml`/`rust-ci.yml`).
- **Workflow conventions** (from existing `.github/workflows/web-ci.yml` + `rust-ci.yml`): explicit `name:`; least-privilege `permissions:`; stable-literal-slug `concurrency.group` (NOT `${{ github.workflow }}`); `timeout-minutes` on every job.
- **Validation gate:** `actionlint .github/workflows/*.yml` → 0 must stay green after every workflow task. Runtime (`vercel build`, OIDC connect) is NOT testable in 4.1 (no creds; user-gated) — it is validated in Phase 4.2.

**Source repo for adaptation:** monorepo at `/home/connor/spiral/vortex-data/vortex`, ref `origin/ct/bench-v4`. Read sources with `git -C /home/connor/spiral/vortex-data/vortex show origin/ct/bench-v4:<path>`.

---

### Task 1: Bring in `scripts/migrate-schema.py`

**Files:**
- Create: `scripts/migrate-schema.py` (copied verbatim from the monorepo source)

**Interfaces:**
- Produces: a `uv`-runnable migration runner invoked by Task 4's `schema-deploy.yml` as `uv run --no-project scripts/migrate-schema.py apply|status`. Subcommands: `apply` (exit 0), `status` (exit 0 in-sync / exit 1 on drift). Default migrations dir = `Path(__file__).resolve().parent.parent / "migrations"` = `<repo>/migrations` (exists here, 7 SQL files + README).

- [ ] **Step 1: Copy the runner verbatim from the monorepo source**

```bash
git -C /home/connor/spiral/vortex-data/vortex show origin/ct/bench-v4:scripts/migrate-schema.py \
  > /home/connor/spiral/vortex-data/benchmarks-website/scripts/migrate-schema.py
```

It is a self-contained PEP-723 script (inline metadata `requires-python = ">=3.11"`, `dependencies = ["psycopg[binary]>=3.2"]`) and already carries the two-line SPDX header. `uv run --no-project` resolves the inline deps with no project context — it does NOT need this repo to have a `pyproject.toml`.

- [ ] **Step 2: Verify SPDX header, no monorepo back-references, and Python validity**

```bash
cd /home/connor/spiral/vortex-data/benchmarks-website
head -8 scripts/migrate-schema.py | grep -q 'SPDX-License-Identifier: Apache-2.0' && echo "SPDX OK"
# Must print nothing (no NEW back-references):
grep -nE '\.\./|vortex-bench|benchmarks-website/' scripts/migrate-schema.py || echo "no back-refs OK"
python3 -c "import ast,sys; ast.parse(open('scripts/migrate-schema.py').read()); print('parse OK')"
```

Expected: `SPDX OK`, `no back-refs OK`, `parse OK`. Note: the script's line-12 docstring comment mentions a workspace `pyproject.toml` `dev` group — that is a verbatim-vendored doc comment (like the Phase-1.2 vendored `migrations/`), not a functional coupling; leave it as-is.

- [ ] **Step 3: Confirm the runner discovers this repo's migrations**

The runner has no DB-free subcommand, so verify discovery by a one-off import of its `discover()` against the real dir (no DB connection):

```bash
cd /home/connor/spiral/vortex-data/benchmarks-website
uv run --no-project - <<'PY'
import importlib.util, pathlib
spec = importlib.util.spec_from_file_location("ms", "scripts/migrate-schema.py")
m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)
files = m.discover(pathlib.Path("migrations"))
print("discovered:", [p.name for p in files])
assert [p.name for p in files] == sorted(p.name for p in files), "must be filename-ordered"
assert len(files) == 7, f"expected 7 migrations, got {len(files)}"
PY
```

Expected: prints the 7 `NNN_*.sql` filenames in order. (If `uv` is unavailable in the sandbox, fall back to `python3` with `psycopg` not required — `discover()` does not import psycopg at module top-level only if psycopg import is deferred; if the module-level `import psycopg` fails, skip this step and rely on Task 5's actionlint + a note that discovery is validated in 4.2. Do NOT add psycopg to this repo.)

- [ ] **Step 4: Commit**

```bash
cd /home/connor/spiral/vortex-data/benchmarks-website
git add scripts/migrate-schema.py
git commit -m "ci: bring in scripts/migrate-schema.py runner from monorepo"
```

---

### Task 2: Author `schema-deploy.yml` (adapt from the monorepo source)

**Files:**
- Create: `.github/workflows/schema-deploy.yml`

**Interfaces:**
- Consumes: Task 1's `scripts/migrate-schema.py`; repo-root `migrations/*.sql`; GitHub vars `GH_BENCH_SCHEMA_ROLE_ARN`, `RDS_BENCH_REGION`, `RDS_BENCH_INSTANCE_ENDPOINT`, `RDS_BENCH_DB_NAME` (provisioned in 4.2, user-gated).

- [ ] **Step 1: Read the real source**

```bash
git -C /home/connor/spiral/vortex-data/vortex show origin/ct/bench-v4:.github/workflows/schema-deploy.yml
```

- [ ] **Step 2: Author the adapted workflow**

Adapt the source with these deltas: (a) trigger = `workflow_dispatch` ONLY (drop `push: branches: [develop]` — this repo's OIDC trust does not exist until 4.2; auto-deploy-on-merge is a post-cutover enablement documented in the 4.2 runbook); (b) convert SHA-pinned `uses:` to floating tags per the Global Constraints; (c) keep the `dry_run` input, the OIDC `id-token: write` permission, the `concurrency: schema-deploy / cancel-in-progress: false`, the RDS CA-bundle download, and the client-side IAM-token generation verbatim in intent. Write `.github/workflows/schema-deploy.yml`:

```yaml
# SPDX-License-Identifier: Apache-2.0
# SPDX-FileCopyrightText: Copyright the Vortex contributors
#
# Apply Postgres schema migrations from `migrations/*.sql` to the
# benchmarks-website RDS instance via `scripts/migrate-schema.py`. Connects to
# the public RDS instance endpoint as the `migrator` IAM-auth role using a
# short-lived token generated client-side from the OIDC-assumed schema role.
#
# Trigger is `workflow_dispatch` ONLY in this repo for now: an operator runs it
# manually (optionally `dry_run` for a status-only preview). The monorepo source
# also auto-triggers on push to its deploy branch, but THIS repo defers that until
# the AWS OIDC trust is extended to this repo (Phase 4.2, user-gated) — enabling the
# push trigger before the trust exists would only produce failing runs. See the
# Phase-4.2 secrets runbook for the post-cutover enablement.
#
# Bootstrap: CI can only IAM-auth as `migrator`; the FIRST apply must be run once by
# the RDS master user out-of-band to create the `migrator` role + grant ledger access.
# Every subsequent apply runs here as `migrator`. See infra docs (Phase 4.2 runbook).

name: schema-deploy

on:
  workflow_dispatch:
    inputs:
      dry_run:
        description: "Run `status` only (report drift, apply nothing)"
        type: boolean
        default: false

permissions:
  id-token: write
  contents: read

# Serialize deploys so two operators cannot race `apply` against the same
# database. `cancel-in-progress: false` lets an in-flight apply finish.
concurrency:
  group: schema-deploy
  cancel-in-progress: false

jobs:
  apply:
    runs-on: ubuntu-latest
    timeout-minutes: 15
    steps:
      - name: Checkout
        uses: actions/checkout@v4

      - name: Install uv
        uses: spiraldb/actions/.github/actions/setup-uv@0.18.6

      - name: Configure AWS credentials via OIDC
        uses: aws-actions/configure-aws-credentials@v4
        with:
          role-to-assume: ${{ vars.GH_BENCH_SCHEMA_ROLE_ARN }}
          aws-region: ${{ vars.RDS_BENCH_REGION }}

      - name: Download RDS CA bundle
        # `sslmode=verify-full` validates the instance cert chain + hostname
        # against Amazon's published root CAs.
        run: |
          set -Eeuo pipefail
          curl -fsSL https://truststore.pki.rds.amazonaws.com/global/global-bundle.pem \
            -o "${RUNNER_TEMP}/rds-global-bundle.pem"

      - name: Apply migrations and verify status
        # The IAM auth token is generated client-side (SigV4, no API call) and
        # lives only for this step. `set -x` is deliberately NOT used so the token
        # never lands in the log. PGPASSWORD is assigned on its own line (not
        # `export PGPASSWORD=$(...)`) so a token-command failure is not masked by
        # `export`'s exit status under `set -e`.
        env:
          PGHOST: ${{ vars.RDS_BENCH_INSTANCE_ENDPOINT }}
          PGPORT: "5432"
          PGDATABASE: ${{ vars.RDS_BENCH_DB_NAME }}
          PGUSER: migrator
          PGSSLMODE: verify-full
          AWS_REGION: ${{ vars.RDS_BENCH_REGION }}
          DRY_RUN: ${{ inputs.dry_run }}
        run: |
          set -Eeuo pipefail
          PGPASSWORD="$(aws rds generate-db-auth-token \
            --hostname "${PGHOST}" \
            --port "${PGPORT}" \
            --region "${AWS_REGION}" \
            --username "${PGUSER}")"
          export PGPASSWORD
          export PGSSLROOTCERT="${RUNNER_TEMP}/rds-global-bundle.pem"
          if [ "${DRY_RUN}" = "true" ]; then
            echo "dry_run: reporting status only, applying nothing"
            uv run --no-project scripts/migrate-schema.py status
          else
            uv run --no-project scripts/migrate-schema.py apply
            uv run --no-project scripts/migrate-schema.py status
          fi
```

- [ ] **Step 3: Verify the converted action tags resolve (no SHA pins left)**

```bash
cd /home/connor/spiral/vortex-data/benchmarks-website
# No 40-hex SHA pins should remain in this file:
grep -nE 'uses:.*@[0-9a-f]{40}' .github/workflows/schema-deploy.yml && echo "FAIL: SHA pin left" || echo "no SHA pins OK"
# Confirm each tag actually exists upstream (network):
gh api repos/actions/checkout/git/ref/tags/v4 -q .ref
gh api repos/aws-actions/configure-aws-credentials/git/ref/tags/v4 -q .ref
gh api repos/spiraldb/actions/git/ref/tags/0.18.6 -q .ref
```

Expected: `no SHA pins OK` and three resolved `refs/tags/...` lines. If `aws-actions/configure-aws-credentials@v4` or `spiraldb/actions@0.18.6` does NOT resolve, pick the nearest existing floating major/release tag (e.g. the major the source SHA comment named) and re-verify — do NOT fall back to a SHA pin.

- [ ] **Step 4: actionlint + commit**

```bash
cd /home/connor/spiral/vortex-data/benchmarks-website
actionlint .github/workflows/schema-deploy.yml
git add .github/workflows/schema-deploy.yml
git commit -m "ci: add schema-deploy.yml (workflow_dispatch, OIDC migrator apply)"
```

Expected: actionlint exits 0.

---

### Task 3: Author `web-deploy.yml` (Vercel CLI, new project)

**Files:**
- Create: `.github/workflows/web-deploy.yml`

**Interfaces:**
- Consumes: GitHub secret `VERCEL_TOKEN`; GitHub vars `VERCEL_ORG_ID`, `VERCEL_PROJECT_ID` (the NEW project, provisioned in 4.2, user-gated). The Vercel project's **Root Directory must be set to `web/`** (a 4.2 console step) so the CLI builds the Next.js app from `web/` — this workflow runs the CLI from the repo root and relies on that project setting + the pulled `.vercel/` config.

- [ ] **Step 1: Confirm the project's deploy unit**

`web/vercel.json` exists and is the Vercel config for the Next.js app under `web/`. Decision (d): NEW Vercel project, Root Directory `web/`, git-integration OFF, CLI-keyed. The CLI authenticates with `VERCEL_TOKEN` and identifies the project via `VERCEL_ORG_ID` + `VERCEL_PROJECT_ID` env.

- [ ] **Step 2: Author the workflow**

```yaml
# SPDX-License-Identifier: Apache-2.0
# SPDX-FileCopyrightText: Copyright the Vortex contributors
#
# Deploy the Next.js v4 site to this repo's OWN Vercel project via the Vercel CLI
# (git-integration is OFF on that project — Phase-4 decision (d)). The CLI is keyed
# by VERCEL_ORG_ID + VERCEL_PROJECT_ID (vars, the NEW independently-owned project)
# and authenticated by VERCEL_TOKEN (secret), so this repo's deploys never race the
# monorepo's deploys to ITS project.
#
# The Vercel project's Root Directory must be set to `web/` (Phase-4.2 console step);
# the CLI runs from the repo root and uses the pulled project settings to build web/.
#
# Trigger: production deploy on push to `develop` (this repo's main branch after the
# decouple merge); `workflow_dispatch` for manual prod/preview runs during setup. No
# pull_request/feature-branch trigger — the project + secrets are provisioned in 4.2
# and a feature-branch preview flow is out of scope here. End-to-end deploy is
# validated in Phase 4.2 once creds exist; 4.1 only authors + actionlint-validates.

name: Web Deploy

on:
  push:
    branches: [develop]
  workflow_dispatch:
    inputs:
      environment:
        description: "Vercel target environment"
        type: choice
        options: [preview, production]
        default: preview

concurrency:
  group: web-deploy-${{ github.ref }}
  cancel-in-progress: true

permissions:
  contents: read

env:
  VERCEL_ORG_ID: ${{ vars.VERCEL_ORG_ID }}
  VERCEL_PROJECT_ID: ${{ vars.VERCEL_PROJECT_ID }}

jobs:
  deploy:
    name: Build & deploy to Vercel
    runs-on: ubuntu-latest
    timeout-minutes: 20
    steps:
      - name: Checkout
        uses: actions/checkout@v4

      - name: Install Vercel CLI
        run: npm install -g vercel@latest

      - name: Resolve target environment
        id: target
        # push to develop => production; manual dispatch uses the input.
        run: |
          set -Eeuo pipefail
          if [ "${{ github.event_name }}" = "workflow_dispatch" ]; then
            echo "env=${{ inputs.environment }}" >> "$GITHUB_OUTPUT"
          else
            echo "env=production" >> "$GITHUB_OUTPUT"
          fi

      - name: Pull Vercel project settings
        run: vercel pull --yes --environment="${{ steps.target.outputs.env }}" --token="${{ secrets.VERCEL_TOKEN }}"

      - name: Build
        run: |
          set -Eeuo pipefail
          if [ "${{ steps.target.outputs.env }}" = "production" ]; then
            vercel build --prod --token="${{ secrets.VERCEL_TOKEN }}"
          else
            vercel build --token="${{ secrets.VERCEL_TOKEN }}"
          fi

      - name: Deploy (prebuilt)
        run: |
          set -Eeuo pipefail
          if [ "${{ steps.target.outputs.env }}" = "production" ]; then
            vercel deploy --prebuilt --prod --token="${{ secrets.VERCEL_TOKEN }}"
          else
            vercel deploy --prebuilt --token="${{ secrets.VERCEL_TOKEN }}"
          fi
```

- [ ] **Step 3: Verify no secret literals + actionlint + commit**

```bash
cd /home/connor/spiral/vortex-data/benchmarks-website
# No bare token-looking literals; only ${{ secrets.* }}/${{ vars.* }} refs:
grep -nE 'VERCEL_TOKEN|VERCEL_ORG_ID|VERCEL_PROJECT_ID' .github/workflows/web-deploy.yml
actionlint .github/workflows/web-deploy.yml
git add .github/workflows/web-deploy.yml
git commit -m "ci: add web-deploy.yml (Vercel CLI deploy to this repo's project)"
```

Expected: every `VERCEL_*` occurrence is a `${{ secrets.* }}`/`${{ vars.* }}`/`env.*` reference (no literal value); actionlint exits 0.

---

### Task 4: Author `web-keep-warm.yml` (external scheduled ping)

**Files:**
- Create: `.github/workflows/web-keep-warm.yml`

**Decision — reconcile against the existing Vercel cron (explicit, do not skip):** `web/vercel.json` already defines a Vercel cron hitting `/api/health` every 2 min, which runs INSIDE Vercel's scheduler. This workflow is deliberately scoped to a DISTINCT purpose: an EXTERNAL scheduled `curl` (from a GitHub-hosted runner) against the public production URL, exercising the public DNS + CDN-edge path that the in-app cron does not, and providing a keep-warm/uptime signal independent of the Vercel cron quota. The header comment must state this distinction so a reviewer does not read it as redundant. (If the gauntlet/phase gate judges it genuinely redundant, dropping it is a one-line decision recorded at the gate — but the design spec lists it as a Phase-4 deliverable, so it ships scoped-distinctly here.)

**Interfaces:**
- Consumes: GitHub var `BENCH_SITE_BASE_URL` (the public prod base URL; provisioned in 4.2). Scheduled workflows run only on the default branch (`develop`) — they will not fire from the feature branch under stacking mode.

- [ ] **Step 1: Author the workflow**

```yaml
# SPDX-License-Identifier: Apache-2.0
# SPDX-FileCopyrightText: Copyright the Vortex contributors
#
# External keep-warm / uptime ping for the deployed v4 site. This is an EXTERNAL
# edge ping (from a GitHub-hosted runner) against the public production URL —
# DISTINCT from the in-app Vercel cron in `web/vercel.json` (`/api/health` every
# 2 min, run inside Vercel's own scheduler). The external ping additionally
# exercises the public DNS + CDN-edge path the internal cron does not, and is
# independent of the Vercel cron quota. The target URL is `vars.BENCH_SITE_BASE_URL`
# (provisioned in Phase 4.2). Scheduled runs fire only on the default branch.

name: Web Keep-Warm

on:
  schedule:
    - cron: "*/10 * * * *"   # every 10 minutes
  workflow_dispatch:

permissions:
  contents: read

concurrency:
  group: web-keep-warm
  cancel-in-progress: true

jobs:
  ping:
    name: Ping production health endpoint
    runs-on: ubuntu-latest
    timeout-minutes: 5
    steps:
      - name: Curl health endpoint
        env:
          BASE_URL: ${{ vars.BENCH_SITE_BASE_URL }}
        run: |
          set -Eeuo pipefail
          if [ -z "${BASE_URL}" ]; then
            echo "BENCH_SITE_BASE_URL not set; skipping keep-warm ping" >&2
            exit 0
          fi
          curl -fsS --max-time 30 --retry 2 "${BASE_URL%/}/api/health" -o /dev/null
          echo "keep-warm ping OK: ${BASE_URL%/}/api/health"
```

- [ ] **Step 2: actionlint + commit**

```bash
cd /home/connor/spiral/vortex-data/benchmarks-website
actionlint .github/workflows/web-keep-warm.yml
git add .github/workflows/web-keep-warm.yml
git commit -m "ci: add web-keep-warm.yml (external scheduled prod ping)"
```

Expected: actionlint exits 0.

---

### Task 5: Whole-suite validation

**Files:** (none — verification only)

- [ ] **Step 1: actionlint across ALL workflows (this is the phase-4 exit-criterion command)**

```bash
cd /home/connor/spiral/vortex-data/benchmarks-website
actionlint .github/workflows/*.yml
```

Expected: exit 0 (covers `rust-ci.yml`, `web-ci.yml`, `web-deploy.yml`, `web-keep-warm.yml`, `schema-deploy.yml`).

- [ ] **Step 2: Confirm SPDX headers on all five workflows + the runner**

```bash
cd /home/connor/spiral/vortex-data/benchmarks-website
for f in .github/workflows/web-deploy.yml .github/workflows/web-keep-warm.yml .github/workflows/schema-deploy.yml scripts/migrate-schema.py; do
  head -3 "$f" | grep -q 'SPDX-License-Identifier: Apache-2.0' && echo "SPDX OK: $f" || echo "MISSING SPDX: $f"
done
```

Expected: `SPDX OK` for all four.

- [ ] **Step 3: Confirm no secret values and no new monorepo back-references in the new files**

```bash
cd /home/connor/spiral/vortex-data/benchmarks-website
# No new back-references in the authored workflows:
grep -rnE '\.\./|vortex-bench/|\.\./\.github/' .github/workflows/web-deploy.yml .github/workflows/web-keep-warm.yml .github/workflows/schema-deploy.yml && echo "FAIL back-ref" || echo "no back-refs OK"
```

Expected: `no back-refs OK`. (No commit in this task — verification only. If anything fails, return to the owning task.)

---

## Self-Review

**1. Spec coverage:**
- `web-deploy.yml` → Task 3 ✓ (Vercel CLI pull/build/deploy --prebuilt, new project, decision (d)).
- `web-keep-warm.yml` → Task 4 ✓ (external cron ping; vercel.json overlap reconciled explicitly).
- `schema-deploy.yml` → Task 2 ✓ (adapted from real `origin/ct/bench-v4` source; workflow_dispatch-only; OIDC; floating tags).
- `scripts/migrate-schema.py` brought in → Task 1 ✓.
- Phase-4 exit-criterion `actionlint .github/workflows/*.yml → 0` → Task 5 Step 1 ✓.
- ENFORCED BANS (SPDX, no secret values, no monorepo back-refs, floating tags) → Global Constraints + Task 5 Steps 2–3 ✓.

**2. Placeholder scan:** No `TBD`/`TODO`/"add error handling"/"similar to Task N". Each workflow's full YAML is inline. The only deferred-to-4.2 items (Vercel project creation, OIDC trust, var provisioning, end-to-end deploy validation) are correctly out of 4.1's in-repo-authoring scope and are named explicitly, not hidden as placeholders.

**3. Type/name consistency:** Task 1 produces `scripts/migrate-schema.py` with subcommands `apply`/`status`; Task 2's `schema-deploy.yml` invokes exactly `uv run --no-project scripts/migrate-schema.py apply|status`. Var/secret names (`VERCEL_TOKEN`/`VERCEL_ORG_ID`/`VERCEL_PROJECT_ID`/`GH_BENCH_SCHEMA_ROLE_ARN`/`RDS_BENCH_*`/`BENCH_SITE_BASE_URL`) match the design spec's Secrets/infra inventory. Action tags (`@v4`, `@0.18.6`) match this repo's floating-tag convention.

**Note on review/execution:** This sub-phase is driven by big-plans (subagent-driven-development per task, then a `pr-3` gauntlet checkpoint at Step 2.3). Runtime deploy validation is deferred to Phase 4.2 (needs creds, user-gated); 4.1's gate is `actionlint` + YAML validity + the enforced BANS.
