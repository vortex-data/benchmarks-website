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

  it('uses geometric mean ratios and raw byte sums', async () => {
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

    // sqrt((1 / 4) * (900 / 100)) is 1.5. The raw Vortex sizes sum to 901 bytes.
    expect(byFormat.get('vortex-file-compressed')?.ratio).toBeCloseTo(1.5, 6);
    expect(byFormat.get('vortex-file-compressed')?.totalBytes).toBe(901);
    expect(byFormat.get('parquet')?.ratio).toBeCloseTo(1, 6);
    expect(byFormat.get('parquet')?.totalBytes).toBe(104);
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
