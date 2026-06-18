<!--
SPDX-License-Identifier: Apache-2.0
SPDX-FileCopyrightText: Copyright the Vortex contributors
-->

# Sub-phase 3.1 (contract-doc) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **Orchestration note:** this plan is a big-plans sub-phase (`ct/decouple-from-monorepo`, Phase 3, sub-phase 3.1). The orchestrator (big-plans) triggers SDD and runs the review cadence. Phase 3 uses BATCHED review — there is NO per-sub-phase gauntlet here; the authoritative adversarial review is one consolidated `phase-3` gauntlet at the Phase-3 boundary. Each task still ends with its own machine-checkable verification + commit.

**Goal:** Document the existing emitter→ingester contract as a versioned `CONTRACT.md` (anchored to `SCHEMA_VERSION = 1`) and fix the stale/dead cross-repo lockstep references Phase 3 owns — pure docs + comment cleanup, zero behavior change.

**Architecture:** A single repo-root `CONTRACT.md` describes both ingest paths (v3 `POST /api/ingest`, v4 direct-Postgres dual-write + `POST /api/revalidate`), pinned to `SCHEMA_VERSION`, enumerating the two in-repo version anchors (testable) and the monorepo producer/consumer (documented, not cross-repo-testable). Three source-comment edits remove a stale lockstep-site reference and two dead relative doc links, each cross-referencing `CONTRACT.md`.

**Tech Stack:** Markdown; Rust rustdoc comments (`server/`, crate `vortex-bench-server`); TypeScript JSDoc (`web/`, Next.js + vitest).

## Global Constraints

- **SPDX header on every new file** — the two lines `SPDX-License-Identifier: Apache-2.0` and `SPDX-FileCopyrightText: Copyright the Vortex contributors`, in a comment syntax valid for the file type (HTML comment for Markdown). ENFORCED BAN.
- **Do NOT bump `SCHEMA_VERSION` or change any wire/record shape.** This sub-phase documents the EXISTING contract at version `1`. No edits to `server/src/records.rs` structs, `server/src/ingest.rs` logic, `server/src/schema.rs` `SCHEMA_VERSION`, or `web/lib/schema-version.ts`'s exported value.
- **Do NOT add NEW monorepo back-references.** `CONTRACT.md` names monorepo files (`scripts/post-ingest.py`, `vortex-bench/src/v3.rs`) as **cross-repo systems in the `vortex-data/vortex` monorepo** — prose/code-span references by name, NOT functional `../` relative-path links. Existing `../` links are the cleanup target, never a precedent. Do not introduce any `../`-escaping path.
- **Do NOT edit v2 production files** (`server.js`, `src/`, `index.html`, `vite.config.js`, `package.json`, `package-lock.json`, `public/`, top-level `Dockerfile`, `docker-compose.yml`).
- **`measurement_id` must never appear as a wire field** in `CONTRACT.md` — it is a server-internal deterministic hash (`server/src/db.rs`); emitters never send it.
- The cross-anchor **consistency CHECK** (asserting `schema.rs` ⇔ `schema-version.ts` agree) is **sub-phase 3.2's** deliverable, NOT this one. 3.1 only documents the anchors and may note that 3.2 strengthens the existing `web/lib/schema-version.test.ts` literal assertion into a true cross-language compare.

**Verified anchor inventory (branch `ct/decouple-from-monorepo`, HEAD `8376223`, 2026-06-18):**
- `server/src/schema.rs:223` → `pub const SCHEMA_VERSION: i32 = 1;` (source of truth).
- `web/lib/schema-version.ts:18` → `export const SCHEMA_VERSION = 1;`.
- `web/lib/schema-version.test.ts` already asserts `SCHEMA_VERSION === 1` (hardcoded literal; 3.2's job to strengthen).
- `migrate/src/lib.rs` exists but has **NO** `SCHEMA_VERSION` const (confirmed). The only in-repo file that stale-names it as a lockstep site is `web/lib/schema-version.ts:13`.

---

### Task 1: Author `CONTRACT.md` at the repo root

**Files:**
- Create: `CONTRACT.md`

**Interfaces:**
- Consumes: nothing (first task).
- Produces: the repo-root `CONTRACT.md` that Tasks 2–4 cross-reference by name, and that satisfies the Phase-3 exit criterion `test -f CONTRACT.md` → 0.

- [ ] **Step 1: Write `CONTRACT.md` with the full content below**

Create `CONTRACT.md` (repo root) with EXACTLY this content:

````markdown
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

These two constants live in THIS repository and MUST agree. The sub-phase 3.2 consistency
check asserts this automatically; `web/lib/schema-version.test.ts` also pins the TS side.

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
| Malformed JSON or unknown field at the envelope level | `400` |
| Unknown `kind`, unknown record field, or per-record validation failure | `400` with the offending record's index |
| Record `commit_sha` ≠ envelope `commit.sha` | `400` with the record index |
| Missing or invalid bearer token | `401` |
| `schema_version` **newer** than the server expects | `409` |
| `schema_version` **older** than the server expects | `400` (malformed-envelope path) |
| Other server error | `500` |

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
````

- [ ] **Step 2: Verify the file exists and carries the SPDX header**

Run:
```bash
test -f CONTRACT.md && head -4 CONTRACT.md | grep -q 'SPDX-License-Identifier: Apache-2.0' && grep -q 'SPDX-FileCopyrightText: Copyright the Vortex contributors' CONTRACT.md && echo OK
```
Expected: `OK`

- [ ] **Step 3: Verify no NEW monorepo back-reference path links were introduced**

Run:
```bash
grep -nE '\]\(\.\./|\]\(\.\./\.\./' CONTRACT.md || echo "NONE"
```
Expected: `NONE` (monorepo files are named in prose/tables, never linked via `../` relative paths).

- [ ] **Step 4: Commit**

```bash
git add CONTRACT.md
git commit -m "docs: add versioned emitter->ingester contract (CONTRACT.md)"
```

---

### Task 2: Fix the stale lockstep list in `web/lib/schema-version.ts`

**Files:**
- Modify: `web/lib/schema-version.ts:4-16` (the JSDoc block only; the `export const SCHEMA_VERSION = 1;` value on line 18 is UNCHANGED)
- Test (existing, must still pass): `web/lib/schema-version.test.ts`

**Interfaces:**
- Consumes: `CONTRACT.md` (Task 1) — referenced by name in the docstring.
- Produces: a corrected docstring with no stale `migrate/src/lib.rs` site and no `benchmarks-website/`-prefixed in-repo path.

The current block (lines 4–17) reads:

```ts
/**
 * The read service's `SCHEMA_VERSION` lockstep site (plan Table D).
 *
 * This constant must stay equal to the other lockstep sites in one PR or CI
 * ingest 400/409s:
 *
 * - `benchmarks-website/server/src/schema.rs` (`pub const SCHEMA_VERSION: i32`).
 * - `vortex-bench/src/v3.rs`.
 * - `scripts/post-ingest.py` (`SCHEMA_VERSION`).
 * - `benchmarks-website/migrate/src/lib.rs` (`pub const SCHEMA_VERSION`).
 *
 * The read service surfaces it on `/health` so an operator can detect envelope
 * or schema skew between the served data and the producers.
 */
```

- [ ] **Step 1: Replace the JSDoc block (lines 4–17) with the corrected version**

```ts
/**
 * The read service's `SCHEMA_VERSION` lockstep site. See `CONTRACT.md` at the
 * repo root for the full emitter→ingester contract.
 *
 * This constant must stay equal to the other anchors in one change or CI ingest
 * 400/409s. The in-repo anchor (checked by the sub-phase 3.2 consistency check
 * and by `schema-version.test.ts`):
 *
 * - `server/src/schema.rs` (`pub const SCHEMA_VERSION: i32`) — source of truth.
 *
 * Cross-repo sites in the `vortex-data/vortex` monorepo (documented in
 * `CONTRACT.md`, not testable from this repo):
 *
 * - `vortex-bench/src/v3.rs` — producer wire-shape source of truth.
 * - `scripts/post-ingest.py` (`SCHEMA_VERSION`) — CI ingest wrapper literal.
 *
 * The read service surfaces it on `/health` so an operator can detect envelope
 * or schema skew between the served data and the producers.
 */
```

(The stale `migrate/src/lib.rs` bullet is removed; the in-repo `schema.rs` path is de-prefixed; monorepo sites are clearly grouped as cross-repo.)

- [ ] **Step 2: Verify the stale reference is gone and the value is untouched**

Run:
```bash
! grep -q 'migrate/src/lib.rs' web/lib/schema-version.ts && grep -q 'export const SCHEMA_VERSION = 1;' web/lib/schema-version.ts && grep -q 'CONTRACT.md' web/lib/schema-version.ts && echo OK
```
Expected: `OK`

- [ ] **Step 3: Run the existing web unit test to confirm no regression**

Run:
```bash
cd web && pnpm vitest run lib/schema-version.test.ts
```
Expected: PASS (the `SCHEMA_VERSION is pinned to 1` test passes; the comment edit does not affect it).

- [ ] **Step 4: Verify prettier/eslint are still clean on the file**

Run:
```bash
cd web && pnpm format:check && pnpm lint
```
Expected: PASS (no formatting/lint errors).

- [ ] **Step 5: Commit**

```bash
git add web/lib/schema-version.ts
git commit -m "docs: correct SCHEMA_VERSION lockstep list in schema-version.ts (drop stale migrate/src/lib.rs; cross-ref CONTRACT.md)"
```

---

### Task 3: Fix the two dead `../../../vortex-bench/...` doc links in `server/`

**Files:**
- Modify: `server/src/records.rs:120-123` (the `QueryMeasurement` doc comment)
- Modify: `server/src/schema.rs:210-218` (the `SCHEMA_VERSION` doc comment)

**Interfaces:**
- Consumes: `CONTRACT.md` (Task 1) — named in the corrected comments.
- Produces: rustdoc comments with no `../`-escaping relative link; meaning preserved as cross-repo prose.

Both sites use a markdown link whose URL is a dead relative path that escapes the crate.

`server/src/records.rs` currently (lines 120–123):

```rust
/// SQL query suite measurement (TPC-H, ClickBench, ...). Lands in
/// `query_measurements`. Field names match the schema columns; per-suite dim
/// values are documented on
/// [`vortex_bench::v3::benchmark_dataset_dims`](../../../vortex-bench/src/v3.rs).
```

`server/src/schema.rs` currently (lines 210–218):

```rust
/// Schema version expected by the server. The ingest envelope's
/// `run_meta.schema_version` must match this exactly at alpha.
///
/// Coupled sites that MUST agree on this value (see
/// `benchmarks-website/AGENTS.md` → "Wire shapes are a coordinated change"):
///
/// - This constant.
/// - The producer-side wire-shape source of truth in
///   [`vortex_bench::v3`](../../../vortex-bench/src/v3.rs).
```

- [ ] **Step 1: Fix the `records.rs` doc comment (lines 120–123)**

Replace with (drop the dead link; name the monorepo file as prose; cross-ref `CONTRACT.md`):

```rust
/// SQL query suite measurement (TPC-H, ClickBench, ...). Lands in
/// `query_measurements`. Field names match the schema columns; per-suite dim
/// values are produced by `vortex_bench::v3::benchmark_dataset_dims` in the
/// `vortex-data/vortex` monorepo (`vortex-bench/src/v3.rs`). See `CONTRACT.md`
/// at the repo root for the full emitter→ingester contract.
```

- [ ] **Step 2: Fix the `schema.rs` doc comment (lines 210–223)**

Replace lines 210–222 (the doc block above `pub const SCHEMA_VERSION: i32 = 1;`) with (de-prefix the in-repo `AGENTS.md` ref; drop the dead link; cross-ref `CONTRACT.md`):

```rust
/// Schema version expected by the server. The ingest envelope's
/// `run_meta.schema_version` must match this exactly at alpha. See
/// `CONTRACT.md` at the repo root for the full versioned contract.
///
/// Coupled sites that MUST agree on this value (see `AGENTS.md` →
/// "Wire shapes are a coordinated change"):
///
/// - This constant (the in-repo source of truth).
/// - The web mirror `web/lib/schema-version.ts`.
/// - The producer-side wire-shape source of truth `vortex_bench::v3` in the
///   `vortex-data/vortex` monorepo (`vortex-bench/src/v3.rs`).
/// - The CI ingest wrapper `scripts/post-ingest.py` (monorepo), which fills the
///   envelope's `run_meta.schema_version` from a hardcoded Python constant.
///   Bumping `SCHEMA_VERSION` without bumping `post-ingest.py` makes every
///   CI run 400 at ingest until the script is updated.
pub const SCHEMA_VERSION: i32 = 1;
```

(Leave `pub const SCHEMA_VERSION: i32 = 1;` itself byte-identical.)

- [ ] **Step 3: Verify no dead relative doc links remain and the const is unchanged**

Run:
```bash
! grep -rnE '\(\.\./\.\./\.\./vortex-bench' server/src/ && grep -q 'pub const SCHEMA_VERSION: i32 = 1;' server/src/schema.rs && echo OK
```
Expected: `OK`

- [ ] **Step 4: Verify rustdoc + build + clippy are clean**

Run:
```bash
cargo doc --no-deps -p vortex-bench-server && cargo build --workspace --locked && cargo clippy --all-targets -- -D warnings
```
Expected: all succeed (no broken-doc warnings, no build/clippy errors).

- [ ] **Step 5: Commit**

```bash
git add server/src/records.rs server/src/schema.rs
git commit -m "docs: drop dead ../vortex-bench doc links; cross-ref CONTRACT.md (records.rs, schema.rs)"
```

---

### Task 4: Add a `CONTRACT.md` cross-reference to `AGENTS.md`

**Files:**
- Modify: `AGENTS.md:25-35` (the "Wire shapes are a coordinated change" bullet under `## v3 specifics`)

**Interfaces:**
- Consumes: `CONTRACT.md` (Task 1).
- Produces: a one-line pointer from `AGENTS.md` to `CONTRACT.md` plus a mention of the in-repo `web/lib/schema-version.ts` anchor.

Judgment call (documented per the seed): `AGENTS.md` already correctly names the two
SCHEMA_VERSION sites (`server/src/schema.rs` + `scripts/post-ingest.py`) and does NOT name
`migrate/src/lib.rs`, so there is no stale lockstep ref to remove here. The existing `../`
markdown links describe the monorepo producer/consumer (legitimate cross-repo prose) — do
NOT rewrite every one. Make a MINIMAL addition only: a `CONTRACT.md` cross-ref and a mention
of the in-repo web anchor.

The current bullet (lines 25–35) reads:

```markdown
- **Wire shapes are a coordinated change.** [`server/src/records.rs`](server/src/records.rs),
  [`vortex-bench/src/v3.rs`](../vortex-bench/src/v3.rs), and (until cutover)
  [`migrate/src/classifier.rs`](migrate/src/classifier.rs) must agree.
  Bumping a shape means changing all three plus the snapshot fixtures in
  one commit. `SCHEMA_VERSION` is the version literal coupled across two
  named sites: [`server/src/schema.rs`](server/src/schema.rs) (source of
  truth) and [`scripts/post-ingest.py`](../scripts/post-ingest.py) (the
  CI ingest wrapper, which hardcodes it as a Python literal). Bump in
  lockstep or every CI ingest run 400s. The server-side validation in
  `records.rs` + `ingest.rs` and the echo in `/health` all consume the
  constant through `crate::schema`.
```

- [ ] **Step 1: Append the cross-ref + web-anchor mention to the bullet**

Edit the bullet so the `SCHEMA_VERSION` sentence reads (add the in-repo web mirror to the
coupled sites and append the `CONTRACT.md` pointer; keep everything else byte-identical):

```markdown
  one commit. `SCHEMA_VERSION` is the version literal coupled across
  [`server/src/schema.rs`](server/src/schema.rs) (in-repo source of
  truth), [`web/lib/schema-version.ts`](web/lib/schema-version.ts) (the
  in-repo web mirror), and [`scripts/post-ingest.py`](../scripts/post-ingest.py)
  (the monorepo CI ingest wrapper, which hardcodes it as a Python literal).
  Bump in lockstep or every CI ingest run 400s. The server-side validation in
  `records.rs` + `ingest.rs` and the echo in `/health` all consume the
  constant through `crate::schema`. The full versioned contract lives in
  [`CONTRACT.md`](CONTRACT.md).
```

- [ ] **Step 2: Verify the cross-ref and web-anchor mention landed**

Run:
```bash
grep -q 'CONTRACT.md' AGENTS.md && grep -q 'web/lib/schema-version.ts' AGENTS.md && echo OK
```
Expected: `OK`

- [ ] **Step 3: Commit**

```bash
git add AGENTS.md
git commit -m "docs: cross-ref CONTRACT.md and the in-repo web SCHEMA_VERSION anchor from AGENTS.md"
```

---

## Self-Review

**Spec coverage:**
- CONTRACT.md (both paths, version anchors, SPDX, no `measurement_id` on wire, bump procedure) → Task 1. ✓
- Stale `migrate/src/lib.rs` lockstep ref (only in `schema-version.ts:13`) removed → Task 2. ✓
- Dead `../../../vortex-bench/src/v3.rs` doc links (`records.rs:123`, `schema.rs:218`) → Task 3. ✓
- AGENTS.md cross-ref + in-repo web anchor mention (minimal, judgment-call) → Task 4. ✓
- 3.2 (consistency CHECK) explicitly OUT of scope, noted in Global Constraints + Task 2. ✓

**Placeholder scan:** none — every doc/comment step shows the literal content; every verification step shows the exact command + expected output.

**Type consistency:** no code types introduced (docs-only). `SCHEMA_VERSION` value (`1`) referenced identically across CONTRACT.md, schema-version.ts, schema.rs; no struct/signature edits.

**Ordering:** Task 1 (CONTRACT.md) precedes Tasks 2–4, which reference it by name.
