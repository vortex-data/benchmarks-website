<!--
SPDX-License-Identifier: Apache-2.0
SPDX-FileCopyrightText: Copyright the Vortex contributors
-->

# Sub-phase 3.2 (version-check) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **Orchestration note:** big-plans sub-phase (`ct/decouple-from-monorepo`, Phase 3, sub-phase 3.2 — the LAST sub-phase of Phase 3). Phase 3 uses BATCHED review: NO per-sub-phase gauntlet here; the authoritative review is one consolidated `phase-3` gauntlet at the Phase-3 boundary. The task still ends with its own machine-checkable verification + commit. big-plans (not this plan) triggers SDD and the phase boundary.

**Goal:** Turn the existing `web/lib/schema-version.test.ts` from a hardcoded `expect(SCHEMA_VERSION).toBe(1)` literal into a real cross-anchor consistency check that reads `server/src/schema.rs` and `CONTRACT.md` from disk and asserts all three in-repo `SCHEMA_VERSION` anchors agree — fulfilling the Phase-3 exit-criterion "the schema-version consistency check → 0".

**Architecture:** A single vitest test file reads its sibling source files at test time (Node `fs` + `fileURLToPath`, the pattern already used by `web/lib/test-harness.ts`), extracts each anchor's integer version via an anchored regex, and asserts equality with the imported TS `SCHEMA_VERSION` const. It auto-runs in `web-ci` (which already runs `pnpm test`), so drift is caught on every push with zero new CI wiring.

**Tech Stack:** TypeScript, vitest 4 (env `node`), Node `fs`/`url`; pnpm 11.5.2.

## Global Constraints

- **Do NOT bump `SCHEMA_VERSION`** (stays `1`) or change any wire/record shape. This sub-phase ADDS a check; it does not change any anchor.
- **The check is READ-ONLY on its anchors.** Do NOT edit `server/src/schema.rs`, `web/lib/schema-version.ts`, or `CONTRACT.md` — the test reads them. (A temporary edit to PROVE the test has teeth is allowed during verification but MUST be reverted before commit; see the negative-check step.)
- **SPDX header preserved** — `web/lib/schema-version.test.ts` already carries the two-line `// SPDX-License-Identifier: Apache-2.0` / `// SPDX-FileCopyrightText: Copyright the Vortex contributors` header; keep it.
- **No NEW monorepo back-references.** The reads `../../server/src/schema.rs` and `../../CONTRACT.md` resolve from `web/lib/` to THIS repo's root — they are in-repo, NOT monorepo back-references. Do not add any path that escapes the repo root.
- **Real behavior, not mocks.** The test must actually read the files; a tautological test that cannot fail on drift is a defect.

**Verified anchors (branch `ct/decouple-from-monorepo`, current HEAD):**
- `server/src/schema.rs:225` → `pub const SCHEMA_VERSION: i32 = 1;`
- `web/lib/schema-version.ts:23` → `export const SCHEMA_VERSION = 1;` (imported by the test).
- `CONTRACT.md:34` → embeds `` `pub const SCHEMA_VERSION: i32 = 1;` `` (anchors table, exactly once).
- `CONTRACT.md:35` → embeds `` `export const SCHEMA_VERSION = 1;` `` (anchors table, exactly once).
- `web/lib/test-harness.ts:35` → the sibling-read pattern to mirror: `fileURLToPath(new URL('../../migrations', import.meta.url))`.
- `web/vitest.config.ts` → `environment: 'node'`, `include: ['lib/**/*.test.ts', …]` (so `node:fs`/`node:url` are available to this test).

---

### Task 1: Strengthen `schema-version.test.ts` into a cross-anchor consistency check

**Files:**
- Modify: `web/lib/schema-version.test.ts` (full rewrite of the test body; keep the SPDX header)

**Interfaces:**
- Consumes: `SCHEMA_VERSION` from `./schema-version` (existing export, value `1`); the on-disk files `../../server/src/schema.rs` and `../../CONTRACT.md`.
- Produces: nothing imported by other code — this is a leaf test. The Phase-3 exit-criterion command is `cd web && pnpm vitest run lib/schema-version.test.ts` → exit 0.

The file currently is:

```ts
// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright the Vortex contributors

import { describe, expect, it } from 'vitest';
import { SCHEMA_VERSION } from './schema-version';

describe('SCHEMA_VERSION', () => {
  // Drift sentinel for the cross-language lockstep (plan Table D / BANS): this
  // MUST stay equal to `server/src/schema.rs`'s `SCHEMA_VERSION` (= 1). A direct
  // assertion fails loud the moment the TS const is edited out of lockstep,
  // rather than only surfacing transitively through the /health assembly tests.
  it('is pinned to 1, matching server/src/schema.rs', () => {
    expect(SCHEMA_VERSION).toBe(1);
  });
});
```

- [ ] **Step 1: Write the failing test (replace the whole file body below the SPDX header)**

Replace the file's contents with EXACTLY this:

```ts
// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright the Vortex contributors

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { SCHEMA_VERSION } from './schema-version';

// Anchored declarations for the in-repo SCHEMA_VERSION lockstep sites. The
// canonical contract lives in `CONTRACT.md`; these tests read the real anchor
// files at test time and assert they all agree with the TS `SCHEMA_VERSION`
// const, so drift between any anchor fails web-ci loudly instead of only
// surfacing at ingest as a 400/409.
const RUST_DECL = /pub const SCHEMA_VERSION: i32 = (\d+);/;
const TS_DECL = /export const SCHEMA_VERSION = (\d+);/;

/**
 * Read an in-repo file (path relative to THIS test file) and extract the
 * integer SCHEMA_VERSION matched by `regex`. Throws — naming the file and
 * anchor — if the anchor is missing, so a renamed/moved anchor fails loudly
 * instead of silently passing.
 */
function versionFromFile(relPath: string, regex: RegExp, label: string): number {
  const source = readFileSync(fileURLToPath(new URL(relPath, import.meta.url)), 'utf8');
  const match = source.match(regex);
  if (match === null) {
    throw new Error(
      `Could not find the SCHEMA_VERSION anchor in ${label} ` +
        `(expected to match ${String(regex)}). The anchor was likely renamed or ` +
        `moved — update this consistency check and CONTRACT.md together.`,
    );
  }
  return Number.parseInt(match[1], 10);
}

describe('SCHEMA_VERSION', () => {
  it('is pinned to the canonical value 1', () => {
    // Canary: a deliberate version bump must also update this line (and every
    // anchor below), so an accidental cross-anchor bump cannot pass silently.
    expect(SCHEMA_VERSION).toBe(1);
  });

  it('matches server/src/schema.rs (the Rust source of truth)', () => {
    const rustVersion = versionFromFile('../../server/src/schema.rs', RUST_DECL, 'server/src/schema.rs');
    expect(rustVersion).toBe(SCHEMA_VERSION);
  });

  it('matches the anchor declarations documented in CONTRACT.md', () => {
    const docRustVersion = versionFromFile('../../CONTRACT.md', RUST_DECL, 'CONTRACT.md (Rust anchor row)');
    const docTsVersion = versionFromFile('../../CONTRACT.md', TS_DECL, 'CONTRACT.md (TS anchor row)');
    // CONTRACT.md's anchors table quotes both declarations verbatim; both must
    // agree with the live TS const (and therefore with schema.rs via the test
    // above), so a doc that drifts from the code fails here.
    expect(docRustVersion).toBe(SCHEMA_VERSION);
    expect(docTsVersion).toBe(SCHEMA_VERSION);
  });
});
```

- [ ] **Step 2: Run the test — expect PASS (anchors currently agree)**

Run:
```bash
cd web && pnpm vitest run lib/schema-version.test.ts
```
Expected: PASS — 3 tests pass (`is pinned to the canonical value 1`, `matches server/src/schema.rs`, `matches the anchor declarations documented in CONTRACT.md`).

(There is no natural RED for "verify existing consistency" — the anchors agree today. Step 3 proves the test is not vacuous.)

- [ ] **Step 3: Prove the test has teeth (temporary drift, then REVERT — do not commit)**

Temporarily edit one anchor to a different value, confirm the test FAILS, then revert:
```bash
# from repo root
sed -i 's/pub const SCHEMA_VERSION: i32 = 1;/pub const SCHEMA_VERSION: i32 = 2;/' server/src/schema.rs
cd web && pnpm vitest run lib/schema-version.test.ts; cd ..
# EXPECTED: the "matches server/src/schema.rs" test FAILS (rustVersion 2 !== SCHEMA_VERSION 1).
git checkout -- server/src/schema.rs   # REVERT — required; the anchor must stay at 1
```
Expected: the run fails on the `matches server/src/schema.rs` assertion while drift is present, then `git checkout` restores the file. Confirm `git status` shows `server/src/schema.rs` unmodified after revert.

- [ ] **Step 4: Re-run the test and the formatter/linter (all clean)**

Run:
```bash
cd web && pnpm vitest run lib/schema-version.test.ts && pnpm format:check && pnpm lint
```
Expected: vitest PASS (3/3), `format:check` clean, `lint` clean. If `format:check` flags the new file, run `cd web && pnpm format` (it reformats only style), then re-run this step.

- [ ] **Step 5: Confirm the anchors were not mutated, then commit**

Run:
```bash
git status --porcelain server/src/schema.rs web/lib/schema-version.ts CONTRACT.md
```
Expected: EMPTY (the three anchor files are untouched; only `web/lib/schema-version.test.ts` changed).

Then commit:
```bash
git add web/lib/schema-version.test.ts
git commit -m "test: assert SCHEMA_VERSION agrees across schema.rs, schema-version.ts, CONTRACT.md"
```

---

## Self-Review

**Spec coverage:**
- Cross-anchor consistency check over the three in-repo anchors (schema.rs ↔ schema-version.ts ↔ CONTRACT.md) → Task 1. ✓
- Phase-3 exit criterion `the consistency check (test/script) → 0` = `cd web && pnpm vitest run lib/schema-version.test.ts` → Task 1 Steps 2/4. ✓
- Reads real files (not mocks); proven non-vacuous → Task 1 Step 3 (negative check). ✓
- Anchors unchanged (SCHEMA_VERSION stays 1); read-only on anchor files → Global Constraints + Task 1 Step 5 guard. ✓
- Deliberate web-test-vs-standalone-script tradeoff recorded (web-ci auto-runs it; a neutral script would need new CI wiring) → Architecture note + this section. ✓

**Placeholder scan:** none — the full test file content and every command + expected output are literal.

**Type consistency:** `versionFromFile(relPath, regex, label): number` defined once and called with matching arg types; `RUST_DECL`/`TS_DECL` are `RegExp` literals; `SCHEMA_VERSION` is the imported number. No undefined references.

**Note for the consolidated phase-3 gauntlet:** the consistency check living in the web suite (not a neutral job) is a deliberate, recorded tradeoff (Architecture), not an oversight — `web-ci` runs it on every push so drift is caught pre-merge.
