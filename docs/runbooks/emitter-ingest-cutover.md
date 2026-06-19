<!--
SPDX-License-Identifier: Apache-2.0
SPDX-FileCopyrightText: Copyright the Vortex contributors
-->

# Runbook: emitter / ingest cutover (point the monorepo emitters at v4)

**Status when written:** 2026-06-19. v4 is live and serving the full benchmark
history, but its data is refreshed **manually** by re-running
`vortex-bench-migrate` against the v2 S3 dump. This runbook is the plan to make
the monorepo emitters write **live** to the v4 RDS so the migrator is no longer
needed.

This is a **handoff document** — it is written to be actionable by a fresh agent,
potentially on a different machine, with no memory of the prior sessions. It spans
**two repositories**: this one (`vortex-data/benchmarks-website`) and the monorepo
(`vortex-data/vortex`), which owns the emitters. Read
[`../architecture/data-pipeline.md`](../architecture/data-pipeline.md) and
[`../../CONTRACT.md`](../../CONTRACT.md) first for the contract.

---

## 0. The one thing to understand

**v4 has no ingest server.** v3 exposes `POST /api/ingest`; v4 does not. The v4
ingest path is:

1. The CI emitter writes records **directly into RDS Postgres** as the
   `bench_ingest` role (RDS IAM auth, `verify-full` TLS, `INSERT … ON CONFLICT
   (measurement_id) DO UPDATE`), computing `measurement_id` locally to match the
   server's hash bit-for-bit.
2. It then pings **`POST {site}/api/revalidate`** (bearer-token auth) on the
   Next.js app to flush its Data Cache so the new data shows immediately.

This is the "Path B / v4 dual-write" in [`../../CONTRACT.md`](../../CONTRACT.md).
It is **best-effort and additive** — it runs alongside the existing v3 ingest
(`continue-on-error`), so enabling it never risks the live v2/v3 paths.

### The key insight: most of the code already exists, unmerged

The whole v4 emitter implementation lives in the monorepo on branch
**`origin/ct/bench-v4`**, commit **`9a1824afa`** ("benchmarks-website: Phase 2 -
Postgres writer + best-effort v4 CI"). It was **never merged to `develop`**, so
the mainline emitter is still v3-only. The work here is largely *finish + merge +
provision*, not *write from scratch*. ⚠️ `develop` has advanced since that branch
(Jun 5 2026) **and** `benchmarks-website/` was extracted into this standalone repo
afterward — so expect to cherry-pick / rebase and reconcile paths, not fast-merge.

---

## 1. Reference values (verified 2026-06-19)

### AWS (account `245040174862`, region `us-east-1`)

| Thing | Value |
|---|---|
| RDS instance endpoint | `vortex-bench-prod.c4f8qygk4xdp.us-east-1.rds.amazonaws.com:5432` |
| RDS database | `vortex_bench` |
| RDS master password | AWS Secrets Manager secret `rds!db-23f1d9f9-ce44-4dc9-ac97-d3a5afaef690` (auto-rotated; `{username:postgres, password}`) |
| RDS CA bundle | `https://truststore.pki.rds.amazonaws.com/us-east-1/us-east-1-bundle.pem` |
| Schema-deploy IAM role | `GitHubBenchmarkSchemaRole` — **exists** |
| **Ingest IAM role** | `GitHubBenchmarkIngestRole` — **DOES NOT EXIST yet** (`aws iam get-role` → `NoSuchEntity`) |
| RDS `DbiResourceId` (for the rds-db ARN) | derive: `aws rds describe-db-instances --db-instance-identifier vortex-bench-prod --query 'DBInstances[0].DbiResourceId' --output text` |

### Postgres roles — **all ready, nothing to do** (verified against prod)

| Role | Grants | `rds_iam`? | Used by |
|---|---|---|---|
| `migrator` | DDL | yes | schema-deploy |
| `bench_ingest` | INSERT/SELECT/UPDATE on all 6 tables | **yes** | **the v4 ingest dual-write** |
| `bench_read` | SELECT on all 6 tables | no (password) | the Vercel reader |

Created by `migrations/00{2,4,5}_*.sql`, all applied. No migration work needed for
the cutover.

### Monorepo `vortex-data/vortex` — current GitHub vars/secrets

| Name | Current value | Action needed |
|---|---|---|
| `V3_INGEST_URL` (var) | `http://ec2-18-219-54-101.us-east-2.compute.amazonaws.com:3000` (v3 EC2) | leave during dual-write soak |
| `BENCH_SITE_BASE_URL` (var) | `https://benchmarks-web.vercel.app` ⚠️ **the deleted project** | **repoint → `https://benchmarks-website.vercel.app`** |
| `BENCHMARKS_WEB_PROD_URL` (var) | `https://benchmarks-web.vercel.app` ⚠️ deleted | repoint → `https://benchmarks-website.vercel.app` (if still referenced) |
| `GH_BENCH_SCHEMA_ROLE_ARN` (var) | `arn:aws:iam::245040174862:role/GitHubBenchmarkSchemaRole` | none |
| `RDS_BENCH_DB_NAME` (var) | `vortex_bench` | none ✓ |
| `RDS_BENCH_INSTANCE_ENDPOINT` (var) | `vortex-bench-prod.c4f8qygk4xdp.us-east-1.rds.amazonaws.com` | none ✓ |
| `RDS_BENCH_REGION` (var) | `us-east-1` | none ✓ |
| **`GH_BENCH_INGEST_ROLE_ARN` (var)** | **absent** | **SET** = the ingest role ARN (this is the gate that turns the v4 step on) |
| `BENCH_REVALIDATE_TOKEN` (secret) | exists (set 2026-06-16, for the old project) | **align** with the v4 Vercel project (§5) |
| `INGEST_BEARER_TOKEN`, `ADMIN_BEARER_TOKEN`, `VERCEL_TOKEN` (secrets) | exist | none for v4 |

### This repo `vortex-data/benchmarks-website` — for reference

- v4 Vercel project: name `benchmarks-website`, team `vortex-data`,
  `orgId team_TkGBm7OlQtmqOFNpVNuaNpFX`, `projectId prj_AOss3j7VcSu5UoyBA1LIvj4G0DQ6`,
  live at `https://benchmarks-website.vercel.app`, `develop` = production.
- Vercel **Production** env currently has the 7 `BENCH_DB_*` reader vars.
  **Missing: `BENCH_REVALIDATE_TOKEN`** (deferred; needed for the revalidate ping).
- GitHub vars: `VERCEL_ORG_ID`, `VERCEL_PROJECT_ID`, `GH_BENCH_SCHEMA_ROLE_ARN`,
  `RDS_BENCH_*`, `BENCH_SITE_BASE_URL=https://benchmarks-website.vercel.app`.

### Code locations

| What | Where |
|---|---|
| v4 emitter code (unmerged) | monorepo `origin/ct/bench-v4` @ `9a1824afa`: `scripts/post-ingest.py` (`--postgres` mode), `scripts/_measurement_id.py`, `scripts/test_measurement_id.py`, dual-write steps in `.github/workflows/{bench,sql-benchmarks,v3-commit-metadata}.yml` |
| Mainline emitter (v3-only) | monorepo `develop`: `scripts/post-ingest.py` (`--server` only), `vortex-bench/src/v3.rs` (`--gh-json-v3`, `SCHEMA_VERSION=1`) |
| `measurement_id` source of truth | **this repo**: `server/src/db.rs` (Rust hash), golden vectors `scripts/measurement_id_golden.json`, test `server/tests/measurement_id_golden.rs`. The Python port must match these. |
| Ingest IAM role provisioner | **this repo**: `infra/provision.sh` → `ensure_ingest_role()` (line ~492, called from `main` ~641). Trusts `${GITHUB_REPO:-vortex-data/vortex}` on `develop` + `ct/bench-v4`; grants `rds-db:connect` as `bench_ingest` on the instance. |
| The revalidate endpoint | this repo: `web/app/api/revalidate/route.ts` (bearer = `BENCH_REVALIDATE_TOKEN`; 503 if unset) |
| The schema (DDL) | this repo: `migrations/` |

---

## 2. The change list

### A. Create the ingest IAM role (AWS) — *I can be done from CLI*

`GitHubBenchmarkIngestRole` does not exist. `infra/provision.sh` already knows how
to create it correctly. Either run just that step, or replicate it:

```bash
# Needs AWS creds with IAM admin on account 245040174862 (see §3).
cd infra
# Option 1: run the whole provisioner (idempotent) — it ensures the OIDC provider,
# both roles, RDS, proxy, etc. Safe to re-run.
./provision.sh
# Option 2 (surgical): create just the role with the same trust + permission as
# ensure_ingest_role(): trust repo:vortex-data/vortex on develop + ct/bench-v4,
# inline policy rds-db:connect on arn:aws:rds-db:us-east-1:245040174862:dbuser:<DbiResourceId>/bench_ingest
```

Confirm trust is for **`vortex-data/vortex`** (the emitter repo), not this repo —
`provision.sh`'s `GITHUB_REPO` default is already `vortex-data/vortex`, which is
correct. Record the resulting ARN for step B.

### B. Set / repoint the monorepo GitHub vars + secrets — *CLI*

```bash
# In vortex-data/vortex:
gh variable set GH_BENCH_INGEST_ROLE_ARN -R vortex-data/vortex \
  --body 'arn:aws:iam::245040174862:role/GitHubBenchmarkIngestRole'
gh variable set BENCH_SITE_BASE_URL      -R vortex-data/vortex \
  --body 'https://benchmarks-website.vercel.app'
# repoint BENCHMARKS_WEB_PROD_URL the same way if any workflow still reads it.
```

`GH_BENCH_INGEST_ROLE_ARN` being non-empty is the gate that enables the v4 step in
the workflows — do **not** set it until the role (A) exists and the workflow code
(D) is merged, or runs will try to assume a role / run a step that isn't ready.

### C. Align `BENCH_REVALIDATE_TOKEN` across both sides — *CLI, needs go-ahead*

The revalidate ping only works if the monorepo secret equals the token on the v4
Vercel project. The existing monorepo secret was for the **deleted** project and
its value is unknown. Simplest: generate one fresh token, set it on **both**.

```bash
TOKEN="$(python3 -c 'import secrets;print(secrets.token_urlsafe(48))')"
# v4 Vercel project (Production):
printf '%s' "$TOKEN" | vercel env add BENCH_REVALIDATE_TOKEN production   # in web/, project linked
# monorepo secret:
gh secret set BENCH_REVALIDATE_TOKEN -R vortex-data/vortex --body "$TOKEN"
```

> ⚠️ Setting `BENCH_REVALIDATE_TOKEN` on the v4 project was **explicitly deferred**
> by the user in earlier sessions (and an auto-mode guard blocked it). It is *the*
> piece this cutover un-defers — get explicit go-ahead before setting it. A new
> Vercel env var only takes effect on the **next** production deploy (push to
> `develop` here, or `vercel --prod`).

### D. Bring the v4 emitter code onto monorepo `develop` — *PR in the monorepo*

Cherry-pick / port from `origin/ct/bench-v4` (`9a1824afa`), rebased onto current
`develop`, reconciling that `benchmarks-website/` is now a separate repo:

1. `scripts/post-ingest.py` — add the `--postgres <dsn>` mode (IAM-auth upsert
   writer; one transaction; NaN/Inf guard; `verify-full` TLS). Keep the v3
   `--server` path intact.
2. `scripts/_measurement_id.py` + `scripts/test_measurement_id.py` — the xxhash64
   Python port. **Verify it still matches** this repo's
   `scripts/measurement_id_golden.json` / `server/src/db.rs` (the golden vectors
   are the cross-language contract). Wire the pytest into monorepo CI.
3. `.github/workflows/{bench,sql-benchmarks,v3-commit-metadata}.yml` — add the
   best-effort v4 step: `aws-actions/configure-aws-credentials` assuming
   `vars.GH_BENCH_INGEST_ROLE_ARN`, download the RDS CA, then
   `post-ingest.py --postgres "postgresql://bench_ingest@${RDS_BENCH_INSTANCE_ENDPOINT}:5432/${RDS_BENCH_DB_NAME}?sslmode=verify-full&sslrootcert=<ca>"`
   (IAM token minted by the script), then the revalidate ping to
   `${BENCH_SITE_BASE_URL}/api/revalidate`. Gate every v4 step on
   `vars.GH_BENCH_INGEST_ROLE_ARN != ''` and set `continue-on-error: true`.
4. Keep `SCHEMA_VERSION` in lockstep (it is `1` everywhere today — see
   [`../../CONTRACT.md`](../../CONTRACT.md) for the bump procedure).

---

## 3. Machine prerequisites (fresh machine)

None of the prior session's local state carries over. The next agent needs:

- **AWS:** a profile with IAM + RDS + Secrets Manager access on account
  `245040174862`. (Prior sessions used a dedicated IAM user `bench-web-cli`,
  profile `bench-web`. IAM Identity Center is **not** enabled on this account, so
  it's long-lived access keys — rotate/remove after.) RDS is reachable on `:5432`
  from any IP (the SG is open; IAM/password is the gate).
- **GitHub:** `gh` authed with permission to set vars/secrets on **both**
  `vortex-data/vortex` and `vortex-data/benchmarks-website`.
- **Vercel:** `vercel` CLI authed and linked to the `benchmarks-website` project
  (`web/.vercel/` is gitignored; run `vercel link` or export `VERCEL_ORG_ID` /
  `VERCEL_PROJECT_ID`).
- **git:** commit signing is SSH via 1Password (`gpg.format=ssh`,
  `commit.gpgsign=true`) — **1Password must be unlocked** or `git commit`/`push`
  fail. (This bit the prior session when it auto-locked.)
- **For any data/RDS poke:** the RDS CA bundle (URL above) and master creds from
  Secrets Manager. A handy read-only way to query prod without `psql`: DuckDB's
  postgres extension —
  `duckdb -c "INSTALL postgres; LOAD postgres; ATTACH 'host=… dbname=vortex_bench user=postgres sslmode=require' AS pg (TYPE postgres, READ_ONLY); SELECT * FROM postgres_query('pg','<sql>');"`
  with `PGPASSWORD` exported from the secret (keeps it out of the connstring).

---

## 4. Recommended sequence & safety

The v4 dual-write is **additive and best-effort**, so it cannot break the live
v2/v3 paths. Recommended order:

1. **A** — create `GitHubBenchmarkIngestRole`.
2. **D** — merge the emitter code + workflow steps to monorepo `develop` (the v4
   step stays dormant while `GH_BENCH_INGEST_ROLE_ARN` is unset).
3. **C** — set/align `BENCH_REVALIDATE_TOKEN` (both sides) and redeploy v4.
4. **B** — set `GH_BENCH_INGEST_ROLE_ARN` (+ repoint `BENCH_SITE_BASE_URL`). This
   flips the v4 step on. Watch a run.
5. **Soak**: emitters now write to both v3 (DuckDB) and v4 (RDS). Once v4 is
   trusted, the manual `vortex-bench-migrate` refresh is no longer needed.
6. **Later (out of scope here):** make v4 primary, retire v3, then the DNS cutover
   (repoint `bench.vortex.dev` at v4 + make Vercel protection public) and
   decommission v2.

## 5. Verification

After step B, trigger an emitting workflow on the monorepo (or wait for a
`develop` push) and check:

- The workflow's v4 step logs: OIDC assume-role succeeded, the upsert reports
  `inserted/updated`, and the revalidate ping returns `200 {revalidated:true}`
  (not `503`/`401`).
- RDS moved: `curl -s https://benchmarks-website.vercel.app/api/health` →
  `row_counts.commits` and `latest_commit_timestamp` advance to match the just-run
  commit (compare before/after).
- The site shows the new commit without a manual migration.

If `/api/revalidate` returns `503`, the v4 project is missing
`BENCH_REVALIDATE_TOKEN` (step C) or hasn't been redeployed since it was set. If it
returns `401`, the two token values don't match.

---

## Related

- [`../architecture/data-pipeline.md`](../architecture/data-pipeline.md) — the ingest contract + migrator.
- [`../architecture/deploy-and-infra.md`](../architecture/deploy-and-infra.md) — IAM roles, OIDC, the workflows.
- [`../../CONTRACT.md`](../../CONTRACT.md) — the versioned emitter↔ingester wire contract (Path A v3, Path B v4).
- [`deploy-secrets-setup.md`](deploy-secrets-setup.md) — the original go-live secrets runbook.
- [`../../infra/README.md`](../../infra/README.md) / [`../../infra/provision.sh`](../../infra/provision.sh) — provisioning.
