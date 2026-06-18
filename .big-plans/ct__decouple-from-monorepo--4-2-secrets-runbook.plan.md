<!--
SPDX-License-Identifier: Apache-2.0
SPDX-FileCopyrightText: Copyright the Vortex contributors
-->

# Phase 4.2 — Secrets / Deploy-Ownership Runbook Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Author one operator-followable runbook (`docs/runbooks/deploy-secrets-setup.md`) that documents every external change required to give THIS repo (`vortex-data/benchmarks-website`) ownership of its deploy secrets/infra — a new Vercel project + env, this repo's GitHub Actions secrets/vars, and an AWS IAM OIDC trust extension — so the user can execute them console/CLI-side.

**Architecture:** A single markdown runbook under a new `docs/runbooks/` directory. It is pure documentation — it DESCRIBES external changes the user executes; authoring it performs NO external change. Each section is numbered, idempotent, and verifiable. Secret VALUES never appear; only names + where-to-set them.

**Tech Stack:** Markdown; `gh` CLI (GitHub secrets/vars); `vercel` CLI / Vercel dashboard; `aws iam` CLI (OIDC trust policy).

## Global Constraints

- **STACKING MODE:** commit locally only; do NOT `git push`.
- **No external side-effects while authoring** — this sub-phase writes a DOC. Do not run `gh secret set`, `vercel`, or `aws iam` against real infra. The runbook's commands are for the USER to run later (user-gated).
- **NEVER write a secret VALUE into the runbook** (ENFORCED BAN `secret values`): names + locations only. Where a value is needed, instruct "copy from <source> / your secret store" — never inline it.
- **SPDX header** on the new file (markdown HTML-comment form): `<!--` / `SPDX-License-Identifier: Apache-2.0` / `SPDX-FileCopyrightText: Copyright the Vortex contributors` / `-->`.
- **No NEW monorepo back-references** (`../`, `vortex-bench/`): the runbook may NAME the monorepo (`vortex-data/vortex`) as a fact (the OIDC trust currently pins it; copy env values from the monorepo-owned Vercel project) but must not add a filesystem back-reference.
- **Repo identity (verbatim):** GitHub repo `vortex-data/benchmarks-website`; AWS IAM account `245040174862`; OIDC roles `GitHubBenchmarkSchemaRole` (schema-deploy) + `GitHubBenchmarkIngestRole` (v4 ingest); current OIDC trust pinned to `repo:vortex-data/vortex:*`.
- **Confirmed names** (do not invent others): GitHub SECRET `VERCEL_TOKEN`; GitHub VARS `VERCEL_ORG_ID`, `VERCEL_PROJECT_ID`, `BENCH_SITE_BASE_URL`, `GH_BENCH_SCHEMA_ROLE_ARN`, `RDS_BENCH_REGION`, `RDS_BENCH_INSTANCE_ENDPOINT`, `RDS_BENCH_DB_NAME`. Vercel project env: `BENCH_DB_HOST`, `BENCH_DB_NAME`, `BENCH_DB_USER`, `BENCH_DB_PASSWORD`, `BENCH_DB_PORT`, `BENCH_DB_REGION`, `BENCH_DB_SSL`, `BENCH_DB_CA`, `BENCH_DB_POOL_MAX`, `BENCH_DB_IDLE_TIMEOUT_MS`, `BENCH_REVALIDATE_TOKEN`, `BENCH_DATA_TAG`.
- **Cross-reference, don't duplicate:** the v3/RDS provisioning history lives in `infra/README.md`, `ops/README.md`, `ops/BOOTSTRAP.md`, and `migrations/README.md` (bootstrap ordering). Link to them; do not restate their content.

**Sources to read first (for accuracy):** `.big-plans/ct__decouple-from-monorepo-design.md` § "Secrets / infra inventory (Phase 4)" (the full table + AWS account/roles/trust pin) and Key decision (d); the spine `.big-plans/ct__decouple-from-monorepo.md` § Reviewer context (BANS); `.github/workflows/{web-deploy,web-keep-warm,schema-deploy}.yml` (the exact `vars.*`/`secrets.*` each consumes); `web/lib/db.ts` + `web/app/api/revalidate/route.ts` (the `BENCH_*` env it reads); `migrations/README.md` § Bootstrap ordering (the `requires-superuser` caveat).

---

### Task 1: Scaffold the runbook — file, SPDX, overview, ownership model, Vercel sections (A + B)

**Files:**
- Create: `docs/runbooks/deploy-secrets-setup.md` (new dir `docs/runbooks/`)

**Interfaces:**
- Produces: the runbook file with `# Deploy & secrets ownership setup` H1, an **Overview** (what this gives the repo + that all steps are user-executed, one-time, idempotent), a **Prerequisites** note (Vercel org access, repo admin on `vortex-data/benchmarks-website`, AWS IAM access to account `245040174862`), and sections **A** + **B**. Later tasks append sections C, D, E to this same file.

- [ ] **Step 1: Create `docs/runbooks/deploy-secrets-setup.md` with SPDX + overview + prerequisites.**

Write the SPDX HTML-comment header, then:
- `# Deploy & secrets ownership setup (benchmarks-website)`
- **Overview** prose: this runbook is the one-time external setup that lets `vortex-data/benchmarks-website` own its own deploys (Vercel) and schema-deploy (AWS OIDC → RDS), independent of the `vortex-data/vortex` monorepo. Every step is executed by an operator (console or CLI) — the repo's workflows (`.github/workflows/{web-deploy,web-keep-warm,schema-deploy}.yml`) are already in place and consume the secrets/vars below. State the **secrets-handling rule**: never commit a value; set values only in Vercel project env / GitHub Actions secrets / AWS — this doc lists names only.
- **Prerequisites**: Vercel team/org access with project-create permission; admin on the GitHub repo `vortex-data/benchmarks-website`; AWS IAM permissions on account `245040174862` to edit the OIDC roles' trust policies; `gh`, `vercel`, and `aws` CLIs authenticated (or use the respective web consoles).
- Add a one-line cross-reference list to `infra/README.md`, `ops/README.md`, `ops/BOOTSTRAP.md`, `migrations/README.md` for the underlying v3/RDS history.

- [ ] **Step 2: Add Section A — Create the new Vercel project.**

Append `## A. Create the new Vercel project`. Content (numbered, idempotent):
1. Rationale (decision (d)): a NEW Vercel project owned by this repo — NOT the monorepo's existing project — because deploys are CLI-keyed by `VERCEL_PROJECT_ID` and the monorepo's deploy still fires on its own project; a shared project would race. A new project is the only race-free, monorepo-untouched path.
2. Create the project (dashboard: New Project → import `vortex-data/benchmarks-website`, OR `vercel link` from `web/`). Set **Root Directory = `web/`** (the Next.js app lives there; `web/vercel.json` is the project config). 
3. **Disable Git integration** on the new project (Settings → Git → Disconnect) so Vercel does not auto-deploy on push — deploys are driven exclusively by `.github/workflows/web-deploy.yml` via the Vercel CLI. (Confirm: pushing to the repo must NOT trigger a Vercel-side build.)
4. Note the project's generated preview/production domain.
5. **Record `VERCEL_ORG_ID` and `VERCEL_PROJECT_ID`** — after `vercel link`, both are in `web/.vercel/project.json` (do NOT commit `.vercel/`; confirm it is gitignored), or read them from Project Settings. These are identifiers, not secrets, and become GitHub **vars** in Section C.

- [ ] **Step 3: Add Section B — Set the Vercel project env vars.**

Append `## B. Set the Vercel project environment variables`. Instruct: in the new project's **Production AND Preview** environments, set the read-path config consumed by `web/lib/db.ts` and `web/app/api/revalidate/route.ts`. Present as a table of `name → purpose → where to copy the value from` (value = "the existing monorepo-owned Vercel project's env, or your secret store" — NEVER inline). Rows (exact names): `BENCH_DB_HOST`, `BENCH_DB_NAME`, `BENCH_DB_USER`, `BENCH_DB_PASSWORD` (the `bench_read` static read password), `BENCH_DB_PORT`, `BENCH_DB_REGION`, `BENCH_DB_SSL`, `BENCH_DB_CA` (RDS CA bundle / mode), `BENCH_DB_POOL_MAX`, `BENCH_DB_IDLE_TIMEOUT_MS`, `BENCH_REVALIDATE_TOKEN` (bearer for `POST /api/revalidate`; must match the value the monorepo emitter caller sends), `BENCH_DATA_TAG` (if used). Add a note: `BENCH_REVALIDATE_TOKEN` is shared with the monorepo's revalidate caller — coordinate the value so the emitter's `POST /api/revalidate` continues to authenticate.

- [ ] **Step 4: Verify scaffold + commit.**

```bash
cd /home/connor/spiral/vortex-data/benchmarks-website
test -f docs/runbooks/deploy-secrets-setup.md && echo "file OK"
head -4 docs/runbooks/deploy-secrets-setup.md | grep -q 'SPDX-License-Identifier: Apache-2.0' && echo "SPDX OK"
# No secret-value literals (heuristic: no obvious key=value with a long token):
! grep -nE '(PASSWORD|TOKEN|SECRET)[[:space:]]*[:=][[:space:]]*[A-Za-z0-9/_+-]{12,}' docs/runbooks/deploy-secrets-setup.md && echo "no inline secret values OK"
git add docs/runbooks/deploy-secrets-setup.md
git commit -m "docs: runbook scaffold + Vercel project/env sections (4.2 A+B)"
```
Expected: `file OK`, `SPDX OK`, `no inline secret values OK`.

---

### Task 2: Sections C (GitHub secrets/vars) + D (AWS IAM OIDC trust extension)

**Files:**
- Modify: `docs/runbooks/deploy-secrets-setup.md` (append sections C and D)

**Interfaces:**
- Consumes: `VERCEL_ORG_ID` / `VERCEL_PROJECT_ID` recorded in Section A.

- [ ] **Step 1: Add Section C — This repo's GitHub Actions secrets + vars.**

Append `## C. Set this repo's GitHub Actions secrets and variables`. Instruct: in `vortex-data/benchmarks-website` → Settings → Secrets and variables → Actions. Distinguish SECRET (masked) from VAR (plain). Provide the idempotent `gh` CLI path AND note the console path. Exact content:
- **Secret:** `VERCEL_TOKEN` — a Vercel access token with deploy scope on the new project. Command (the operator pastes the value at the interactive prompt; never echo it on the command line):
  ```bash
  gh secret set VERCEL_TOKEN --repo vortex-data/benchmarks-website   # prompts for the value (not echoed)
  ```
- **Vars** (identifiers, not secrets — `--body` is fine):
  ```bash
  gh variable set VERCEL_ORG_ID        --repo vortex-data/benchmarks-website --body "<org id from Section A>"
  gh variable set VERCEL_PROJECT_ID    --repo vortex-data/benchmarks-website --body "<project id from Section A>"
  gh variable set BENCH_SITE_BASE_URL  --repo vortex-data/benchmarks-website --body "https://<new project public URL>"
  gh variable set GH_BENCH_SCHEMA_ROLE_ARN  --repo vortex-data/benchmarks-website --body "arn:aws:iam::245040174862:role/GitHubBenchmarkSchemaRole"
  gh variable set RDS_BENCH_REGION           --repo vortex-data/benchmarks-website --body "<rds region>"
  gh variable set RDS_BENCH_INSTANCE_ENDPOINT --repo vortex-data/benchmarks-website --body "<rds instance endpoint host>"
  gh variable set RDS_BENCH_DB_NAME          --repo vortex-data/benchmarks-website --body "<rds db name>"
  ```
  For each, state which workflow consumes it: `VERCEL_*` + `BENCH_SITE_BASE_URL` → `web-deploy.yml` / `web-keep-warm.yml`; `GH_BENCH_SCHEMA_ROLE_ARN` + `RDS_BENCH_*` → `schema-deploy.yml`. Note the exact ARN literal is illustrative — confirm the role name/account against the existing monorepo config if it differs.

- [ ] **Step 2: Add Section D — Extend the AWS IAM OIDC trust to this repo.**

Append `## D. Extend the AWS IAM OIDC trust to this repo`. Content:
- Background: the GitHub-OIDC roles `GitHubBenchmarkSchemaRole` (used by `schema-deploy.yml`) and `GitHubBenchmarkIngestRole` (v4 ingest) live in AWS account `245040174862`. Their trust policy currently allows only `repo:vortex-data/vortex:*` to assume them via the GitHub OIDC provider (`token.actions.githubusercontent.com`).
- Goal: ADD `repo:vortex-data/benchmarks-website:*` to the trust condition so this repo's Actions can assume the schema role. **Do NOT remove the monorepo entry** — both must work during the cutover window.
- Show the trust-policy `Condition` shape (the `token.actions.githubusercontent.com:sub` `StringLike` becomes a LIST):
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
- CLI path (idempotent — fetch, edit, put-back):
  ```bash
  aws iam get-role --role-name GitHubBenchmarkSchemaRole \
    --query 'Role.AssumeRolePolicyDocument' --output json > /tmp/schema-trust.json
  # edit /tmp/schema-trust.json to add the benchmarks-website sub (per the shape above)
  aws iam update-assume-role-policy --role-name GitHubBenchmarkSchemaRole \
    --policy-document file:///tmp/schema-trust.json
  ```
  Note: apply the same edit to `GitHubBenchmarkIngestRole` only if this repo will also drive v4 ingest from CI (out of scope for Phase 4 unless stated — `schema-deploy.yml` is the only OIDC consumer this phase adds).
- **Bootstrap caveat** (cross-ref `migrations/README.md` § Bootstrap ordering): the `requires-superuser` migrations (`002`, `004`, `005`, `006`, `007`) must be applied by the RDS **master** out-of-band BEFORE `schema-deploy.yml` (which assumes the `migrator` role) can run incremental applies — `migrator` is `NOSUPERUSER` and the runner's preflight will refuse marked files with a clear `PermissionError`. Point the operator at `migrations/README.md` for the master-applied bootstrap.

- [ ] **Step 3: Verify + commit.**

```bash
cd /home/connor/spiral/vortex-data/benchmarks-website
grep -q '## C\.' docs/runbooks/deploy-secrets-setup.md && grep -q '## D\.' docs/runbooks/deploy-secrets-setup.md && echo "C+D present"
! grep -nE '(PASSWORD|TOKEN|SECRET)[[:space:]]*[:=][[:space:]]*[A-Za-z0-9/_+-]{12,}' docs/runbooks/deploy-secrets-setup.md && echo "no inline secret values OK"
git add docs/runbooks/deploy-secrets-setup.md
git commit -m "docs: runbook GitHub-secrets + AWS-OIDC sections (4.2 C+D)"
```
Expected: `C+D present`, `no inline secret values OK`.

---

### Task 3: Section E (verification) + whole-doc final check

**Files:**
- Modify: `docs/runbooks/deploy-secrets-setup.md` (append section E)

- [ ] **Step 1: Add Section E — Post-setup verification.**

Append `## E. Verify the setup`. List the checks that become runnable once A–D are done (these are the Phase-4 exit criteria's live-infra parts, user-confirmed at the gate):
1. **Vercel build (CLI auth + project link):**
   ```bash
   cd web && vercel pull --yes --environment=preview --token="$VERCEL_TOKEN" && vercel build --token="$VERCEL_TOKEN"
   ```
   Expected: exits 0 (the project resolves and builds). A non-zero exit means the project link / `VERCEL_*` vars are wrong.
2. **Schema-deploy OIDC→IAM→RDS dry run:** trigger `schema-deploy.yml` via `workflow_dispatch` with `dry_run: true` (GitHub Actions UI, or `gh workflow run schema-deploy.yml -f dry_run=true --repo vortex-data/benchmarks-website`). Expected: the job assumes `GitHubBenchmarkSchemaRole`, connects to RDS as `migrator` with `sslmode=verify-full`, and prints migration status. A `status`-drift exit is informational in dry_run (the workflow reports, does not fail); an OIDC/connection failure means the trust extension (Section D) or the `RDS_BENCH_*`/`GH_BENCH_SCHEMA_ROLE_ARN` vars (Section C) are wrong.
3. **Keep-warm (optional):** once `BENCH_SITE_BASE_URL` is set and a deploy has landed, `web-keep-warm.yml` will ping `/api/health` on schedule; a manual `workflow_dispatch` confirms it.
- Add a closing **Rollback / cutover note**: this setup is additive (new Vercel project, trust EXTENSION). It does not touch the monorepo's Vercel project or remove its OIDC trust, so it is safe to perform before the production DNS cutover (a separate, later effort).

- [ ] **Step 2: Whole-document final check + commit.**

```bash
cd /home/connor/spiral/vortex-data/benchmarks-website
# All five sections present:
for s in 'A\.' 'B\.' 'C\.' 'D\.' 'E\.'; do grep -q "## $s" docs/runbooks/deploy-secrets-setup.md || echo "MISSING section $s"; done
echo "section check done"
# SPDX + no secret values + no new monorepo back-reference path:
head -4 docs/runbooks/deploy-secrets-setup.md | grep -q 'SPDX-License-Identifier: Apache-2.0' && echo "SPDX OK"
! grep -nE '(PASSWORD|TOKEN|SECRET)[[:space:]]*[:=][[:space:]]*[A-Za-z0-9/_+-]{12,}' docs/runbooks/deploy-secrets-setup.md && echo "no inline secret values OK"
! grep -nE '\.\./[a-z]' docs/runbooks/deploy-secrets-setup.md && echo "no back-ref paths OK"
git add docs/runbooks/deploy-secrets-setup.md
git commit -m "docs: runbook verification section + finalize (4.2 E)"
```
Expected: `section check done` (no MISSING lines), `SPDX OK`, `no inline secret values OK`, `no back-ref paths OK`.

---

## Self-Review

**1. Spec coverage:**
- A New Vercel project (decision (d)) → Task 1 Step 2 ✓
- B Vercel env vars (BENCH_DB_* + revalidate token) → Task 1 Step 3 ✓
- C GitHub secrets/vars (VERCEL_TOKEN secret; VERCEL_*/BENCH_SITE_BASE_URL/GH_BENCH_SCHEMA_ROLE_ARN/RDS_BENCH_* vars) → Task 2 Step 1 ✓
- D AWS IAM OIDC trust extension (add benchmarks-website sub, keep monorepo) + bootstrap caveat → Task 2 Step 2 ✓
- E Verification (vercel build; schema-deploy dry_run) → Task 3 Step 1 ✓
- "runbook file exists" (Phase-4 exit criterion) → file created Task 1 ✓

**2. Placeholder scan:** Angle-bracket fill-ins (`<org id from Section A>`, `<rds region>`, etc.) are deliberate operator-supplied values, not plan placeholders — they are the per-environment values the user fills at execution; the runbook must not hardcode them (and must not hardcode secret values at all). All commands, names, the trust-policy JSON shape, and the ARN/account literals are concrete.

**3. Name consistency:** secret/var names match the workflows verbatim (`VERCEL_TOKEN`, `VERCEL_ORG_ID`, `VERCEL_PROJECT_ID`, `BENCH_SITE_BASE_URL`, `GH_BENCH_SCHEMA_ROLE_ARN`, `RDS_BENCH_{REGION,INSTANCE_ENDPOINT,DB_NAME}`) and `web/lib/db.ts` (`BENCH_DB_*`, `BENCH_REVALIDATE_TOKEN`, `BENCH_DATA_TAG`). Account `245040174862` + role names match the design-spec inventory.

**Note:** documentation deliverable — no code, no tests. Acceptance = doc completeness + accuracy + SPDX + zero inline secret values; external execution is user-gated (the runbook guides it). big-plans fires a `pr-2` gauntlet on the diff after these tasks.
