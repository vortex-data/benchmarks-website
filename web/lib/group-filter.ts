// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright the Vortex contributors

/** Query parameter that identifies the group owning a local series filter. */
export const GROUP_FILTER_PARAM = 'group';

/** Repeated query parameter containing one hidden series label. */
export const HIDDEN_SERIES_PARAM = 'hide';

export interface GroupFilter {
  groupSlug: string;
  hiddenSeries: string[];
}

/** Parse one group-local series filter from the landing page query. */
export function parseGroupFilter(
  params: Record<string, string | string[] | undefined>,
): GroupFilter | null {
  const rawGroup = params[GROUP_FILTER_PARAM];
  const groupSlug = Array.isArray(rawGroup) ? rawGroup[0] : rawGroup;
  if (!groupSlug) {
    return null;
  }

  const rawHidden = params[HIDDEN_SERIES_PARAM];
  const values = rawHidden === undefined ? [] : Array.isArray(rawHidden) ? rawHidden : [rawHidden];
  return {
    groupSlug,
    hiddenSeries: [...new Set(values.filter((value) => value.length > 0))],
  };
}
