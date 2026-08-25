// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright the Vortex contributors

import { beforeEach, describe, expect, it, vi } from 'vitest';

const { query } = vi.hoisted(() => ({ query: vi.fn() }));

vi.mock('./db', () => ({
  getPool: () => ({ query }),
}));

import { collectGroupSummary } from './summary';

describe('compression summaries', () => {
  beforeEach(() => {
    query.mockReset();
  });

  it('uses geometric mean size ratios', async () => {
    query.mockResolvedValueOnce({
      rows: [
        { format: 'vortex-file-compressed', valueBytes: 1, parquetBytes: 4 },
        { format: 'vortex-file-compressed', valueBytes: 900, parquetBytes: 100 },
        { format: 'parquet', valueBytes: 4, parquetBytes: 4 },
        { format: 'parquet', valueBytes: 100, parquetBytes: 100 },
      ],
    });

    const summary = await collectGroupSummary({ k: 'CompressionSizeGroup' }, []);
    if (summary === null || summary.type !== 'compressionSize') {
      throw new Error('expected a compressionSize summary');
    }
    const byFormat = new Map(summary.rankings.map((ranking) => [ranking.name, ranking]));

    // sqrt((1 / 4) * (900 / 100)) is 1.5.
    expect(byFormat.get('vortex-file-compressed')?.ratio).toBeCloseTo(1.5, 6);
    expect(byFormat.get('parquet')?.ratio).toBeCloseTo(1, 6);
  });

  it('applies one extensible snapshot policy to timings and sizes', async () => {
    query.mockResolvedValue({ rows: [] });

    await collectGroupSummary({ k: 'CompressionTimeGroup' }, []);
    await collectGroupSummary({ k: 'CompressionSizeGroup' }, []);

    expect(query).toHaveBeenCalledTimes(2);
    const expectedParams = [
      ['vortex-file-compressed', 'parquet', 'lance'],
      ['vortex-file-compressed', 'parquet'],
      'vortex-file-compressed',
      'parquet',
    ];
    for (const [text, params] of query.mock.calls as Array<[string, unknown[]]>) {
      expect(params).toEqual(expectedParams);
      expect(text).toContain('format = ANY($1::text[])');
      expect(text).toContain('format = ANY($2::text[])');
      expect(text).toContain('snapshot_policy');
      expect(text).toContain('snapshot_commits');
      expect(text).toContain('latest_snapshots');
      expect(text).toContain('DISTINCT ON (anchor_format)');
      expect(text).toContain('latest.commit_sha = pairs.commit_sha');
      expect(text).not.toContain('latest.ts = pairs.ts');
      expect(text).not.toContain('ROW_NUMBER()');
      // Adding another independently benchmarked format must not require
      // another hard-coded format branch or a per-dataset history scan.
      expect(text).not.toContain("format = 'lance'");
    }
  });
});

describe('random-access summary', () => {
  beforeEach(() => {
    query.mockReset();
  });

  const CHARTS = [{ name: 'feature-vectors/correlated' }, { name: 'taxi' }];

  it('aggregates every dataset in the group as a sum and a geomean', async () => {
    query.mockResolvedValueOnce({
      rows: [
        { dataset: 'feature-vectors/correlated', name: 'vortex', value: 1_000_000 },
        { dataset: 'feature-vectors/correlated', name: 'parquet', value: 4_000_000 },
        { dataset: 'taxi', name: 'vortex', value: 4_000_000 },
        { dataset: 'taxi', name: 'parquet', value: 16_000_000 },
      ],
    });

    const summary = await collectGroupSummary({ k: 'RandomAccessGroup' }, CHARTS);
    if (summary === null || summary.type !== 'randomAccess') {
      throw new Error('expected a randomAccess summary');
    }
    const byFormat = new Map(summary.rankings.map((ranking) => [ranking.name, ranking]));

    // Both datasets contribute: sqrt(1e6 * 4e6) = 2e6, sum = 5e6.
    expect(byFormat.get('vortex')?.geomean).toBeCloseTo(2_000_000, 6);
    expect(byFormat.get('vortex')?.total).toBeCloseTo(5_000_000, 6);
    expect(byFormat.get('parquet')?.geomean).toBeCloseTo(8_000_000, 6);
    expect(byFormat.get('parquet')?.total).toBeCloseTo(20_000_000, 6);
    // The ratio compares geomeans, not the first chart's raw value.
    expect(byFormat.get('vortex')?.ratio).toBeCloseTo(1, 6);
    expect(byFormat.get('parquet')?.ratio).toBeCloseTo(4, 6);
    expect(summary.rankings.map((ranking) => ranking.name)).toEqual(['vortex', 'parquet']);
    expect(summary.explanation).toBe(
      'Geomean and total random access time across 2 datasets | ' +
        'Ratio of geomean to fastest (lower is better)',
    );
  });

  it("scopes one query to the group's datasets and its newest snapshot", async () => {
    query.mockResolvedValue({ rows: [] });

    expect(await collectGroupSummary({ k: 'RandomAccessGroup' }, CHARTS)).toBeNull();

    expect(query).toHaveBeenCalledTimes(1);
    const [text, params] = query.mock.calls[0] as [string, unknown[]];
    expect(params).toEqual([['feature-vectors/correlated', 'taxi']]);
    expect(text).toContain('r.dataset = ANY($1::text[])');
    expect(text).toContain('SELECT MAX(ts) AS ts FROM scoped');
    // A same-timestamp commit tie must not double-count into the sum.
    expect(text).toContain('DISTINCT ON (s.dataset, s.format)');
  });

  it('drops a format that does not cover every measured dataset', async () => {
    query.mockResolvedValueOnce({
      rows: [
        { dataset: 'feature-vectors/correlated', name: 'lance', value: 1_000 },
        { dataset: 'feature-vectors/correlated', name: 'vortex', value: 1_000_000 },
        { dataset: 'taxi', name: 'vortex', value: 4_000_000 },
      ],
    });

    const summary = await collectGroupSummary({ k: 'RandomAccessGroup' }, CHARTS);
    if (summary === null || summary.type !== 'randomAccess') {
      throw new Error('expected a randomAccess summary');
    }
    // Lance is missing `taxi` at the snapshot commit, so summing it over one
    // dataset would make it look artificially cheap: it is dropped instead.
    expect(summary.rankings.map((ranking) => ranking.name)).toEqual(['vortex']);
  });

  it('returns no summary for a group with no chart links', async () => {
    expect(await collectGroupSummary({ k: 'RandomAccessGroup' }, [])).toBeNull();
    expect(query).not.toHaveBeenCalled();
  });
});
