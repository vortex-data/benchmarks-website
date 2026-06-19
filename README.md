<!--
SPDX-License-Identifier: Apache-2.0
SPDX-FileCopyrightText: Copyright the Vortex contributors
-->

# benchmarks-website

The public home for **Vortex benchmark results** — and the data pipeline behind
it. Benchmark jobs in the [`vortex-data/vortex`](https://github.com/vortex-data/vortex)
monorepo emit one measurement per commit; this repo stores those measurements
and renders them as time-series charts — one per `(benchmark, dataset, …)`
dimension tuple, plotted across the Vortex commit history.

**Live at [bench.vortex.dev](https://bench.vortex.dev).**

> This repo owns the **storage, the read services, and the ingest contract** —
> not the benchmark runs. The emitters live in the monorepo and stay there.

## How it works, in one glance

```
monorepo CI  ──emit──▶  database  ──read──▶  charts
 (the runs)            (this repo)          one per (benchmark, dataset, …),
                                            x-axis = the Vortex commit history
```

The site has been rebuilt twice, and all three generations live side-by-side
here while the final cutover finishes — they share one emitter output, so the
same measurement feeds every generation:

| Gen | Stack | Storage | Status |
|---|---|---|---|
| **v2** | Vite/React SPA on Cloudflare | static S3 dump | **live** at `bench.vortex.dev`; retired after cutover |
| **v3** | Rust `axum` + `maud` on EC2 | DuckDB on local disk | experimental; an emit target only |
| **v4** | Next.js App Router on Vercel | AWS RDS Postgres | the **forward stack**; `develop` = production at `benchmarks-website.vercel.app` |

Each generation traded the previous one's main weakness: v2→v3 moved grouping
from read-time-in-the-browser to ingest-time records in a real analytical store;
v3→v4 moved off a self-managed box onto managed serverless. The full story — data
flow, why there are three generations, and the design decisions and tradeoffs
behind the current stack — is in
[**`docs/architecture/`**](docs/architecture/README.md). **Start there.**

## Find your way around

| If you want to… | Go to |
|---|---|
| understand the whole system | [`docs/architecture/`](docs/architecture/README.md) |
| know the emitter ↔ ingester wire format | [`CONTRACT.md`](CONTRACT.md) |
| work in this tree (env vars, conventions, footguns) | [`AGENTS.md`](AGENTS.md) |
| deploy, set up secrets, or run a data refresh | [`docs/runbooks/`](docs/runbooks/) |
| dig into one component | the per-directory READMEs in the layout below |

## Layout

| Path | What it is |
|------|------------|
| `web/` | **v4** — the Next.js read service on Vercel ([README](web/README.md)). |
| `server/` | **v3** — the Rust `axum` ingest/read server ([ARCHITECTURE](server/ARCHITECTURE.md)). |
| `migrate/` | `vortex-bench-migrate`, the v2→v3→v4 migration tool ([README](migrate/README.md)). |
| `migrations/` | the Postgres schema — SQL migrations + the `_applied_migrations` ledger. |
| `infra/` | AWS provisioning for the hosted Postgres + IAM ([README](infra/README.md)). |
| `ops/` | the legacy v3 host deploy runbook + scripts ([README](ops/README.md)). |
| `scripts/` | the schema-deploy runner and golden fixtures. |
| `public/`, `src/`, `server.js`, … | the legacy **v2** Node + React site. |

## Quick start

The forward stack is the v4 web app:

```bash
# v4 web app (Next.js). Needs BENCH_DB_* env for a real database — see web/README.md.
cd web && pnpm install && pnpm dev
```

Working on the legacy Rust stack (the v3 server and the migrator):

```bash
# v3 server (DuckDB) + workspace tests:
INGEST_BEARER_TOKEN=dev cargo run -p vortex-bench-server
cargo nextest run -p vortex-bench-server -p vortex-bench-migrate

# Build a fresh DuckDB from the v2 S3 dump:
cargo run -p vortex-bench-migrate -- run --output ./bench.duckdb
```

See [`AGENTS.md`](AGENTS.md) for the full local-dev and env-var contract.

## Status

The split from the monorepo is **complete** — standalone build, CI, Vercel
deploy, OIDC schema deploy, and secrets all live here, and v4 serves the full
benchmark history. What remains is deliberately deferred (make v4 good before
tearing anything down):

- **Emitter / ingest cutover** — point the monorepo emitters at the v4 ingest
  path (direct RDS write + cache revalidate) instead of the v2/v3 paths.
  Cross-repo plan: [`docs/runbooks/emitter-ingest-cutover.md`](docs/runbooks/emitter-ingest-cutover.md).
- **DNS cutover** — repoint `bench.vortex.dev` at v4 and make the Vercel
  deployment public.
- **Decommission v2 and v3** once nothing depends on them.

Until the emitter cutover lands, v4 data is refreshed by re-running
`vortex-bench-migrate` (see [`migrate/README.md`](migrate/README.md)).

## License

Apache-2.0. See the SPDX headers in each file.
