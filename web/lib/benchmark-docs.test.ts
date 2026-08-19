// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright the Vortex contributors

import { describe, expect, it } from 'vitest';

import { groupDocPath, groupDocUrl } from '@/lib/benchmark-docs';
import { groupNameQuery } from '@/lib/queries';

describe('groupDocPath', () => {
  it('maps the three flat family names', () => {
    expect(groupDocPath('Compression')).toBe('benchmarks/compress-bench/README.md');
    // Compression and Compression Size are two measurement kinds of one benchmark.
    expect(groupDocPath('Compression Size')).toBe('benchmarks/compress-bench/README.md');
    expect(groupDocPath('Random Access')).toBe('benchmarks/random-access-bench/README.md');
  });

  it('maps every TPC fan-out name onto its suite doc', () => {
    for (const storage of ['NVMe', 'S3']) {
      for (const sf of ['1', '10', '100', '1000']) {
        expect(groupDocPath(`TPC-H (${storage}) (SF=${sf})`)).toBe(
          'vortex-bench/sql/tpch/README.md',
        );
        expect(groupDocPath(`TPC-DS (${storage}) (SF=${sf})`)).toBe(
          'vortex-bench/sql/tpcds/README.md',
        );
      }
    }
  });

  it('maps the named query groups', () => {
    expect(groupDocPath('Clickbench')).toBe('vortex-bench/sql/clickbench.md');
    expect(groupDocPath('Statistical and Population Genetics')).toBe(
      'vortex-bench/sql/statpopgen.md',
    );
    expect(groupDocPath('PolarSignals Profiling')).toBe('vortex-bench/sql/polarsignals.md');
  });

  it('recovers the dataset from the legacy fallback name shape', () => {
    expect(groupDocPath('fineweb [nvme]')).toBe('vortex-bench/sql/fineweb.md');
    expect(groupDocPath('appian [nvme]')).toBe('vortex-bench/sql/appian/README.md');
    expect(groupDocPath('gharchive [s3]')).toBe('vortex-bench/sql/gharchive.md');
    expect(groupDocPath('public-bi/Arade sf=1 [nvme]')).toBe('vortex-bench/sql/public-bi.md');
    // The sorted ClickBench suite is its own dataset with its own doc anchor.
    expect(groupDocPath('clickbench-sorted [nvme]')).toBe(
      'vortex-bench/sql/clickbench.md#sorted-variant',
    );
  });

  it('follows `groupNameQuery`, the name builder it inverts', () => {
    expect(groupDocPath(groupNameQuery('tpch', null, '10', 'nvme'))).toBe(
      'vortex-bench/sql/tpch/README.md',
    );
    expect(groupDocPath(groupNameQuery('clickbench', null, null, 'nvme'))).toBe(
      'vortex-bench/sql/clickbench.md',
    );
    expect(groupDocPath(groupNameQuery('fineweb', null, null, 's3'))).toBe(
      'vortex-bench/sql/fineweb.md',
    );
  });

  it('resolves a dataset variant to its parent suite doc', () => {
    // `groupNameQuery` appends ` / variant` to a matched base name.
    expect(groupDocPath(groupNameQuery('clickbench', 'partitioned', null, 'nvme'))).toBe(
      'vortex-bench/sql/clickbench.md',
    );
  });

  it('returns null for groups with no doc mapped', () => {
    // Vector-search groups render as `dataset / layout` and have no doc.
    expect(groupDocPath('sift-1m / flat')).toBeNull();
    expect(groupDocPath('some-new-suite [nvme]')).toBeNull();
    expect(groupDocPath('')).toBeNull();
  });
});

describe('groupDocUrl', () => {
  it('pins the monorepo default branch', () => {
    expect(groupDocUrl('Clickbench')).toBe(
      'https://github.com/vortex-data/vortex/blob/develop/vortex-bench/sql/clickbench.md',
    );
  });

  it('keeps the doc anchor in the URL', () => {
    expect(groupDocUrl('clickbench-sorted [nvme]')).toBe(
      'https://github.com/vortex-data/vortex/blob/develop/vortex-bench/sql/clickbench.md#sorted-variant',
    );
  });

  it('is null exactly when there is no doc path', () => {
    expect(groupDocUrl('sift-1m / flat')).toBeNull();
  });
});
