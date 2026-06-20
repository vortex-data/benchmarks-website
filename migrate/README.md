<!-- SPDX-License-Identifier: Apache-2.0 -->
<!-- SPDX-FileCopyrightText: Copyright the Vortex contributors -->

# vortex-bench-migrate

A throwaway migrator for the benchmarks-website data substrate. It has two jobs:

1. **v2 -> v3** (`run`): read v2's S3 dump (`data.json.gz` / `commits.json` /
   `file-sizes-*.json.gz`) and write a fully populated v3 DuckDB. Goes away once
   v3 is decommissioned.
2. **v3 -> v4** (`load` + `verify --postgres-target`): bulk-load an existing v3
   DuckDB snapshot into the v4 Postgres (RDS) target in one atomic transaction,
   then value-verify the load per `measurement_id`. This is the historical-data
   seed for the v4 cutover.

```
vortex-bench-migrate load   --duckdb <snapshot.duckdb> --postgres-target <dsn> [--ca-cert <rds-ca.pem>] [--replace]
vortex-bench-migrate verify --duckdb <snapshot.duckdb> --postgres-target <dsn> [--ca-cert <rds-ca.pem>]
```

`--ca-cert` selects a host-verifying TLS connection (the RDS CA bundle; the DSN
should request `sslmode=require`). Omit it for a plaintext local connection (the
rehearsal). The loader copies `measurement_id` verbatim from DuckDB -- it never
recomputes the hash -- so the upsert-not-duplicate invariant the v4 ingest path
depends on is preserved exactly.

By default `load` only `COPY`s into the existing tables (the one-shot empty-seed
contract): re-loading into an already-populated target aborts on the first
duplicate `measurement_id`. Pass `--replace` to `TRUNCATE` all six tables as the
first statement *inside* the load transaction, making the load an atomic full
replace -- the data-refresh / re-migration path. Because the TRUNCATE shares the
load transaction, a mid-load failure rolls back to the ORIGINAL data rather than
leaving the target empty. `TRUNCATE` requires table ownership, so `--replace`
must connect as the table owner (the RDS master `postgres`), not `migrator` or
`bench_ingest` (whose grants exclude TRUNCATE).

## Local rehearsal (the automated harness)

`tests/postgres_e2e.rs` is the rehearsal harness: it builds a representative v3
DuckDB fixture, stands up a `postgres:16-alpine` testcontainer (schema applied
from `migrations/001_initial_schema.sql` via the container init entrypoint),
runs the loader, asserts `verify --postgres-target` is clean and the per-table
row counts match the source, and asserts that a forced mid-load failure rolls the
target back to empty (the single-transaction atomicity guarantee). It is the
runtime coverage for the loader's Postgres-execution path and the verifier's
Postgres-read path.

```bash
# Requires Docker. Skips locally when Docker is down; FAILS LOUD in CI (`CI` set).
cargo nextest run -p vortex-bench-migrate --test postgres_e2e
# or: cargo test -p vortex-bench-migrate --test postgres_e2e
```

## REAL-snapshot rehearsal (operator runbook)

Run this against an acquired production-shaped DuckDB snapshot. This is the
PR-3.4 LOCAL rehearsal (and the dress rehearsal for the one-shot prod load,
PR-5.0, at cutover). It is the same `load` + `verify` flow as the automated
harness, but against the real history instead of a fixture.

### 1. Verify the source account + region LIVE (do not trust the audit)

The v3 DuckDB is believed to live in account `375504701696` / `us-east-2`, but
that pair appears ONLY in the migration plan -- it is pinned NOWHERE in the repo
(`provision.sh`, `ops/`, and the workflows all confirm the RDS target is
`245040174862` / `us-east-1`, but never the v3 source). Confirm the source before
acquiring anything:

```bash
aws sts get-caller-identity                       # confirm you are in the v3-source account
aws s3api get-bucket-location --bucket <v3-backup-bucket>   # confirm the bucket's region
```

If either disagrees with `375504701696` / `us-east-2`, STOP and reconcile before
proceeding -- a wrong-account/region snapshot would seed the prod DB from the
wrong history.

### 2. Acquire the snapshot

The v3 system stores its DuckDB on a different account's S3/EC2 with no
cross-account bridge, so acquisition runs locally with the v3-account credentials.
Two options:

- **Rehydrate the S3 Vortex backup** (per-table Vortex files): `duckdb` with
  `INSTALL vortex; LOAD vortex;` reading the backed-up per-table files into a
  fresh `.duckdb`. Note the S3 backup has a **7-day lifecycle** -- acquire from a
  recent backup.
- **scp the live file**: copy `/var/lib/vortex-bench/bench.duckdb` off the live v3
  EC2 host directly.
- **Use a pre-acquired on-disk snapshot**: if a recent real v3 `.duckdb` is
  already on the operator's machine, it is an acceptable rehearsal source (the
  PR-3.4 LOCAL rehearsal used one). For the LOCAL rehearsal, snapshot freshness
  does not matter -- it validates the load/verify code against the real data
  shape; the freshest snapshot only matters for the PR-5.0 prod load at cutover.

### 3. Rehearse load + verify against a local Postgres:16

Stand up a throwaway local PG16 (mirrors the testcontainer the harness uses), apply
the schema, then run the same `load` + `verify` the prod load (PR-5.0) will run.
Run these from `benchmarks-website/migrate/` (the `../../migrations` path is
relative to that directory):

```bash
docker run -d --name bench-rehearsal -e POSTGRES_PASSWORD=postgres \
  -p 5432:5432 postgres:16-alpine
# WAIT for the server to accept connections (a fresh container takes a few
# seconds to initialise) before applying the schema:
until docker exec bench-rehearsal pg_isready -U postgres >/dev/null 2>&1; do sleep 1; done
# apply the authoritative schema
psql "postgresql://postgres:postgres@localhost:5432/postgres" \
  -f ../../migrations/001_initial_schema.sql

DSN="postgresql://postgres:postgres@localhost:5432/postgres"
# `vbm` is the built binary: `cargo build -p vortex-bench-migrate` then use
# `target/debug/vortex-bench-migrate`, or substitute `cargo run -p vortex-bench-migrate --`.
vbm load   --duckdb <acquired-snapshot.duckdb> --postgres-target "$DSN"
vbm verify --duckdb <acquired-snapshot.duckdb> --postgres-target "$DSN"
# verify exits 0 on a clean load; non-zero on any presence diff or value mismatch.

docker rm -f bench-rehearsal
```

A clean rehearsal against the real snapshot (PR-3.4) is the green light for the
one-shot prod load (PR-5.0, at the Phase-5 cutover: operator runs the same two
commands against the prod RDS DSN over `--ca-cert` verify-full TLS, with RDS PITR
as the rollback path).

## One-command backfill (`backfill-v4-prod.sh`)

[`backfill-v4-prod.sh`](backfill-v4-prod.sh) automates the whole "REAL-snapshot
rehearsal" plus the prod load as a single re-runnable operator script. It resolves
the repo root itself, so run it from anywhere in a checkout -- but only in a quiet
window with NO `develop` merges in flight, since the prod load `TRUNCATE`s and
reloads all six tables in one transaction and a concurrent CI dual-write would race
the `TRUNCATE`.

```bash
./migrate/backfill-v4-prod.sh          # guided run; pauses for a typed REPLACE confirm
./migrate/backfill-v4-prod.sh --yes    # unattended (skip the confirm)
./migrate/backfill-v4-prod.sh --help   # also: --reuse-snapshot, --skip-build, --skip-rehearsal
```

Each run, in order:

1. acquires a FRESH v3 DuckDB from the v2 public bucket (`run --source public-s3
   --allow-missing-file-sizes`);
2. proves the exact prod operation against a throwaway local Postgres:16 -- the
   self-gate: it applies the schema the loader actually needs and runs `load
   --replace` + `verify`, aborting before prod on any failure; then
3. after an interactive `REPLACE` confirm (`--yes` / `FORCE=1` to skip), runs the
   atomic `load --replace` + `verify` against the prod RDS as the master `postgres`
   over `--ca-cert` verify-full TLS, reading the master password from Secrets
   Manager (never printed), and reports the before/after `/api/health` row counts.

If a CI dual-write lands during the run, `verify` reports keys present in v4 but not
the snapshot. The script treats a diff that is *exclusively* extra target rows (zero
"Keys only in DuckDB source", zero "Value mismatches") as success -- the historical
mirror is intact and v4 merely has newer data -- while any missing row or value
mismatch stays a hard failure. The cleanest run still has no in-flight benchmark
jobs, not just no new merges (an in-flight job keeps dual-writing for minutes).

Two facts the script encodes that the manual steps above predate:

- The loader's post-COPY denormalization writes `query_measurements.commit_timestamp`,
  the column added by `006_read_path_perf.sql`, so the rehearsal schema is `001` +
  `006` + `007`, not `001` alone (the `tests/postgres_e2e.rs` harness applies the
  same three; the `002`-`005` role/grant migrations are RDS-IAM-only and skipped).
- The three `-s3` file-sizes keys (`tpch-s3`, `tpch-s3-10`, `fineweb-s3`) return
  `403` on the public bucket, so `--allow-missing-file-sizes` is required. They
  dedupe against their `-nvme` twins by `measurement_id`, so the load stays
  parity-preserving. The hard rollback remains RDS PITR.
