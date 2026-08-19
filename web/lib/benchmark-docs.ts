// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright the Vortex contributors

/**
 * Links from a group on this site to the benchmark's explainer doc in the
 * monorepo — the same docs the monorepo's PR benchmark comment links with its
 * 📖 glyph (`scripts/compare-benchmark-jsons.py::format_title`, fed by
 * `Benchmark::doc_path` in `vortex-bench`).
 *
 * The blurb in [`./descriptions`] is one editorial sentence; these links are
 * the long form — what the suite actually measures, which queries or datasets
 * it runs, and how to run it locally.
 *
 * **The dataset name is the link.** A SQL suite documents itself at
 * `vortex-bench/sql/<dataset>.md`, and `dataset` is a field of the group's own
 * [`./slug`].`GroupKey` — the emitter's `Benchmark::dataset_name()`, the same
 * string the doc is named after. So the common case needs no entry here: a
 * suite added upstream links itself the day its rows land, with no cross-repo
 * edit and no display-name parsing. [`DATASET_DOC_OVERRIDES`] is the backup,
 * naming only the few suites whose doc sits somewhere else, and a group that
 * resolves to neither lands on the benchmarking guide rather than nowhere.
 */

import { groupKeyFromSlug, type GroupKey } from './slug';

/** The monorepo that owns every benchmark and its explainer doc. */
const VORTEX_REPO = 'https://github.com/vortex-data/vortex';

/**
 * The ref the links pin to. `develop` is the monorepo's default branch: the
 * site tracks whatever is deployed rather than any one commit, so an unpinned
 * branch link is the one that stays correct as the docs move.
 */
const VORTEX_REF = 'develop';

/** Where the SQL suites' explainer docs live, one `<dataset>.md` per suite. */
const SQL_DOCS_DIR = 'vortex-bench/sql';

/**
 * The backup landing page for a group with no doc of its own: the benchmarking
 * chapter of the developer guide, which introduces every suite and how CI runs
 * them. Vector-search groups take it (upstream documents no single doc for
 * them), as does any dataset whose name cannot be spelled into a path.
 */
const BENCHMARKING_GUIDE = 'docs/developer-guide/benchmarking.md';

/**
 * A dataset name is trusted into a URL path only if it looks like one. Dataset
 * strings arrive from the database via the slug payload, and the convention
 * interpolates them directly; anything carrying a slash, a space, or another
 * URL-significant character takes [`BENCHMARKING_GUIDE`] instead of building a
 * nonsense link.
 */
const PLAIN_DATASET = /^[a-z0-9][a-z0-9._-]*$/i;

/**
 * Doc paths for the suites that do NOT follow the `sql/<dataset>.md`
 * convention: the four with a directory of queries and a README, plus the
 * sorted ClickBench variant, which is a section of the ClickBench doc.
 *
 * This is an exception list, not a registry — a dataset belongs here only once
 * the convention has been checked upstream and does not hold for it.
 */
const DATASET_DOC_OVERRIDES: Readonly<Record<string, string>> = {
  appian: `${SQL_DOCS_DIR}/appian/README.md`,
  'clickbench-sorted': `${SQL_DOCS_DIR}/clickbench.md#sorted-variant`,
  tpcds: `${SQL_DOCS_DIR}/tpcds/README.md`,
  tpch: `${SQL_DOCS_DIR}/tpch/README.md`,
  vortex: `${SQL_DOCS_DIR}/vortex/README.md`,
};

/** The compression benchmark, whose two measurement kinds share one doc. */
const COMPRESS_BENCH_DOC = 'benchmarks/compress-bench/README.md';

/** The random-access benchmark. */
const RANDOM_ACCESS_BENCH_DOC = 'benchmarks/random-access-bench/README.md';

/**
 * The GitHub URL of the doc describing what a group's benchmark measures,
 * taken from the group's slug. Returns `null` only for a slug that does not
 * parse, so a malformed key renders no link instead of throwing mid-render.
 */
export function groupDocUrl(slug: string): string | null {
  let key: GroupKey;
  try {
    key = groupKeyFromSlug(slug);
  } catch {
    return null;
  }
  return `${VORTEX_REPO}/blob/${VORTEX_REF}/${groupDocPath(key)}`;
}

/**
 * The repo-relative doc path for a group key. Exported for tests, so the
 * derivation can be pinned without the repo URL in every case.
 */
export function groupDocPath(key: GroupKey): string {
  switch (key.k) {
    case 'CompressionTimeGroup':
    case 'CompressionSizeGroup':
      return COMPRESS_BENCH_DOC;
    case 'RandomAccessGroup':
      return RANDOM_ACCESS_BENCH_DOC;
    case 'QueryGroup':
      return sqlSuiteDoc(key.dataset);
    case 'VectorSearchGroup':
      return BENCHMARKING_GUIDE;
  }
}

/** Resolve one SQL suite: the naming convention, then the exceptions. */
function sqlSuiteDoc(dataset: string): string {
  const override = DATASET_DOC_OVERRIDES[dataset];
  if (override !== undefined) {
    return override;
  }
  return PLAIN_DATASET.test(dataset) ? `${SQL_DOCS_DIR}/${dataset}.md` : BENCHMARKING_GUIDE;
}
