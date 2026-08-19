// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright the Vortex contributors

/**
 * Deep links from a group on this site to the benchmark's explainer doc in the
 * monorepo — the same docs the monorepo's PR benchmark comment links with its
 * 📖 glyph (`scripts/compare-benchmark-jsons.py::format_title`, fed by
 * `Benchmark::doc_path` in `vortex-bench`).
 *
 * The blurb in [`./descriptions`] is one editorial sentence; these links are
 * the long form — what the suite actually measures, which queries or datasets
 * it runs, and how to run it locally. The benchmark code stays the source of
 * truth for the prose, so this module carries only the path mapping.
 *
 * Keying is by group *display name*, matching [`./descriptions`], because that
 * is all a rendered [`./queries`].`Group` carries. Names that reach here are
 * the ones `groupNameQuery` emits (`TPC-H (NVMe) (SF=1)`, `Clickbench`, the
 * legacy `dataset[/variant][ sf=N] [storage]` fallback) plus the three flat
 * family names. Anything unrecognised — vector-search groups, a dataset added
 * upstream before its entry lands here — returns `null`, and the caller simply
 * renders no link.
 */

/** The monorepo that owns every benchmark and its explainer doc. */
const VORTEX_REPO = 'https://github.com/vortex-data/vortex';

/**
 * The ref the links pin to. `develop` is the monorepo's default branch: the
 * site tracks whatever is deployed rather than any one commit, so an unpinned
 * branch link is the one that stays correct as the docs move.
 */
const VORTEX_REF = 'develop';

/**
 * Repo-relative doc paths for the non-query families, whose group names are
 * fixed strings rather than dataset-derived. Compression and Compression Size
 * are two measurement kinds emitted by one benchmark, so they share a doc.
 */
const FAMILY_DOCS: Readonly<Record<string, string>> = {
  Compression: 'benchmarks/compress-bench/README.md',
  'Compression Size': 'benchmarks/compress-bench/README.md',
  'Random Access': 'benchmarks/random-access-bench/README.md',
};

/**
 * Repo-relative doc paths per SQL benchmark dataset, one entry per
 * `Benchmark::doc_path` in `vortex-bench/src`. Keys are the `dataset_name()`
 * the emitter writes into `query_measurements.dataset`.
 */
const DATASET_DOCS: Readonly<Record<string, string>> = {
  appian: 'vortex-bench/sql/appian/README.md',
  clickbench: 'vortex-bench/sql/clickbench.md',
  'clickbench-sorted': 'vortex-bench/sql/clickbench.md#sorted-variant',
  fineweb: 'vortex-bench/sql/fineweb.md',
  gharchive: 'vortex-bench/sql/gharchive.md',
  polarsignals: 'vortex-bench/sql/polarsignals.md',
  'public-bi': 'vortex-bench/sql/public-bi.md',
  spatialbench: 'vortex-bench/sql/spatialbench.md',
  statpopgen: 'vortex-bench/sql/statpopgen.md',
  tpcds: 'vortex-bench/sql/tpcds/README.md',
  tpch: 'vortex-bench/sql/tpch/README.md',
  vortex: 'vortex-bench/sql/vortex/README.md',
};

/**
 * The GitHub URL of the doc describing what a group's benchmark measures, or
 * `null` when no doc is mapped for it.
 */
export function groupDocUrl(name: string): string | null {
  const path = groupDocPath(name);
  return path === null ? null : `${VORTEX_REPO}/blob/${VORTEX_REF}/${path}`;
}

/**
 * The repo-relative doc path for a group display name. Exported for tests, so
 * the mapping can be pinned without hard-coding the repo URL in every case.
 */
export function groupDocPath(name: string): string | null {
  // `groupNameQuery` appends ` / variant` to a matched base name; the variant
  // shares its parent suite's doc, so match on the base.
  const base = name.split(' / ')[0];
  const family = FAMILY_DOCS[base];
  if (family !== undefined) {
    return family;
  }
  const dataset = datasetOf(base);
  if (dataset === null) {
    return null;
  }
  return DATASET_DOCS[dataset] ?? null;
}

/**
 * Recover the emitter's `dataset` from a rendered query-group name: the
 * inverse of `queries.ts::groupNameQuery` for the names it special-cases, and
 * the leading token of its legacy `dataset[/variant][ sf=N] [storage]`
 * fallback otherwise.
 */
function datasetOf(name: string): string | null {
  if (name.startsWith('TPC-H ')) {
    return 'tpch';
  }
  if (name.startsWith('TPC-DS ')) {
    return 'tpcds';
  }
  switch (name) {
    case 'Clickbench':
      return 'clickbench';
    case 'Statistical and Population Genetics':
      return 'statpopgen';
    case 'PolarSignals Profiling':
      return 'polarsignals';
    default:
      break;
  }
  const token = /^[^ /]+/.exec(name);
  return token === null ? null : token[0];
}
