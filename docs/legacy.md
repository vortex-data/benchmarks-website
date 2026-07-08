<!--
SPDX-License-Identifier: Apache-2.0
SPDX-FileCopyrightText: Copyright the Vortex contributors
-->

# Previous generations (v2 and v3)

The benchmarks site has been rebuilt twice; the current site is the third generation (**v4**).
This document is the home for everything about the previous two generations while they are
decommissioned: what they were, what state they are in, how to run their code, and what remains
to tear down. The full history and the design rationale behind each rebuild live in
[`architecture/`](architecture/README.md).

## The generations

| Gen | Stack | Storage | Status |
|---|---|---|---|
| **v2** | Node `server.js` + Vite/React SPA on Cloudflare | Static `data.json.gz` dump in public S3 | Retired from serving; its S3 dump still receives CI uploads |
| **v3** | Rust `axum` + `maud` server on an EC2 host | DuckDB file on local disk | Never user-facing; still a hard-required emit target |
| **v4** | `web/` (Next.js App Router) on Vercel | AWS RDS Postgres | **Live production** at `bench.vortex.dev` |

The v2 source was deployed from elsewhere and never lived in this repo, though its S3 dump is
still the migrator's historical source.

All three generations were fed by the same emitter output, so the record shapes are identical
across them — that shared shape is what made the v2→v3→v4 migration a faithful copy rather than a
re-derivation.

Why three? Each generation traded the previous one's main weakness:

- **v2 → v3** moved from *read-time* classification of loose name strings (all the grouping logic
  ran in the browser/Node server on every load) to *ingest-time* structured records in a real
  analytical store (DuckDB), with a precomputed read model so the landing page costs zero SQL.
- **v3 → v4** moved from a single self-managed EC2 host (DuckDB on local disk, a systemd polling
  deploy) to a managed serverless stack (Next.js on Vercel reading hosted RDS Postgres), so there
  is no box to operate.

## What lives where

| Path | What it is |
|---|---|
| [`server/`](../server/ARCHITECTURE.md) | The v3 Rust `axum` ingest/read server. |
| [`migrate/`](../migrate/README.md) | `vortex-bench-migrate`, the v2→v3→v4 migration tool. |
| [`ops/`](../ops/README.md) | The v3 host deploy runbook and scripts. |
| [`runbooks/v3-host-repoint.md`](runbooks/v3-host-repoint.md) | Repointing the v3 EC2 host. |

`migrate/` is not purely legacy: its `load` mode is still the v4 backfill and atomic full-refresh
path (`load --replace` against RDS), so it outlives the v2/v3 deployments. See
[`architecture/data-pipeline.md`](architecture/data-pipeline.md).

## Running the legacy Rust stack

```bash
# v3 server (DuckDB) + workspace tests:
INGEST_BEARER_TOKEN=dev cargo run -p vortex-bench-server
cargo nextest run -p vortex-bench-server -p vortex-bench-migrate

# Build a fresh DuckDB from the v2 S3 dump:
cargo run -p vortex-bench-migrate -- run --output ./bench.duckdb
```

## Teardown inventory

v4 serves the full history and is a superset of the v2 dump (after the 2026-07-07 merge backfill
restored the appian and fineweb `[s3]` history), so the teardown is unblocked. The accepted loss
is ~910 v3 chart points that never reached the v2 dump.

In the monorepo:

- Promote the v4 ingest steps (`post-ingest.py --postgres`, gated on the ingest role ARN) from
  `continue-on-error: true` to required.
- Delete the three `V3_INGEST_URL`-gated v3 ingest steps (`bench.yml`, `sql-benchmarks.yml`,
  `commit-metadata.yml`).
- Repoint the PR-benchmark compare off the v2 S3 bucket, then delete the v2 uploads and
  `publish-benchmarks-website.yml`.
- Keep `vortex-bench/src/v3.rs` and `post-ingest.py --postgres` — they are v4's wire format, not
  v3 leftovers.

In this repo (after the v3 EC2 host and its S3 backups are gone):

- Delete `server/`, `ops/`, the v3 runbooks, and the Rust CI workflow.
- Keep `migrate/` for as long as the full-refresh path is wanted.
