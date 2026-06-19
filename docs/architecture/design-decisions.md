<!--
SPDX-License-Identifier: Apache-2.0
SPDX-FileCopyrightText: Copyright the Vortex contributors
-->

# Design decisions

A consolidated, ADR-style log of the load-bearing choices in this system and the
reasoning behind them. Each entry is "decision → why → where." Topic docs
([data-pipeline](data-pipeline.md), [read-path](read-path.md),
[deploy-and-infra](deploy-and-infra.md)) carry the fuller context.

## Data model

**One fact table per measurement family (not one wide table).**
The five families have genuinely different dimensions. A single wide table would
bloat every row with NULL columns it doesn't use, or split one chart's data across
multiple rows that then need re-joining. Five focused tables keep each row dense
and each chart query a single-table scan.
→ `migrations/001_initial_schema.sql`, `server/src/schema.rs`.

**`measurement_id` is a server-internal deterministic hash, never on the wire.**
Hashing `commit_sha` + the dimension tuple makes the upsert automatic: re-emitting
the same measurement hits `ON CONFLICT (measurement_id) DO UPDATE` instead of
duplicating. Keeping it off the wire means the hash layout is private — it can
change without a coordinated producer release. Emitters never send it; the server
computes it just before INSERT.
→ `server/src/db.rs`, `CONTRACT.md`.

**The migrator copies `measurement_id` verbatim — never recomputes it.**
The whole point of the v2→v3→v4 migration is fidelity. If the migrator
re-derived the hash, any divergence from the server's logic would silently create
duplicate or colliding keys. Treating it as opaque bytes to transport preserves
the upsert identity bit-for-bit across generations.
→ `migrate/src/postgres.rs`.

**`SCHEMA_VERSION` is a single integer in cross-repo lockstep.**
A wire-shape mismatch between producer and reader is a hard, loud failure (409/400
on every ingest) rather than silent data corruption. The in-repo anchors are
asserted by a test; the cross-repo anchors are documented and must be bumped in
the same logical change.
→ `CONTRACT.md`, `web/lib/schema-version.test.ts`.

## Ingest

**All-or-nothing ingest.**
A partially-applied envelope is an inconsistent state. One transaction per
envelope (with conflict-retry) trades a little ingest latency for a guarantee that
a batch either lands completely or not at all — acceptable for a ~tens-of-runs-a-
day workload.
→ `server/src/ingest.rs`.

**Two ingest paths, with the v4 path additive and best-effort.**
The v3 `POST /api/ingest` is the hard-required path; the v4 direct-Postgres
dual-write + revalidate ping is gated and `continue-on-error`, so bringing v4
online never risks the established v3 ingest. The cutover flips which is
authoritative without a flag day.
→ `CONTRACT.md`.

## Migration

**The v2 classifier lives only in the migrator, and only for v2.**
v2 emitted loose name strings that needed read-time classification; v3+ emit
structured records directly. Confining the bug-for-bug port of v2's grouping logic
to a one-shot migration tool keeps the live read path clean and forward-focused,
and the cost is paid once over history rather than on every page load.
→ `migrate/src/classifier.rs`.

**`--replace` is an atomic TRUNCATE+COPY that requires master ownership.**
Re-migrating must not leave the database empty if it fails midway. Putting the
`TRUNCATE` inside the load transaction means a mid-load failure rolls back to the
original data. `TRUNCATE` needs table ownership, so this path deliberately
connects as the RDS master — not the least-privilege ingest role.
→ `migrate/src/postgres.rs`, `migrate/README.md`.

**Value-verify per `measurement_id`, not just row counts.**
Since `measurement_id` is a hash over keys only (not values), equal row counts and
equal key sets don't prove the value columns copied correctly. The verifier
compares every non-key column per row — the real correctness gate for a prod load.
→ `migrate/src/verify.rs`.

## Read path

**SSR + a thin hydration script — no WASM, no SPA framework (v3).**
LTTB downsampling and pan/zoom are fast enough in plain JavaScript; most of the
cost is layout, not an inner loop. Avoiding WASM/SPA keeps the bundle small, the
first paint fast, and iteration simple.
→ `server/static/chart-init.js`, `AGENTS.md`.

**Precompute the hot path (v3); cache the hot path (v4).**
The landing page is heavy. v3 materialized the latest-100 view into precomputed,
pre-compressed byte artifacts at ingest time (zero SQL per load). v4 keeps the
same "default window is special" instinct but expresses it as a cache layer (the
`bench-data`-tagged Data Cache) over live Postgres, so there's no in-memory read
model to operate.
→ `server/ARCHITECTURE.md`, `web/lib/data-cache.ts`.

**`force-dynamic` pages over prerendering (v4).**
Rendering at request time keeps `next build` independent of a live database (CI
needs no DB secrets) and removes any prerender-staleness budget. Freshness is the
cache layers' job, not the build's.
→ `web/app/page.tsx`, `web/app/chart/[slug]/page.tsx`.

**Two cache layers, flushed by an ingest hook with a 24h backstop.**
The CDN (5-min `s-maxage`) absorbs repeat traffic; the Data Cache (24h backstop)
keeps the default window warm on a low-traffic site. `POST /api/revalidate` flushes
the Data Cache tag on ingest so fresh data shows immediately; the backstop is only
the cap if that hook fails. The endpoint **fails closed** (503 when unconfigured)
so an unconfigured deployment never accepts an unauthenticated flush.
→ `web/lib/cache.ts`, `web/lib/data-cache.ts`, `web/app/api/revalidate/route.ts`.

**Only the default window is cached; `?n=` is clamped to 1000.**
Caching every window would explode the key space, so only the default last-100 is
memoized and other windows ride the per-URL CDN cache. The numeric clamp is a DoS
floor against `?n=99999999`; `?n=all` is the explicit, uncapped escape hatch.
Visual thinning happens client-side via LTTB, so the server never needs a huge
window for a readable chart.
→ `web/lib/window.ts`, `web/lib/data-cache.ts`, `AGENTS.md`.

**Opaque, Rust-compatible slugs.**
Slugs are `<prefix>.<base64url-json>`, encoded identically in Rust and TypeScript
so the same slug works against v3 and v4. The client only echoes server-issued
slugs, and decoding validates the full shape, so they are not an injection
surface.
→ `web/lib/slug.ts`.

## Infrastructure & deploy

**OIDC, not long-lived AWS keys.**
CI exchanges a short-lived, repo+branch-scoped GitHub OIDC token for AWS
credentials. No AWS secret is ever stored in GitHub.
→ `infra/provision.sh`, `.github/workflows/schema-deploy.yml`.

**Least-privilege, separated DB roles.**
`migrator` (DDL, no data writes), `bench_ingest` (data writes, no DDL),
`bench_read` (SELECT only). The blast radius of any leaked credential is bounded
to what that role can do.
→ `migrations/00{2,4,5}_*.sql`.

**Master-applied bootstrap, scripted steady state.**
The role-management and ownership DDL (the `requires-superuser` migrations) is
applied once by the RDS master; afterwards CI runs as the unprivileged `migrator`
against an already-applied ledger. CI never holds master-capable privileges.
→ `scripts/migrate-schema.py`, `infra/README.md`.

**An independently-owned Vercel project, built on the runner.**
This repo's Vercel project is keyed by its own org/project IDs with git
integration off, and the build runs on the GitHub runner via `vercel build` +
`vercel deploy --prebuilt`. Both choices stop this repo's deploys from racing the
monorepo's deploys to its project, and give this repo full control of the build
environment.
→ `.github/workflows/web-deploy.yml`.

**`develop` is production; per-PR CI is the gate.**
No staging environment. A merge to `develop` ships straight to the v4 production
domain; the testcontainer migration test and the rest of CI are what gate the
merge.
→ `.github/workflows/web-deploy.yml`.

**Open security group, IAM/password as the gate.**
RDS is publicly reachable on 5432; the access control is the IAM token signature
(CI) or the `bench_read` password (Vercel), not a network ACL — which keeps
serverless callers with dynamic egress IPs working without an allow-list.
→ `infra/provision.sh`.

**Polling deploy for the v3 host.**
The EC2 host pulls (timer → fetch → build → atomic symlink swap → health-check →
rollback-on-failure) rather than receiving pushes, so it has no inbound deploy
surface and a bad build never stays live.
→ `ops/deploy.sh`.
