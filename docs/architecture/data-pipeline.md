<!--
SPDX-License-Identifier: Apache-2.0
SPDX-FileCopyrightText: Copyright the Vortex contributors
-->

# Data pipeline

How a benchmark measurement travels from a CI run to a row in the database, and
how the full history was carried across the three storage generations.

See also: the wire contract [`../../CONTRACT.md`](../../CONTRACT.md), the migrator
[`../../migrate/README.md`](../../migrate/README.md), and the SQL schema under
[`../../migrations/`](../../migrations/).

## Producers: the emitters

The benchmark runs themselves live in the [`vortex-data/vortex`](https://github.com/vortex-data/vortex)
monorepo and are **owned by it** — this repo owns the *ingest contract* and the
read services, not the producers. A run does two things:

1. `vortex-bench --gh-json-v3 <path>` writes **JSONL of bare records** — one line
   per measurement, discriminated by a `kind` field.
2. `scripts/post-ingest.py` wraps that output in an envelope (adding `run_meta`
   and the `commit` block, filled from `${{ github.sha }}` and `git show`) and
   delivers it.

Because every generation's data originates from the same emitter output, the
record shapes are identical across them. That shared shape is what made the
v2→v3→v4 migration a faithful copy rather than a re-derivation.

## The record model

Every measurement is one of **five kinds**, each routed to its own fact table:

| `kind` | Fact table | Dimension tuple (besides `commit_sha`) |
|---|---|---|
| `query_measurement` | `query_measurements` | dataset, dataset_variant, scale_factor, query_idx, storage, engine, format |
| `compression_time` | `compression_times` | dataset, dataset_variant, format, op |
| `compression_size` | `compression_sizes` | dataset, dataset_variant, format |
| `random_access_time` | `random_access_times` | dataset, format |
| `vector_search_run` | `vector_search_runs` | dataset, layout, flavor, threshold |

Plus one **dimension table**, `commits`, keyed by `commit_sha` (40-hex), carrying
the commit timestamp, message, author/committer, tree SHA and URL. The commit row
is upserted (`ON CONFLICT (commit_sha) DO UPDATE`) before any fact rows; every
fact record's `commit_sha` must equal the envelope's `commit.sha` or the whole
batch is rejected.

**One fact table per dimension shape** (rather than one wide table) is deliberate:
the families have genuinely different dimensions, so a single table would bloat
every row with NULLs and split a single chart's data across rows that need
re-joining. See [design-decisions.md](design-decisions.md).

### `measurement_id`: the upsert key, never on the wire

Each fact row's primary key is `measurement_id`, a **deterministic hash over
`commit_sha` + the record's dimension tuple**. Its critical properties:

- It is **computed server-side**, just before INSERT (in the v3 server's
  `db.rs`), and is the key for the `ON CONFLICT (measurement_id) DO UPDATE`
  upsert. Re-emitting the same `(commit, dims)` updates the row instead of
  duplicating it.
- It is **never a wire field.** Emitters do not (and must not) send it. That keeps
  the hash byte-layout a private implementation detail — it can change without
  coordinating a producer release.
- The migrator **copies it verbatim** and never recomputes it (see below), so the
  upsert-not-duplicate invariant is preserved bit-for-bit across DB generations.

### `SCHEMA_VERSION`: the cross-repo lockstep

A single integer gates every ingest. The envelope carries
`run_meta.schema_version`; a mismatch is rejected (409 if the producer is newer
than the reader, 400 if older). It is anchored in several places that **must**
agree, in one logical change:

| Site | File | Repo |
|---|---|---|
| Source of truth | `server/src/schema.rs` (`SCHEMA_VERSION`) | this repo |
| Web read-service mirror | `web/lib/schema-version.ts` | this repo |
| Producer wire shape | `vortex-bench/src/v3.rs` | monorepo |
| CI ingest wrapper | `scripts/post-ingest.py` (hardcoded literal) | monorepo |

The in-repo pair is checked automatically by `web/lib/schema-version.test.ts`,
which reads `server/src/schema.rs` and `CONTRACT.md` and compares both against the
TS constant. The cross-repo sites cannot be verified from here — a bump must be
coordinated or every CI ingest run fails. Full procedure in
[`../../CONTRACT.md`](../../CONTRACT.md).

## Ingest paths

There are two ingest paths, both driven by the monorepo's `post-ingest.py`. They
carry identical record shapes.

### Path A — v3 `POST /api/ingest` (the current hard-required path)

- **Endpoint:** `POST {V3_INGEST_URL}/api/ingest`, bearer-token auth.
- **Body:** one `Envelope` (JSON). Every struct is
  `#[serde(deny_unknown_fields)]`, so unknown fields fail loudly.
- **Atomicity:** all-or-nothing. A single bad record rolls back the whole batch
  (one DuckDB transaction). Write conflicts retry with backoff.
- **Response:** `200 {inserted, updated}` on success; a precise
  400/401/409/500 matrix otherwise (see CONTRACT.md).

### Path B — v4 direct-Postgres dual-write (the forward path, best-effort)

`post-ingest.py --postgres` writes the same records **directly to RDS** as the
least-privilege `bench_ingest` IAM role (`INSERT … ON CONFLICT (measurement_id)
DO UPDATE`), then pings `POST {BENCH_SITE_BASE_URL}/api/revalidate` to flush the
Next.js read cache. Here `measurement_id` is computed locally by the script,
mirroring the server-internal hash — still never a wire field. Every v4 step is
`continue-on-error` and gated on a configured role ARN, so it is additive and
never blocks Path A.

> **Status:** Path B is not yet wired up for the live v4 deployment — the emitter
> still targets v2/v3. Until the emitter cutover, v4's data is refreshed by the
> migrator (below). This is why `BENCH_REVALIDATE_TOKEN` is intentionally not yet
> set on the v4 Vercel project.

## Storage by generation

| Gen | Store | Shape |
|---|---|---|
| v2 | Static `data.json.gz` + `commits.json` + `file-sizes-*.json.gz` in the **public** S3 bucket `vortex-ci-benchmark-results` | Loose JSONL; grouping/classification done at read time |
| v3 | A single **DuckDB** file on the EC2 host's local disk | The structured six-table schema; a precomputed read model materialized in memory |
| v4 | **AWS RDS Postgres** (`vortex_bench`, us-east-1) | The same six-table schema, translated to Postgres DDL with read-path indexes |

## The migrator: `vortex-bench-migrate`

A throwaway Rust binary that bridges the generations. It has two jobs.

### Job 1 — `run`: v2 S3 dump → v3 DuckDB

```
vortex-bench-migrate run --output <snapshot.duckdb> [--source public-s3|local]
```

Streams v2's `data.json.gz` / `commits.json` / `file-sizes-*.json.gz`, and for
every loose v2 record runs a **classifier** (`migrate/src/classifier.rs`) that
reproduces v2's old read-time grouping logic (`getGroup`, `formatQuery`,
`normalizeChartName`) — a bug-for-bug port — to map it to one of the six
structured tables. Records accumulate per table, deduplicate by `measurement_id`,
and flush to DuckDB via Arrow appenders.

The classifier exists **only** for v2 data: v3+ emitters already produce
structured records, so the live read path never classifies. It is a one-time
translation that goes away when v3 is decommissioned. The `run` self-gates: it
fails if more than 5% of records are uncategorized, or if a `file-sizes-*` source
fails to download (override with `--allow-missing-file-sizes` — the `*-s3*`
file-size files are not published, since file size is storage-independent).

### Job 2 — `load` + `verify`: v3 DuckDB → v4 RDS Postgres

```
vortex-bench-migrate load   --duckdb <snap.duckdb> --postgres-target <dsn> [--ca-cert <rds-ca.pem>] [--replace]
vortex-bench-migrate verify --duckdb <snap.duckdb> --postgres-target <dsn> [--ca-cert <rds-ca.pem>]
```

`load` reads each DuckDB table as Arrow batches and `COPY`s them into Postgres in
**one transaction**:

- `measurement_id` is copied **verbatim** — never recomputed — preserving the
  upsert identity exactly.
- By default `load` only appends (the one-shot empty-seed contract); a duplicate
  `measurement_id` aborts.
- `--replace` issues `TRUNCATE` on all six tables as the first statement *inside*
  the load transaction, making the load an atomic full replace — the data-refresh
  path. Because the TRUNCATE shares the transaction, a mid-load failure rolls back
  to the *original* data, never an empty table. `TRUNCATE` requires table
  ownership, so `--replace` **must connect as the RDS master `postgres`**, not the
  `migrator`/`bench_ingest` roles.
- After the COPYs, it backfills the denormalized `query_measurements.commit_timestamp`
  from `commits` (also inside the transaction).
- `--ca-cert` selects a host-verifying TLS connection (rustls trusting the RDS CA
  bundle, `sslmode=require`); omit it for a plaintext local rehearsal.

`verify` then compares source DuckDB and target Postgres **per `measurement_id`**,
asserting presence (no extras, no missing) and value equality on every non-key
column. Because `measurement_id` is a hash that does *not* include the value
columns, row counts alone cannot prove fidelity — this value check is the real
correctness gate. It exits non-zero on any diff.

A second `verify --against <v2-server-url>` mode does a structural diff of the
migrated v3 DuckDB against the live v2 `/api/metadata` (group/chart structure
only) to catch classifier regressions.

### End-to-end refresh

```
v2 S3 dump ──run──▶ v3 DuckDB ──load --replace──▶ v4 RDS ──verify──▶ ✓
                                  (as master postgres,
                                   atomic TRUNCATE+COPY)
```

The migrator is kept (not deleted at cutover) precisely so this refresh can be
re-run: `--replace` is the atomic full-replace path, decoupled from the live
upsert ingest. RDS point-in-time recovery (35-day retention) is the rollback net
for the prod load. The local rehearsal harness (`migrate/tests/postgres_e2e.rs`,
Docker-gated) stands up a throwaway Postgres, runs `load`+`verify`, and asserts a
forced mid-load failure rolls back to empty.
