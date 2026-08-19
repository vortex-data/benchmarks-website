// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright the Vortex contributors

import { beforeEach, describe, expect, it, vi } from 'vitest';

const { query } = vi.hoisted(() => ({ query: vi.fn() }));

vi.mock('./db', () => ({
  getPool: () => ({ query }),
}));

import { collectGroupSummary } from './summary';

describe('compression size summary math', () => {
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
});
