// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright the Vortex contributors

import { beforeEach, describe, expect, it, vi } from 'vitest';

const { query } = vi.hoisted(() => ({ query: vi.fn() }));

vi.mock('./db', () => ({
  getPool: () => ({ query }),
}));

import { FAMILIES } from './families';
import type { GroupKey } from './slug';
import { collectGroupSummary } from './summary';

/** Every group discriminant, from the fact-table registry. */
const GROUP_KINDS = FAMILIES.map((family) => family.groupKind);

describe('compression summaries', () => {
  beforeEach(() => {
    query.mockReset();
  });

  it('uses geometric mean size ratios', async () => {
    query.mockResolvedValueOnce({
      rows: [
        {
          format: 'vortex-file-compressed',
          valueBytes: 1,
          parquetBytes: 4,
          uncompressedBytes: 16,
        },
        {
          format: 'vortex-file-compressed',
          valueBytes: 900,
          parquetBytes: 100,
          uncompressedBytes: 3_600,
        },
        { format: 'parquet', valueBytes: 4, parquetBytes: 4, uncompressedBytes: 16 },
        { format: 'parquet', valueBytes: 100, parquetBytes: 100, uncompressedBytes: null },
      ],
    });

    const summary = await collectGroupSummary({ k: 'CompressionSizeGroup' });
    if (summary === null || summary.type !== 'compressionSize') {
      throw new Error('expected a compressionSize summary');
    }
    const byFormat = new Map(summary.rankings.map((ranking) => [ranking.name, ranking]));

    // sqrt((1 / 4) * (900 / 100)) is 1.5.
    expect(summary.rankings.map((ranking) => ranking.name)).toEqual([
      'vortex-file-compressed',
      'parquet',
    ]);
    expect(byFormat.get('vortex-file-compressed')?.ratio).toBeCloseTo(1.5, 6);
    expect(byFormat.get('parquet')?.ratio).toBeCloseTo(1, 6);
    expect(byFormat.get('vortex-file-compressed')?.minRatio).toBeCloseTo(0.25, 6);
    expect(byFormat.get('vortex-file-compressed')?.maxRatio).toBeCloseTo(9, 6);
    expect(byFormat.get('vortex-file-compressed')?.compressionRatio).toBeCloseTo(8, 6);
    expect(byFormat.get('parquet')?.minRatio).toBeCloseTo(1, 6);
    expect(byFormat.get('parquet')?.maxRatio).toBeCloseTo(1, 6);
    expect(byFormat.get('parquet')?.compressionRatio).toBeCloseTo(4, 6);
    expect(summary.explanation).toBe(
      'Geometric means of compressed sizes versus Arrow (higher is better) and versus Parquet-zstd (lower is better)',
    );
  });

  it('uses available Arrow memory sizes for aggregate throughput', async () => {
    query.mockResolvedValueOnce({
      rows: [
        {
          format: 'vortex-file-compressed',
          op: 'encode',
          valueNs: 100,
          parquetNs: 200,
          uncompressedBytes: 1_000,
        },
        {
          format: 'vortex-file-compressed',
          op: 'encode',
          valueNs: 300,
          parquetNs: 300,
          uncompressedBytes: 2_000,
        },
        {
          format: 'vortex-file-compressed',
          op: 'encode',
          valueNs: 500,
          parquetNs: 250,
          uncompressedBytes: null,
        },
      ],
    });

    const summary = await collectGroupSummary({ k: 'CompressionTimeGroup' });
    if (summary === null || summary.type !== 'compression') {
      throw new Error('expected a compression summary');
    }
    const ranking = summary.rankings[0];

    expect(ranking.ratio).toBeCloseTo(1, 6);
    expect(ranking.throughputGbS).toBeCloseTo(7.5, 6);
  });

  it('applies extensible snapshot policies to timings and sizes', async () => {
    query.mockResolvedValue({ rows: [] });

    await collectGroupSummary({ k: 'CompressionTimeGroup' });
    await collectGroupSummary({ k: 'CompressionSizeGroup' });

    expect(query).toHaveBeenCalledTimes(2);
    const timingParams = [
      ['vortex-file-compressed', 'parquet', 'lance'],
      ['vortex-file-compressed', 'parquet'],
      'vortex-file-compressed',
      'parquet',
    ];
    const sizeParams = [
      ['vortex-file-compressed', 'parquet', 'lance', 'arrow-ipc'],
      ['vortex-file-compressed', 'parquet'],
      'vortex-file-compressed',
      'parquet',
      'arrow-ipc',
    ];
    const calls = query.mock.calls as Array<[string, unknown[]]>;
    expect(calls[0][1]).toEqual(timingParams);
    expect(calls[1][1]).toEqual(sizeParams);
    for (const [text] of calls) {
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
    expect(calls[0][0]).toContain('latest_uncompressed_sizes');
    for (const [text] of calls) {
      expect(text).toContain("to_jsonb(s) ->> 'uncompressed_bytes'");
      expect(text).not.toMatch(/\bs\.uncompressed_bytes\b/);
    }
    expect(calls[0][0]).toContain('LEFT JOIN latest_uncompressed_sizes');
    expect(calls[1][0]).toContain('latest_uncompressed_sizes');
    expect(calls[1][0]).toContain('latest_arrow_ipc');
    expect(calls[1][0]).toContain('selected_with_arrow_ipc');
    expect(calls[1][0]).toContain('LEFT JOIN latest_uncompressed_sizes');
    expect(calls[1][0]).toContain(
      'COALESCE(uncompressed.uncompressed_bytes, selected.uncompressed_bytes)',
    );
  });
});

describe('timing summaries (shared ranking model)', () => {
  beforeEach(() => {
    query.mockReset();
  });

  it('sums random-access charts by dataset before ranking', async () => {
    // The regression: the old summary published one chart's raw times under the
    // group-wide title. `lance` wins `feature-vectors/correlated` outright and
    // loses the other two charts 3x; the group ranking must reflect all three.
    query.mockResolvedValueOnce({
      rows: [
        { bucket: 'feature-vectors/correlated', series: 'lance', value: 350_000 },
        { bucket: 'feature-vectors/correlated', series: 'vortex', value: 1_100_000 },
        { bucket: 'nested-structs/uniform', series: 'lance', value: 3_000_000 },
        { bucket: 'nested-structs/uniform', series: 'vortex', value: 1_000_000 },
        { bucket: 'taxi', series: 'lance', value: 3_000_000 },
        { bucket: 'taxi', series: 'vortex', value: 1_000_000 },
      ],
    });

    const summary = await collectGroupSummary({ k: 'RandomAccessGroup' });
    if (summary === null || summary.type !== 'randomAccess') {
      throw new Error('expected a randomAccess summary');
    }
    expect(summary.rankings.map((r) => r.name)).toEqual(['vortex', 'lance']);
    expect(summary.rankings[0].score).toBeCloseTo(Math.cbrt(1_100_010 / 350_010), 6);
    expect(summary.rankings[1].score).toBeCloseTo(Math.cbrt((3_000_010 / 1_000_010) ** 2), 6);
    expect(summary.rankings[0].totalRuntime).toBeCloseTo(3_100_000 / 3, 6);
    expect(summary.rankings.map((r) => r.measured)).toEqual([3, 3]);
    expect(summary.rankings.map((r) => r.total)).toEqual([3, 3]);
  });

  it('combines correlated, uniform, and legacy taxi charts into dataset totals', async () => {
    query.mockResolvedValueOnce({
      rows: [
        { bucket: 'feature-vectors/correlated', series: 'lance', value: 100_000 },
        { bucket: 'feature-vectors/correlated', series: 'vortex', value: 1_000_000 },
        { bucket: 'feature-vectors/uniform', series: 'lance', value: 10_000_000 },
        { bucket: 'feature-vectors/uniform', series: 'vortex', value: 1_000_000 },
        { bucket: 'taxi', series: 'lance', value: 200_000 },
        { bucket: 'taxi', series: 'vortex', value: 100_000 },
        { bucket: 'taxi/correlated', series: 'lance', value: 300_000 },
        { bucket: 'taxi/correlated', series: 'vortex', value: 100_000 },
        { bucket: 'taxi/uniform', series: 'lance', value: 500_000 },
        { bucket: 'taxi/uniform', series: 'vortex', value: 100_000 },
      ],
    });

    const summary = await collectGroupSummary({ k: 'RandomAccessGroup' });
    if (summary === null || summary.type !== 'randomAccess') {
      throw new Error('expected a randomAccess summary');
    }
    const byName = new Map(summary.rankings.map((ranking) => [ranking.name, ranking]));
    expect(summary.rankings.map((ranking) => ranking.name)).toEqual(['vortex', 'lance']);
    expect(byName.get('vortex')?.score).toBeCloseTo(1, 6);
    expect(byName.get('lance')?.score).toBeCloseTo(
      Math.sqrt((10_100_010 / 2_000_010) * (1_000_010 / 300_010)),
      6,
    );
    expect(byName.get('vortex')?.totalRuntime).toBeCloseTo(2_300_000 / 2, 6);
    expect(byName.get('lance')?.totalRuntime).toBeCloseTo(11_100_000 / 2, 6);
    expect(summary.rankings.map((ranking) => [ranking.measured, ranking.total])).toEqual([
      [2, 2],
      [2, 2],
    ]);
    expect(summary.explanation).toBe(
      'Geomean of take time ratio to fastest across every dataset (lower is better)',
    );
  });

  it('reads each random-access format at its own newest run', async () => {
    query.mockResolvedValue({ rows: [] });
    await collectGroupSummary({ k: 'RandomAccessGroup' });
    const [text] = query.mock.calls[0] as [string, unknown[] | undefined];
    // Per-series freshness, not one global latest commit: a format that skipped
    // the newest commit stays on the card at its own last run.
    expect(text).toContain('DISTINCT ON (r.dataset, r.format)');
    expect(text).toContain('ORDER BY r.dataset, r.format, c.timestamp DESC');
    expect(text).not.toContain('MAX(c2.timestamp)');
  });

  it('penalizes a series that skipped a bucket and reports its coverage', async () => {
    query.mockResolvedValueOnce({
      rows: [
        { bucket: 'feature-vectors/correlated', series: 'lance', value: 100_000 },
        { bucket: 'feature-vectors/correlated', series: 'vortex', value: 200_000 },
        { bucket: 'taxi', series: 'vortex', value: 50_000 },
      ],
    });

    const summary = await collectGroupSummary({ k: 'RandomAccessGroup' });
    if (summary === null || summary.type !== 'randomAccess') {
      throw new Error('expected a randomAccess summary');
    }
    const byName = new Map(summary.rankings.map((r) => [r.name, r]));
    // lance skipped `taxi`, so that bucket scores max(100_000, 0) * 2 against
    // taxi's best of 50_000 -- which is what keeps it behind `vortex`.
    expect(summary.rankings.map((r) => r.name)).toEqual(['vortex', 'lance']);
    expect(byName.get('lance')?.score).toBeCloseTo(Math.sqrt(200_010 / 50_010), 6);
    expect(byName.get('lance')?.measured).toBe(1);
    expect(byName.get('lance')?.total).toBe(2);
    // `totalRuntime` reports measured time only; the penalty never enters it.
    expect(byName.get('lance')?.totalRuntime).toBeCloseTo(100_000, 6);
    expect(byName.get('vortex')?.measured).toBe(2);
  });

  it('does not reward a series for skipping a slow bucket', async () => {
    query.mockResolvedValueOnce({
      rows: [
        { bucket: 'easy', series: 'partial', value: 100_000 },
        { bucket: 'easy', series: 'complete', value: 110_000 },
        { bucket: 'slow', series: 'complete', value: 100_000_000 },
      ],
    });

    const summary = await collectGroupSummary({ k: 'RandomAccessGroup' });
    if (summary === null || summary.type !== 'randomAccess') {
      throw new Error('expected a randomAccess summary');
    }
    const byName = new Map(summary.rankings.map((r) => [r.name, r]));
    // The absolute penalty for `partial` is 200_000ns. That value is faster
    // than the measured 100_000_000ns best on `slow`, so the 2x ratio floor
    // must prevent the absent bucket from improving the partial series' score.
    expect(summary.rankings.map((r) => r.name)).toEqual(['complete', 'partial']);
    expect(byName.get('partial')?.score).toBeCloseTo(Math.sqrt(2), 6);
    expect(byName.get('partial')?.measured).toBe(1);
    expect(byName.get('partial')?.total).toBe(2);
  });

  it('summarizes a vector-search group across its thresholds', async () => {
    query.mockResolvedValueOnce({
      rows: [
        { bucket: 0.5, series: 'vortex-turboquant', value: 1_000 },
        { bucket: 0.75, series: 'vortex-turboquant', value: 2_000 },
        { bucket: 0.5, series: 'vortex-flat', value: 2_000 },
        { bucket: 0.75, series: 'vortex-flat', value: 8_000 },
      ],
    });

    const summary = await collectGroupSummary({
      k: 'VectorSearchGroup',
      dataset: 'cohere-large-10m',
      layout: 'partitioned',
    });
    if (summary === null || summary.type !== 'vectorSearch') {
      throw new Error('expected a vectorSearch summary');
    }
    expect(summary.title).toBe('Vector Search Performance');
    expect(summary.rankings.map((r) => r.name)).toEqual(['vortex-turboquant', 'vortex-flat']);
    expect(summary.rankings[0].score).toBeCloseTo(1.0, 6);
    expect(summary.rankings[1].score).toBeCloseTo(Math.sqrt((2010 / 1010) * (8010 / 2010)), 6);
    expect(summary.rankings[1].totalRuntime).toBeCloseTo(10_000, 6);
  });

  it('summarizes every query group, with no dataset allowlist', async () => {
    // `spatialbench` (and every other suite outside the retired v2 five) used to
    // fall through to `null` and render no card at all.
    for (const dataset of ['spatialbench', 'fineweb', 'gharchive', 'appian', 'tpch']) {
      query.mockResolvedValueOnce({
        rows: [
          { query_idx: 1, series: 'datafusion:vortex', value_ns: 1_000 },
          { query_idx: 1, series: 'duckdb:parquet', value_ns: 2_000 },
        ],
      });
      const summary = await collectGroupSummary({
        k: 'QueryGroup',
        dataset,
        dataset_variant: null,
        scale_factor: null,
        storage: 'nvme',
      });
      expect(summary?.type).toBe('queryBenchmark');
    }
  });

  it('returns a summary for every group kind', async () => {
    // The default-on contract: a new suite landing in any fact table gets a
    // card without a summary-side change. Only an empty result yields `null`.
    const keys: GroupKey[] = [
      {
        k: 'QueryGroup',
        dataset: 'newsuite',
        dataset_variant: null,
        scale_factor: null,
        storage: 'nvme',
      },
      { k: 'CompressionTimeGroup' },
      { k: 'CompressionSizeGroup' },
      { k: 'RandomAccessGroup' },
      { k: 'VectorSearchGroup', dataset: 'd', layout: 'l' },
    ];
    expect(keys.map((key) => key.k).sort()).toEqual([...GROUP_KINDS].sort());
    for (const key of keys) {
      query.mockResolvedValue({ rows: [] });
      // Every kind reaches SQL; none short-circuits to `null` on its key alone.
      query.mockClear();
      await collectGroupSummary(key);
      expect(query).toHaveBeenCalled();
    }
  });
});
