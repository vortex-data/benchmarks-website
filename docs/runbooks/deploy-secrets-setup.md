<!--
SPDX-License-Identifier: Apache-2.0
SPDX-FileCopyrightText: Copyright the Vortex contributors
-->

# Deploy & secrets ownership setup (benchmarks-website)

## Overview

This runbook is the one-time external setup that lets `vortex-data/benchmarks-website` own its own
deploys (Vercel) and schema-deploy (AWS OIDC → RDS), independent of the `vortex-data/vortex`
monorepo. The workflows already in this repo — `.github/workflows/web-deploy.yml`,
`.github/workflows/web-keep-warm.yml`, and `.github/workflows/schema-deploy.yml` — are already in
place and consume the secrets/vars listed here. Every step in this runbook is executed by an
operator (via web console or CLI); the workflows themselves do not drive the setup.

**Secrets-handling rule:** never commit a secret value to the repository. Set values only in the
Vercel project env, GitHub Actions secrets, or AWS — this document lists names and where to copy
values from, never values themselves.

**Related documentation (cross-reference — do not duplicate):**
- [`infra/README.md`](../../infra/README.md) — RDS Postgres + RDS Proxy + OIDC provisioning
  history and bootstrap procedure for account `245040174862`.
- [`ops/README.md`](../../ops/README.md) and [`ops/BOOTSTRAP.md`](../../ops/BOOTSTRAP.md) — v3
  EC2 host architecture and step-by-step bootstrap/recovery.
- [`migrations/README.md`](../../migrations/README.md) — schema migration bootstrap ordering,
  `requires-superuser` marker contract, and `migrator` role history.

## Prerequisites

Before starting, confirm you have:

- **Vercel team/org access** with permission to create new projects (project-creator or owner role).
- **GitHub repo admin** on `vortex-data/benchmarks-website` (to set Actions secrets and vars).
- **AWS IAM permissions** on account `245040174862` to edit the OIDC roles' trust policies
  (`iam:UpdateAssumeRolePolicy` on `GitHubBenchmarkSchemaRole` and `GitHubBenchmarkIngestRole`).
- CLI tools authenticated:
  - `gh` — `gh auth status` shows `vortex-data/benchmarks-website` accessible.
  - `vercel` — `vercel whoami` shows the correct team/org.
  - `aws` — `aws sts get-caller-identity` returns account `245040174862`.
  - Or use the respective web consoles (Vercel Dashboard, GitHub Settings, AWS IAM console) for
    each step — all steps describe both paths.

---

## A. Create the new Vercel project

**Rationale (decision (d)):** This repo deploys to a NEW Vercel project it owns — not the
`vortex-data/vortex` monorepo's existing project. Vercel CLI deploys are keyed by
`VERCEL_PROJECT_ID`; the monorepo's `web-deploy.yml` still fires on its own project (we touch
nothing there). Sharing the project would race: two repos pushing to the same project ID can
interleave build slots and overwrite each other's deployments. A new project is the only race-free,
monorepo-untouched path. The monorepo's project is retired in future work; the Phase-5 DNS cutover
will point production at the winning project at that time.

1. **Create the project.**

   - **Dashboard path:** Vercel Dashboard → New Project → Import Git Repository →
     `vortex-data/benchmarks-website`. When prompted for configuration:
     - Set **Root Directory** = `web/` (the Next.js app lives there; `web/vercel.json` is the
       project config file Vercel reads for cron, headers, and other project settings).
     - Framework preset: Next.js (auto-detected from `web/package.json`).
   - **CLI path (from `web/`):**
     ```sh
     cd web
     vercel link   # follow prompts: create new project, set root = web/
     ```

2. **Disable Git integration** on the new project immediately after creation.

   Vercel's default Git integration would auto-deploy on every push to the repo. This repo's deploy
   is driven exclusively by `.github/workflows/web-deploy.yml` via `vercel deploy --prebuilt` — a
   Vercel-side auto-build would race that workflow and produce duplicate, unsynchronized deployments.

   - **Dashboard path:** Project Settings → Git → Disconnect Git Repository (or "Disable Auto
     Deployments" if available).
   - Confirm: after disconnecting, pushing a commit to this repo must NOT trigger a Vercel build in
     the project's deployment list.

3. **Note the project's generated domains.**

   After creation, Vercel assigns a preview domain (e.g. `benchmarks-website-<hash>.vercel.app`) and
   optionally a production domain. Record these for smoke-testing later (Section B, step 4).

4. **Record `VERCEL_ORG_ID` and `VERCEL_PROJECT_ID`.**

   After `vercel link`, both IDs are written to `web/.vercel/project.json`. Read them from there, or
   from Project Settings → General in the Vercel Dashboard.

   ```sh
   cat web/.vercel/project.json
   # {"orgId": "...", "projectId": "..."}
   ```

   - These are non-sensitive identifiers (not secrets). They become GitHub Actions **variables**
     (not secrets) in Section C.
   - **Do NOT commit `web/.vercel/`** — confirm it is listed in `.gitignore` (it should be; verify
     with `git check-ignore -v web/.vercel/project.json`).

---

## B. Set the Vercel project environment variables

In the new project's **Production AND Preview** environments, set the following variables. These are
consumed by `web/lib/db.ts` (database connection pool) and `web/app/api/revalidate/route.ts`
(cache revalidation bearer).

Copy values from the existing monorepo-owned Vercel project's environment settings, or from your
team's secret store. **Never paste a value into this document.**

| Name | Purpose | Copy value from |
|---|---|---|
| `BENCH_DB_HOST` | RDS instance (or proxy) hostname for the read pool | Existing monorepo Vercel project env, or `infra/README.md` "After provisioning" section |
| `BENCH_DB_NAME` | Postgres database name (`vortex_bench`) | Existing monorepo Vercel project env |
| `BENCH_DB_USER` | Postgres username for the read role (`bench_read`) | Existing monorepo Vercel project env |
| `BENCH_DB_PASSWORD` | Static password for the `bench_read` role (IAM auth bypass for Vercel) | Existing monorepo Vercel project env or your secret store |
| `BENCH_DB_PORT` | Postgres port (default `5432`; omit to use default) | Existing monorepo Vercel project env |
| `BENCH_DB_REGION` | AWS region for IAM token generation (e.g. `us-east-1`); required when `BENCH_DB_PASSWORD` is unset | Existing monorepo Vercel project env |
| `BENCH_DB_SSL` | TLS verification mode (`verify-full` for RDS production, `disable` for local dev only) | Existing monorepo Vercel project env |
| `BENCH_DB_CA` | RDS CA bundle PEM content or mode; required for `verify-full` — Node does not include Amazon RDS roots in its trust store | Existing monorepo Vercel project env or [Amazon RDS CA bundle](https://truststore.pki.rds.amazonaws.com/global/global-bundle.pem) |
| `BENCH_DB_POOL_MAX` | Max connections in the pg pool (default `8`; omit to use default) | Existing monorepo Vercel project env |
| `BENCH_DB_IDLE_TIMEOUT_MS` | Pool idle-connection timeout in ms (default `300000` = 5 min; omit to use default) | Existing monorepo Vercel project env |
| `BENCH_REVALIDATE_TOKEN` | Bearer token for `POST /api/revalidate` — must match the value the monorepo's emitter caller (`post-ingest.py`) sends | Existing monorepo Vercel project env; coordinate with the monorepo caller (see note below) |
| `BENCH_DATA_TAG` | Next.js Data Cache tag flushed by `/api/revalidate` (constant value `bench-data`; set explicitly if you need to override the compiled-in default) | Hardcoded in `web/lib/data-cache.ts` as `'bench-data'`; only set this env var if you need to override it |

> **`BENCH_REVALIDATE_TOKEN` coordination:** this token is shared between this repo's Vercel
> deployment and the monorepo's `post-ingest.py` revalidation caller. When you copy the value to
> the new project, the emitter's `POST /api/revalidate` call will authenticate against this new
> project's endpoint automatically — no monorepo change needed. If you rotate the token, update it
> in both places: this Vercel project and the monorepo's GitHub Actions secret that feeds
> `post-ingest.py`.

To set variables via CLI (repeat for each name; example for `BENCH_DB_HOST`):

```sh
# Set for both Production and Preview environments:
vercel env add BENCH_DB_HOST production
vercel env add BENCH_DB_HOST preview
# vercel prompts for the value interactively — paste from your secret store, do not write it here
```

Or use the Vercel Dashboard: Project → Settings → Environment Variables → Add.

After setting all variables, trigger a test deployment to confirm the pool connects:

```sh
vercel deploy --prebuilt   # or push to the branch wired in web-deploy.yml
```

Check the function logs in the Vercel Dashboard for any `Missing required environment variable`
errors from `web/lib/db.ts`. A successful `/api/health` response confirms the pool is up.

---

## C. Set this repo's GitHub Actions secrets and variables

In `vortex-data/benchmarks-website` → Settings → Secrets and variables → Actions, configure one
secret and seven variables. **Secrets** are masked in logs; **variables** are plain identifiers that
are safe to expose in log output.

### C.1 Secret

| Name | Purpose |
|---|---|
| `VERCEL_TOKEN` | Vercel access token with deploy scope on the new project (created in Section A) |

Set via `gh` CLI — the operator pastes the value at the interactive prompt; the value is never
echoed on the command line or stored in shell history:

```bash
gh secret set VERCEL_TOKEN --repo vortex-data/benchmarks-website   # prompts for the value (not echoed)
```

**Dashboard path:** Settings → Secrets and variables → Actions → New repository secret → Name:
`VERCEL_TOKEN`.

### C.2 Variables

Variables hold non-sensitive identifiers. Use `--body` to pass the value inline (safe because these
are not secrets):

```bash
# Vercel project identifiers — copy from web/.vercel/project.json (recorded in Section A)
gh variable set VERCEL_ORG_ID        --repo vortex-data/benchmarks-website --body "<org id from Section A>"
gh variable set VERCEL_PROJECT_ID    --repo vortex-data/benchmarks-website --body "<project id from Section A>"
gh variable set BENCH_SITE_BASE_URL  --repo vortex-data/benchmarks-website --body "https://<new project public URL>"

# AWS OIDC role ARN for schema-deploy.yml
gh variable set GH_BENCH_SCHEMA_ROLE_ARN  --repo vortex-data/benchmarks-website --body "arn:aws:iam::245040174862:role/GitHubBenchmarkSchemaRole"

# RDS connection coordinates for schema-deploy.yml
gh variable set RDS_BENCH_REGION            --repo vortex-data/benchmarks-website --body "<rds region>"
gh variable set RDS_BENCH_INSTANCE_ENDPOINT --repo vortex-data/benchmarks-website --body "<rds instance endpoint host>"
gh variable set RDS_BENCH_DB_NAME           --repo vortex-data/benchmarks-website --body "<rds db name>"
```

**Dashboard path:** Settings → Secrets and variables → Actions → Variables tab → New repository
variable.

**Workflow consumers:**

| Variable | Consumed by |
|---|---|
| `VERCEL_TOKEN` (secret) | `web-deploy.yml`, `web-keep-warm.yml` |
| `VERCEL_ORG_ID` | `web-deploy.yml`, `web-keep-warm.yml` |
| `VERCEL_PROJECT_ID` | `web-deploy.yml`, `web-keep-warm.yml` |
| `BENCH_SITE_BASE_URL` | `web-deploy.yml`, `web-keep-warm.yml` |
| `GH_BENCH_SCHEMA_ROLE_ARN` | `schema-deploy.yml` |
| `RDS_BENCH_REGION` | `schema-deploy.yml` |
| `RDS_BENCH_INSTANCE_ENDPOINT` | `schema-deploy.yml` |
| `RDS_BENCH_DB_NAME` | `schema-deploy.yml` |

> **Note on `GH_BENCH_SCHEMA_ROLE_ARN`:** the literal ARN above uses account `245040174862` and role
> name `GitHubBenchmarkSchemaRole`. Confirm these against the existing monorepo config (e.g.
> `infra/README.md` or the monorepo's GitHub Actions variables) if there is any discrepancy before
> setting.

---

## D. Extend the AWS IAM OIDC trust to this repo

### D.1 Background

The GitHub-OIDC roles in AWS account `245040174862` —

- `GitHubBenchmarkSchemaRole` — assumed by `schema-deploy.yml` to apply incremental migrations via
  the `migrator` Postgres role.
- `GitHubBenchmarkIngestRole` — assumed by the v4 ingest pipeline (lives in the monorepo).

Both roles trust the GitHub OIDC provider (`token.actions.githubusercontent.com`). Their current
trust policy's `StringLike` condition allows only `repo:vortex-data/vortex:*` to assume them.

### D.2 Goal

Add `repo:vortex-data/benchmarks-website:*` to the trust condition so this repo's Actions workflows
can assume `GitHubBenchmarkSchemaRole`. **Do NOT remove the existing monorepo entry** —
`repo:vortex-data/vortex:*` must remain in place so the monorepo's ingest pipeline and any other
consumers continue to work during the cutover window.

### D.3 Required trust-policy `Condition` shape

After the edit, the `Statement` entry for each role must look like this (the `sub` claim becomes a
list):

```json
{
  "Effect": "Allow",
  "Principal": { "Federated": "arn:aws:iam::245040174862:oidc-provider/token.actions.githubusercontent.com" },
  "Action": "sts:AssumeRoleWithWebIdentity",
  "Condition": {
    "StringEquals": { "token.actions.githubusercontent.com:aud": "sts.amazonaws.com" },
    "StringLike": {
      "token.actions.githubusercontent.com:sub": [
        "repo:vortex-data/vortex:*",
        "repo:vortex-data/benchmarks-website:*"
      ]
    }
  }
}
```

### D.4 CLI path (idempotent — fetch, edit, put-back)

Apply to `GitHubBenchmarkSchemaRole` (required for Phase 4):

```bash
# 1. Fetch the current trust document
aws iam get-role --role-name GitHubBenchmarkSchemaRole \
  --query 'Role.AssumeRolePolicyDocument' --output json > /tmp/schema-trust.json

# 2. Edit /tmp/schema-trust.json:
#    In the StringLike condition, change the "sub" value from a single string to the list shown in
#    D.3 above. Keep the existing "repo:vortex-data/vortex:*" entry; add the new entry below it.

# 3. Apply the updated policy
aws iam update-assume-role-policy --role-name GitHubBenchmarkSchemaRole \
  --policy-document file:///tmp/schema-trust.json
```

**Dashboard path (alternative):** AWS IAM console → Roles → `GitHubBenchmarkSchemaRole` → Trust
relationships → Edit trust policy → update the `sub` value to the list above → Update policy.

> **`GitHubBenchmarkIngestRole`:** apply the same edit only if this repo will also drive v4 ingest
> from CI. That is out of scope for Phase 4 — `schema-deploy.yml` is the only OIDC consumer added
> this phase. Leave `GitHubBenchmarkIngestRole` unchanged for now unless explicitly planned.

### D.5 Bootstrap caveat — superuser migrations must precede OIDC role usage

**Cross-reference: `migrations/README.md` § Bootstrap ordering.**

The `migrator` Postgres role (assumed via OIDC by `schema-deploy.yml`) is `NOSUPERUSER`. Several
migrations are marked `requires-superuser`:

- `002`, `004`, `005`, `006`, `007`

These migrations **must be applied by the RDS master user out-of-band** before `schema-deploy.yml`
can run incremental applies. The runner's preflight check will refuse any `requires-superuser`-marked
file that has not already been applied, raising a clear `PermissionError` and halting the workflow.

**Action required before first `schema-deploy.yml` run:**

1. Connect to RDS as the master user (see `migrations/README.md` for the connection procedure).
2. Apply migrations `002`, `004`, `005`, `006`, and `007` manually.
3. Only after those are recorded in the migration state table may `schema-deploy.yml` be triggered
   for any subsequent migration.

See `migrations/README.md` § Bootstrap ordering for the authoritative procedure and the full list
of master-applied files.

---

<!-- Section E will be appended by a subsequent runbook task. -->
