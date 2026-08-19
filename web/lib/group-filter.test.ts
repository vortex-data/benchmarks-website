// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright the Vortex contributors

import { describe, expect, it } from 'vitest';

import { parseGroupFilter } from './group-filter';

describe('parseGroupFilter', () => {
  it('parses and deduplicates repeated hidden-series labels', () => {
    expect(parseGroupFilter({ group: 'random_access', hide: ['a', 'b', 'a'] })).toEqual({
      groupSlug: 'random_access',
      hiddenSeries: ['a', 'b'],
    });
  });

  it('ignores hidden-series labels without a target group', () => {
    expect(parseGroupFilter({ hide: ['a', 'b'] })).toBeNull();
  });
});
