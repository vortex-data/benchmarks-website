<!--
SPDX-License-Identifier: Apache-2.0
SPDX-FileCopyrightText: Copyright the Vortex contributors
-->

# Benchmark emitter → ingester contract

This document is the versioned contract between the benchmark **emitters** (which run in
the `vortex-data/vortex` monorepo) and the **ingesters** in this repository. It is
anchored to `SCHEMA_VERSION` (currently **`1`**). The emitters are owned by the monorepo
and are unchanged by this repository; this repo owns the ingest *contract* and the read
service.

> **Scope.** There are two ingest paths, both driven by the monorepo's
> `scripts/post-ingest.py`. The **v3** path (`POST /api/ingest` into the Rust read
> service) is the current, hard-required path. The **v4** path (a direct Postgres
> dual-write plus a cache-revalidation ping) is the forward path and is best-effort. Both
> are documented here; the wire/record shapes are identical across them because both
> originate from the same emitter output.

## Versioning: `SCHEMA_VERSION`

`SCHEMA_VERSION` is a single integer that gates every ingest. The ingest envelope carries
`run_meta.schema_version`; the read service rejects any mismatch (see the HTTP matrix
below). Bumping it is a coordinated, multi-site change.

### In-repo anchors (testable here)

These two constants live in THIS repository and MUST agree. The consistency check in
`web/lib/schema-version.test.ts` asserts this automatically — it reads `server/src/schema.rs`
and this doc and compares both against the TS const.

| Anchor | File | Form |
|---|---|---|
| Source of truth | `server/src/schema.rs` | `pub const SCHEMA_VERSION: i32 = 1;` |
| Read-service (web) mirror | `web/lib/schema-version.ts` | `export const SCHEMA_VERSION = 1;` |

### Cross-repo sites (documented, NOT testable from this repo)

These live in the `vortex-data/vortex` monorepo and cannot be verified by this repo's CI.
A `SCHEMA_VERSION` bump must be coordinated with them in the same logical change, or every
CI ingest run will fail (see the HTTP matrix):

| Site | Role |
|---|---|
| `vortex-bench/src/v3.rs` (the `--gh-json-v3` emitter) | Producer-side wire-shape source of truth |
| `scripts/post-ingest.py` | CI ingest wrapper; fills `run_meta.schema_version` from a hardcoded Python literal that must equal the value above |

> Note: `migrate/src/lib.rs` is **not** a `SCHEMA_VERSION` anchor — it has no such const.
> Older comments that listed it as a lockstep site were stale and have been corrected.

## Path A — v3 `POST /api/ingest` (current, hard-required)

The monorepo emitter `vortex-bench --gh-json-v3 <path>` writes **JSONL of bare records
only**. The monorepo's `scripts/post-ingest.py --server $V3_INGEST_URL` wraps that output
in an envelope (adding `run_meta` + `commit`, filled from `${{ github.sha }}` and
`git show`) and POSTs it.

- **Endpoint:** `POST {V3_INGEST_URL}/api/ingest`
- **Auth:** `Authorization: Bearer $INGEST_BEARER_TOKEN`
- **Body:** one `Envelope` per request (JSON). Defined in `server/src/records.rs`; every
  struct is `#[serde(deny_unknown_fields)]`, so unknown fields fail loudly.

### Envelope shape

```jsonc
{
  "run_meta": {
    "benchmark_id": "bench.yml@<run_id>",   // free-form producing-run id
    "schema_version": 1,                     // MUST equal the server's SCHEMA_VERSION
    "started_at": "2026-06-18T12:00:00Z"     // RFC 3339 timestamp
  },
  "commit": {
    "sha": "<40-hex lowercase>",             // wire name `sha`; stored as commit_sha
    "timestamp": "2026-06-18T11:59:00Z",     // RFC 3339 / ISO 8601
    "message": "<full commit message>",      // server renders only the first line
    "author_name": "...",
    "author_email": "...",
    "committer_name": "...",
    "committer_email": "...",
    "tree_sha": "<git tree sha>",
    "url": "<github commit url>"             // click-through fallback
  },
  "records": [ /* heterogeneous batch, discriminated by `kind` (see below) */ ]
}
```

The server upserts the `commit` row (`ON CONFLICT (commit_sha) DO UPDATE`) before applying
any record. Every record's `commit_sha` MUST equal the envelope's `commit.sha`, or the
batch is rejected.

### Records: discriminated by `kind`

`records` is a heterogeneous array; serde discriminates with
`#[serde(tag = "kind", rename_all = "snake_case")]`. The five kinds and their destination
fact tables:

| `kind`               | Destination table     |
|----------------------|-----------------------|
| `query_measurement`  | `query_measurements`  |
| `compression_time`   | `compression_times`   |
| `compression_size`   | `compression_sizes`   |
| `random_access_time` | `random_access_times` |
| `vector_search_run`  | `vector_search_runs`  |

Each record's fields are defined in `server/src/records.rs` and match the column names of
its fact table (see `server/src/schema.rs` for the DDL). Records are
`#[serde(deny_unknown_fields)]`; an unknown `kind` or unknown field is a `400`.

> **`measurement_id` is never on the wire.** It is a server-internal deterministic hash
> over `commit_sha` + the record's dimension tuple, computed in `server/src/db.rs` just
> before INSERT and used as the primary key for the `ON CONFLICT … DO UPDATE` upsert.
> Emitters do not (and must not) send it; the migrator copies it verbatim and never
> recomputes it.

### HTTP response matrix (`server/src/ingest.rs`)

| Condition | Status |
|---|---|
| Happy path | `200` with `{ "inserted": N, "updated": M }` |
| Malformed JSON, an unknown field (envelope **or** record level), or an unknown record `kind` | `400`, body `{ "error": "malformed", … }` — **no** `record_index` (these fail during envelope deserialization, before the per-record loop runs) |
| A per-record validation failure (e.g. invalid `storage`, partially-populated memory fields), or a record whose `commit_sha` ≠ the envelope's `commit.sha` | `400`, body `{ "error": "record", "record_index": N, … }` |
| Missing or invalid bearer token | `401`, body `{ "error": "unauthorized" }` |
| `schema_version` **newer** than the server expects | `409`, body `{ "error": "schema_version_too_new", … }` |
| `schema_version` **older** than the server expects | `400` (the malformed path — `{ "error": "malformed", … }`, no `record_index`) |
| Other server error | `500`, body `{ "error": "internal" }` |

Ingest is **all-or-nothing**: a single failed record rolls back the whole batch
(one DuckDB transaction). `inserted`/`updated` aggregate across all five fact tables;
`updated` counts rows that hit `ON CONFLICT (measurement_id) DO UPDATE`.

## Path B — v4 direct-Postgres dual-write (forward, best-effort)

The monorepo's `scripts/post-ingest.py --postgres` writes the same records directly to the
hosted RDS Postgres, then optionally pings this repo's Next.js read service to flush its
cache. Every v4 step is `continue-on-error: true` and gated on
`vars.GH_BENCH_INGEST_ROLE_ARN != ''`, so it is additive and never blocks the v3 path.

1. **Direct write:** `INSERT … ON CONFLICT (measurement_id) DO UPDATE` into RDS as the
   least-privilege `bench_ingest` IAM role (IAM auth, `sslmode=verify-full`), against the
   schema in this repo's `migrations/`. `measurement_id` is computed locally by the script,
   mirroring the server-internal hash — still never a wire field on Path A.
2. **Revalidate ping:** `POST {BENCH_SITE_BASE_URL}/api/revalidate` with
   `Authorization: Bearer $BENCH_REVALIDATE_TOKEN`, to flush the Next.js Data Cache so the
   next read recomputes against freshly written data.

### `POST /api/revalidate` (`web/app/api/revalidate/route.ts`)

- **Auth:** bearer token compared in constant time against `BENCH_REVALIDATE_TOKEN`.
- **Responses:**
  - `503 { "error": "not_configured" }` if `BENCH_REVALIDATE_TOKEN` is unset/empty
    (fails closed — an unconfigured deployment never silently accepts unauthenticated
    revalidation).
  - `401 { "error": "unauthorized" }` on a missing/incorrect token.
  - `200 { "revalidated": true }` on success — flushes the `BENCH_DATA_TAG` Data Cache
    entries. The response is never CDN-cached.

## Bumping `SCHEMA_VERSION` (procedure)

A version bump or wire-shape change is a coordinated change across BOTH repos in one
logical change:

1. **This repo:** `server/src/schema.rs` (`SCHEMA_VERSION`) and `web/lib/schema-version.ts`.
2. **Monorepo:** `vortex-bench/src/v3.rs` (the producer wire shape) and
   `scripts/post-ingest.py` (the hardcoded literal).

A mismatch makes the v3 ingest return `409` (server older than producer) or `400` (server
newer than producer) on every CI run until the lagging site catches up. For wire/record
*shape* changes, also update the snapshot fixtures in the same commit.
