// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright the Vortex contributors

import { describe, expect, it } from 'vitest';
import { randomAccessChartName, randomAccessGroupName, randomAccessStorage } from './random-access';

describe('random-access storage split', () => {
  it.each([
    ['taxi', 'nvme', 'taxi'],
    ['taxi/uniform', 'nvme', 'taxi/uniform'],
    ['taxi-s3/uniform', 's3', 'taxi/uniform'],
    ['feature-vectors-s3/correlated', 's3', 'feature-vectors/correlated'],
    ['taxi-s3', 's3', 'taxi'],
  ])('reads %s as %s chart %s', (dataset, storage, chart) => {
    expect(randomAccessStorage(dataset)).toBe(storage);
    expect(randomAccessChartName(dataset)).toBe(chart);
  });

  it('names one group per storage backend', () => {
    expect(randomAccessGroupName('nvme')).toBe('Random Access (NVMe)');
    expect(randomAccessGroupName('s3')).toBe('Random Access (S3)');
  });
});
