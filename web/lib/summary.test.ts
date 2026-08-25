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

    const summary = await collectGroupSummary({ k: 'CompressionSizeGroup' }, []);
    if (summary === null || summary.type !== 'compressionSize') {
      throw new Error('expected a compressionSize summary');
    }
    const byFormat = new Map(summary.rankings.map((ranking) => [ranking.name, ranking]));

    // sqrt((1 / 4) * (900 / 100)) is 1.5.
    expect(byFormat.get('vortex-file-compressed')?.ratio).toBeCloseTo(1.5, 6);
    expect(byFormat.get('parquet')?.ratio).toBeCloseTo(1, 6);
    expect(byFormat.get('vortex-file-compressed')?.compressionRatio).toBeCloseTo(8, 6);
    expect(byFormat.get('parquet')?.compressionRatio).toBeCloseTo(4, 6);
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

    const summary = await collectGroupSummary({ k: 'CompressionTimeGroup' }, []);
    if (summary === null || summary.type !== 'compression') {
      throw new Error('expected a compression summary');
    }
    const ranking = summary.rankings[0];

    expect(ranking.ratio).toBeCloseTo(1, 6);
    expect(ranking.throughputGbS).toBeCloseTo(7.5, 6);
  });

  it('applies extensible snapshot policies to timings and sizes', async () => {
    query.mockResolvedValue({ rows: [] });

    await collectGroupSummary({ k: 'CompressionTimeGroup' }, []);
    await collectGroupSummary({ k: 'CompressionSizeGroup' }, []);

    expect(query).toHaveBeenCalledTimes(2);
    const timingParams = [
      ['vortex-file-compressed', 'parquet', 'lance'],
      ['vortex-file-compressed', 'parquet'],
      'vortex-file-compressed',
      'parquet',
    ];
    const sizeParams = [
      ['vortex-file-compressed', 'parquet', 'arrow-ipc', 'lance'],
      ['vortex-file-compressed', 'parquet', 'arrow-ipc'],
      'vortex-file-compressed',
      'parquet',
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
    expect(calls[0][0]).toContain('s.uncompressed_bytes > 0');
    expect(calls[0][0]).toContain('LEFT JOIN latest_uncompressed_sizes');
    expect(calls[1][0]).toContain('latest_uncompressed_sizes');
    expect(calls[1][0]).toContain('LEFT JOIN latest_uncompressed_sizes');
  });
});
