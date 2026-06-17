<!--
SPDX-License-Identifier: Apache-2.0
SPDX-FileCopyrightText: Copyright the Vortex contributors
-->

# benchmarks-website

The website and data pipeline behind [`bench.vortex.dev`](https://bench.vortex.dev),
the public home for Vortex benchmark results.

> **Status: extraction in progress.**
> This repository was split out of
> [`vortex-data/vortex`](https://github.com/vortex-data/vortex) (from its
> `benchmarks-website/` directory) so the site can iterate at its own pace
> without the monorepo's CI. The code here is a faithful snapshot of that
> directory, but the decoupling is not finished: standalone builds, CI, deploy
> automation, secrets, and the benchmark *emitters* still live in (or point at)
> the monorepo. Until that work lands, treat the monorepo copy as the
> operational source of truth. See [Decoupling status](#decoupling-status).

## Layout

| Path | What it is |
|------|------------|
| `web/` | The current frontend and read service: a Next.js app deployed to Vercel, reading from the hosted Postgres. |
| `server/` | `vortex-bench-server`, the Rust ingest/read server (`axum` + `maud`). |
| `migrate/` | `vortex-bench-migrate`, the one-shot DuckDB-to-Postgres migration tool. |
| `infra/` | AWS provisioning for the hosted Postgres and IAM. See [`infra/README.md`](infra/README.md). |
| `ops/` | Operator runbook and scripts for the host-based deploy. See [`ops/README.md`](ops/README.md). |
| `public/`, `src/`, `index.html`, `server.js`, `vite.config.js` | The legacy Node + React site (the original `bench.vortex.dev` stack). |

The tree currently carries several generations of the site side by side (the
legacy Node/React stack, the Rust + DuckDB stack, and the Next.js + Postgres
stack). Pruning the superseded generations is part of the cleanup tracked below.

## Documentation

- [`AGENTS.md`](AGENTS.md) - conventions and footguns for working in this tree.
- [`server/ARCHITECTURE.md`](server/ARCHITECTURE.md) - the read model and request flow.
- [`ops/README.md`](ops/README.md) - the operator runbook.
- [`infra/README.md`](infra/README.md) - hosted Postgres provisioning.
- [`migrate/README.md`](migrate/README.md) - the migration tool.

Some links inside those documents still point at monorepo paths
(`../.github/...`, `../vortex-bench/...`). Fixing those cross-repo references is
part of the decoupling work below.

## Decoupling status

Done:

- [x] Code extracted into this standalone repository.

Not yet (the decoupling project):

- [ ] **Standalone Rust build.** `server/` and `migrate/` were members of the
  Vortex Cargo workspace; this repo needs a root workspace before `cargo build`
  works here.
- [ ] **CI.** Build, test, and the Vercel deploy currently run from monorepo
  workflows.
- [ ] **Secrets and environment.** Database credentials, the revalidate token,
  and the site base URL live in the monorepo's GitHub and Vercel settings.
- [ ] **Emitters.** The benchmark runs that produce results stay in the
  monorepo's CI and post to this site's ingest endpoint. That contract has to
  be kept in sync across both repositories.

## License

Apache-2.0. See the SPDX headers in each file.
