// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright the Vortex contributors

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
export const SCHEMA_VERSION = 1;
