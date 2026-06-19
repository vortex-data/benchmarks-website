<!--
SPDX-License-Identifier: Apache-2.0
SPDX-FileCopyrightText: Copyright the Vortex contributors
-->

# Architecture

This directory describes the **whole** benchmarks-website system: how benchmark
results get from a CI run into a chart on a web page, the three generations of
the site that have carried that job over time, and the design decisions behind
the current stack.

Start here, then follow the links below by topic.

| Document | What it covers |
|---|---|
| [`data-pipeline.md`](data-pipeline.md) | Emitters → ingest contract → storage → the `vortex-bench-migrate` tool (v2→v3→v4). The `measurement_id` invariant and `SCHEMA_VERSION`. |
| [`read-path.md`](read-path.md) | How results become charts: the v4 Next.js read service (rendering, the two-layer cache, revalidation, slug/window encoding) and the v3 Rust read model it descends from. |
| [`deploy-and-infra.md`](deploy-and-infra.md) | AWS (RDS Postgres, IAM roles, GitHub OIDC), the schema-deploy and web-deploy workflows, the SQL migrations, and the legacy v3 host ops. |
| [`design-decisions.md`](design-decisions.md) | A consolidated, ADR-style log of the load-bearing decisions and *why* they were made. |

For the operational view (how to deploy, what secrets exist, how to run a data
refresh) see the runbooks under [`../runbooks/`](../runbooks/) and the
component READMEs: [`../../infra/README.md`](../../infra/README.md),
[`../../ops/README.md`](../../ops/README.md),
[`../../migrate/README.md`](../../migrate/README.md), and
[`../../server/ARCHITECTURE.md`](../../server/ARCHITECTURE.md). The wire contract
between the monorepo emitters and this repo's ingesters is
[`../../CONTRACT.md`](../../CONTRACT.md).

## The one-paragraph version

Benchmark jobs in the [`vortex-data/vortex`](https://github.com/vortex-data/vortex)
monorepo emit per-commit measurements. Those measurements land in a database, and
a web app renders them as time-series charts — one chart per `(benchmark, dataset,
…)` dimension tuple, with the x-axis being the Vortex commit history. The site has
been rebuilt twice; **all three generations live side-by-side in this repo** while
the cutover finishes.

## The three generations

```
            EMITTERS (monorepo CI: vortex-bench --gh-json-v3 + scripts/post-ingest.py)
                 │
                 │  the same record shapes feed every generation
        ┌────────┼───────────────────────────┐
        ▼        ▼                            ▼
   ┌─────────┐  ┌────────────────┐      ┌──────────────────────┐
   │  v2     │  │  v3            │      │  v4                  │
   │  S3 dump│  │  DuckDB        │      │  RDS Postgres        │
   │ (static)│  │  + Rust server │      │  + Next.js on Vercel │
   └────┬────┘  └────────┬───────┘      └──────────┬───────────┘
        │                │                         │
   Vite/React SPA   axum + maud SSR          Next.js App Router
   on Cloudflare    on an EC2 host           (server components)
        │                │                         │
        ▼                ▼                         ▼
   bench.vortex.dev   (experimental)      benchmarks-website.vercel.app
   ★ LIVE today        emit target only     ★ the forward stack
```

| Gen | Stack | Storage | Status (2026-06-18) |
|---|---|---|---|
| **v2** | Node `server.js` + Vite/React SPA, on Cloudflare | A static `data.json.gz` dump in public S3, aggregated in memory at read time | **Live production** at `bench.vortex.dev`. To be retired after the v4 cutover. |
| **v3** | `vortex-bench-server` (Rust, `axum` + `maud`), on an EC2 host | DuckDB file on local disk | Experimental. Still receives emit data; not user-facing. To be decommissioned. |
| **v4** | `web/` (Next.js App Router) on Vercel | AWS RDS Postgres | **Live** at `benchmarks-website.vercel.app`; `develop` = production. The target the others cut over to. |

Why three? Each generation traded the previous one's main weakness:

- **v2 → v3** moved from *read-time* classification of loose name strings (all the
  grouping logic ran in the browser/Node server on every load) to *ingest-time*
  structured records in a real analytical store (DuckDB), with a precomputed read
  model so the landing page costs zero SQL.
- **v3 → v4** moved from a single self-managed EC2 host (DuckDB on local disk, a
  systemd polling deploy) to a managed, horizontally-scalable serverless stack
  (Next.js on Vercel reading hosted RDS Postgres), so there is no box to operate.

The migration tool [`vortex-bench-migrate`](../../migrate/README.md) is the bridge
that carried the full benchmark history v2 → v3 → v4 without losing a row — see
[`data-pipeline.md`](data-pipeline.md).

## What's done and what remains

The decoupling from the monorepo is **complete** (PR #1 merged to `develop`):
standalone Cargo workspace, standalone CI, Vercel deploy, schema deploy via OIDC,
and secrets are all in this repo. v4 is live and serving the full history.

Remaining cutover steps (deliberately deferred — make v4 good first):

1. **Emitter/ingest cutover** — point the monorepo emitters at the v4 ingest path
   (direct RDS write + `POST /api/revalidate`) instead of the v2 S3 dump / v3 server.
   Full plan, spanning both repos, in
   [`../runbooks/emitter-ingest-cutover.md`](../runbooks/emitter-ingest-cutover.md).
2. **DNS cutover** — repoint `bench.vortex.dev` at v4 and make the Vercel
   deployment protection public.
3. **Decommission v2 and v3** once nothing depends on them.

Until then, v4 data is refreshed by re-running `vortex-bench-migrate` against the
v2 dump (see the [data-pipeline](data-pipeline.md) doc and
[`../../migrate/README.md`](../../migrate/README.md)).
