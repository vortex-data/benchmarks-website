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
    const rustVersion = versionFromFile(
      '../../server/src/schema.rs',
      RUST_DECL,
      'server/src/schema.rs',
    );
    expect(rustVersion).toBe(SCHEMA_VERSION);
  });

  it('matches the anchor declarations documented in CONTRACT.md', () => {
    const docRustVersion = versionFromFile(
      '../../CONTRACT.md',
      RUST_DECL,
      'CONTRACT.md (Rust anchor row)',
    );
    const docTsVersion = versionFromFile(
      '../../CONTRACT.md',
      TS_DECL,
      'CONTRACT.md (TS anchor row)',
    );
    // CONTRACT.md's anchors table quotes both declarations verbatim; both must
    // agree with the live TS const (and therefore with schema.rs via the test
    // above), so a doc that drifts from the code fails here.
    expect(docRustVersion).toBe(SCHEMA_VERSION);
    expect(docTsVersion).toBe(SCHEMA_VERSION);
  });
});
