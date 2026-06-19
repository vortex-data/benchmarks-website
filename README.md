<!--
SPDX-License-Identifier: Apache-2.0
SPDX-FileCopyrightText: Copyright the Vortex contributors
-->

# benchmarks-website

The website and data pipeline behind the public home for Vortex benchmark
results. Benchmark jobs in the [`vortex-data/vortex`](https://github.com/vortex-data/vortex)
monorepo emit per-commit measurements; this repo stores them and renders them as
time-series charts — one chart per `(benchmark, dataset, …)` dimension tuple,
plotted across the Vortex commit history.

This repository is **standalone**. It was split out of the monorepo's
`benchmarks-website/` directory and now carries its own Cargo workspace, CI,
Vercel deploy, schema deploy, and secrets. The benchmark *emitters* still live in
the monorepo (this repo owns the ingest *contract*, not the producers).

## Generations

The site has been rebuilt twice; all three generations live side-by-side here
while the final cutover finishes.

| Gen | Stack | Storage | Status |
|---|---|---|---|
| **v2** | Node `server.js` + Vite/React SPA (Cloudflare) | Static S3 dump, aggregated in memory at read time | **Live** at `bench.vortex.dev`. Retired after cutover. |
| **v3** | `vortex-bench-server` — Rust `axum` + `maud` (EC2) | DuckDB file on local disk | Experimental; still an emit target. Decommissioned with the cutover. |
| **v4** | `web/` — Next.js App Router (Vercel) | AWS RDS Postgres | **Live** at `benchmarks-website.vercel.app`; `develop` = production. The forward stack. |

The full story — how data flows from an emitter to a chart, why there are three
generations, and the design decisions behind the current stack — is in
[**`docs/architecture/`**](docs/architecture/README.md). Read that first.

## Layout

| Path | What it is |
|------|------------|
| `web/` | **v4** frontend + read service: a Next.js app on Vercel reading the hosted Postgres. |
| `server/` | **v3** `vortex-bench-server`, the Rust ingest/read server (`axum` + `maud`). |
| `migrate/` | `vortex-bench-migrate`, the v2→v3→v4 migration tool. |
| `migrations/` | The Postgres schema (SQL migrations + the `_applied_migrations` ledger). |
| `infra/` | AWS provisioning for the hosted Postgres + IAM. |
| `ops/` | Operator runbook and scripts for the legacy v3 host deploy. |
| `scripts/` | `migrate-schema.py` (the schema-deploy runner) and golden fixtures. |
| `public/`, `src/`, `index.html`, `server.js`, `vite.config.js` | The legacy **v2** Node + React site. |

## Documentation

- [`docs/architecture/`](docs/architecture/README.md) — **the system architecture**
  (data pipeline, read path, performance, deploy/infra, design decisions). Start here.
- [`CONTRACT.md`](CONTRACT.md) — the versioned emitter → ingester wire contract.
- [`AGENTS.md`](AGENTS.md) — conventions and footguns for working in this tree.
- [`server/ARCHITECTURE.md`](server/ARCHITECTURE.md) — the v3 read model and request flow.
- [`docs/runbooks/`](docs/runbooks/) — operator runbooks (deploy + secrets setup).
- [`infra/README.md`](infra/README.md) — hosted Postgres provisioning.
- [`ops/README.md`](ops/README.md) — the legacy v3 host runbook.
- [`migrate/README.md`](migrate/README.md) — the migration tool.

## Status and remaining cutover

The decoupling from the monorepo is **complete**: standalone build, CI, Vercel
deploy, OIDC schema deploy, and secrets all live here, and v4 is live in
production serving the full benchmark history.

What remains (deliberately deferred — making v4 good before tearing anything down):

- [ ] **Emitter / ingest cutover.** Point the monorepo emitters at the v4 ingest
  path (direct RDS write + `POST /api/revalidate`) instead of the v2 S3 dump / v3
  server. Until then, v4 data is refreshed by re-running `vortex-bench-migrate`
  (see [`migrate/README.md`](migrate/README.md)). Full cross-repo plan:
  [`docs/runbooks/emitter-ingest-cutover.md`](docs/runbooks/emitter-ingest-cutover.md).
- [ ] **DNS cutover.** Repoint `bench.vortex.dev` at v4 and make the Vercel
  deployment protection public.
- [ ] **Decommission v2 and v3** once nothing depends on them.

## Quick start

```bash
# v4 web app (needs BENCH_DB_* env for a real DB; see web/README or lib/db.ts):
cd web && pnpm install && pnpm dev

# v3 server (DuckDB) + Rust workspace tests:
INGEST_BEARER_TOKEN=dev cargo run -p vortex-bench-server
cargo nextest run -p vortex-bench-server -p vortex-bench-migrate

# Build a fresh DuckDB from the v2 dump:
cargo run -p vortex-bench-migrate -- run --output ./bench.duckdb
```

See [`AGENTS.md`](AGENTS.md) for the full local-dev and env-var contract.

## License

Apache-2.0. See the SPDX headers in each file.
