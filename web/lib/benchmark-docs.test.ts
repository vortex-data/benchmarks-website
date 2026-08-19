// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright the Vortex contributors

import { describe, expect, it } from 'vitest';

import { groupDocPath, groupDocUrl } from '@/lib/benchmark-docs';
import { groupKeyToSlug } from '@/lib/slug';

/** A query group for `dataset`; the other dims do not affect the doc. */
function queryGroup(dataset: string) {
  return {
    k: 'QueryGroup',
    dataset,
    dataset_variant: null,
    scale_factor: null,
    storage: 'nvme',
  } as const;
}

describe('groupDocPath', () => {
  it('derives a SQL suite doc from the dataset name alone', () => {
    // The convention, exercised by every suite that follows it. None of these
    // needs an entry in the module.
    for (const dataset of [
      'clickbench',
      'fineweb',
      'gharchive',
      'polarsignals',
      'public-bi',
      'spatialbench',
      'statpopgen',
    ]) {
      expect(groupDocPath(queryGroup(dataset))).toBe(`vortex-bench/sql/${dataset}.md`);
    }
  });

  it('links a suite it has never heard of', () => {
    // The point of the convention: a suite added upstream links itself.
    expect(groupDocPath(queryGroup('some-new-suite'))).toBe('vortex-bench/sql/some-new-suite.md');
  });

  it('takes the override for suites that document themselves elsewhere', () => {
    expect(groupDocPath(queryGroup('tpch'))).toBe('vortex-bench/sql/tpch/README.md');
    expect(groupDocPath(queryGroup('tpcds'))).toBe('vortex-bench/sql/tpcds/README.md');
    expect(groupDocPath(queryGroup('appian'))).toBe('vortex-bench/sql/appian/README.md');
    expect(groupDocPath(queryGroup('vortex'))).toBe('vortex-bench/sql/vortex/README.md');
    expect(groupDocPath(queryGroup('clickbench-sorted'))).toBe(
      'vortex-bench/sql/clickbench.md#sorted-variant',
    );
  });

  it('maps the three non-query families to their benchmark crate', () => {
    expect(groupDocPath({ k: 'CompressionTimeGroup' })).toBe('benchmarks/compress-bench/README.md');
    // Two measurement kinds of one benchmark, so one doc.
    expect(groupDocPath({ k: 'CompressionSizeGroup' })).toBe('benchmarks/compress-bench/README.md');
    expect(groupDocPath({ k: 'RandomAccessGroup' })).toBe(
      'benchmarks/random-access-bench/README.md',
    );
  });

  it('falls back to the benchmarking guide where no suite doc exists', () => {
    // Vector-search groups have no doc of their own upstream.
    expect(groupDocPath({ k: 'VectorSearchGroup', dataset: 'sift-1m', layout: 'flat' })).toBe(
      'docs/developer-guide/benchmarking.md',
    );
  });

  it('refuses to spell a dataset that is not path-shaped into a path', () => {
    for (const dataset of ['../../etc/passwd', 'two words', 'a/b', '', '#anchor']) {
      expect(groupDocPath(queryGroup(dataset))).toBe('docs/developer-guide/benchmarking.md');
    }
  });
});

describe('groupDocUrl', () => {
  it('pins the monorepo default branch', () => {
    expect(groupDocUrl(groupKeyToSlug(queryGroup('clickbench')))).toBe(
      'https://github.com/vortex-data/vortex/blob/develop/vortex-bench/sql/clickbench.md',
    );
  });

  it('keeps the doc anchor in the URL', () => {
    expect(groupDocUrl(groupKeyToSlug(queryGroup('clickbench-sorted')))).toBe(
      'https://github.com/vortex-data/vortex/blob/develop/vortex-bench/sql/clickbench.md#sorted-variant',
    );
  });

  it('reads the dataset through the slug, not the display name', () => {
    // A variant shares its parent suite's doc: only `dataset` selects it.
    const variant = {
      k: 'QueryGroup',
      dataset: 'clickbench',
      dataset_variant: 'partitioned',
      scale_factor: '10',
      storage: 's3',
    } as const;
    expect(groupDocUrl(groupKeyToSlug(variant))).toBe(
      'https://github.com/vortex-data/vortex/blob/develop/vortex-bench/sql/clickbench.md',
    );
  });

  it('returns null for a slug that does not parse', () => {
    expect(groupDocUrl('not-a-slug')).toBeNull();
    expect(groupDocUrl('qmg.!!!!')).toBeNull();
  });
});
