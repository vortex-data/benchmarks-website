// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright the Vortex contributors

/**
 * Per-group summary rollups.
 *
 * Each `collect*Summary` runs focused SQL queries and returns one [`Summary`]
 * variant. Query summaries use a v2 dataset allowlist. Compression summaries
 * compare the configured formats with Parquet.
 *
 * Behaviour-preservation notes (substrate migration, DuckDB -> Postgres):
 *  - Nullable-dim equality (`dataset_variant` / `scale_factor`) in the
 *    query-group summary is rendered as `col IS NULL` / `col = $n` per the
 *    concrete key's build-time value, the index-sargable form of the DuckDB
 *    `NULL == NULL` semantics (the same rule as `sargableDimEq` in
 *    `queries.ts`; PR-5.1.5). The compression summaries' self-joins below are
 *    the only remaining `IS NOT DISTINCT FROM` users -- there the dim is a
 *    join column, not a build-time constant, and the tables are small.
 *  - value columns are read `::float8` so node-postgres returns a JS `number`
 *    matching the Rust `CAST(... AS DOUBLE)`, rather than the bigint-as-string
 *    default.
 *  - the "latest timestamp" two-step (find the newest commit with a complete
 *    vortex/parquet pair, then aggregate at that timestamp) is preserved, but
 *    resolved entirely inside SQL via a CTE so `MAX(timestamp)` never round-trips
 *    through text. The Rust source rendered it via `CAST(MAX(ts) AS VARCHAR)` /
 *    `CAST(? AS TIMESTAMPTZ)`; DuckDB's VARCHAR cast preserves microseconds, but
 *    a text round-trip is fragile (a second-granularity render silently drops
 *    any sub-second commit timestamp), so the port keeps the timestamp in SQL.
 */

import { getPool } from './db';
import { compareCodeUnits } from './families';
import type { GroupKey } from './slug';

/**
 * Freshness buckets shared by the compression-time and compression-size summaries.
 *
 * Formats benchmarked with Vortex use its newest shared snapshot. Add another
 * intermittently benchmarked format to `INDEPENDENT_SNAPSHOT`; both summaries
 * will use that format's newest complete snapshot and compare it with Parquet
 * from the same commit.
 */
const COMPRESSION_SHARED_SNAPSHOT_FORMATS = ['vortex-file-compressed', 'parquet'];
const COMPRESSION_INDEPENDENT_SNAPSHOT_FORMATS = ['lance'];

const COMPRESSION_SNAPSHOT_ANCHOR = 'vortex-file-compressed';
const COMPRESSION_BASELINE = 'parquet';

function compressionSummaryQueryParams(): [string[], string[], string, string] {
  return [
    [...COMPRESSION_SHARED_SNAPSHOT_FORMATS, ...COMPRESSION_INDEPENDENT_SNAPSHOT_FORMATS],
    COMPRESSION_SHARED_SNAPSHOT_FORMATS,
    COMPRESSION_SNAPSHOT_ANCHOR,
    COMPRESSION_BASELINE,
  ];
}

/** One random-access summary row. */
export interface RandomAccessRanking {
  /** Series name, normally the physical format. */
  name: string;
  /** Latest measured time in nanoseconds. */
  time: number;
  /** Ratio to the fastest series in the same chart. */
  ratio: number;
}

/** One query-benchmark summary row. */
export interface QueryRanking {
  /** Series name, normally `engine:format`. */
  name: string;
  /** Geomean ratio to the fastest observed value per query. */
  score: number;
  /** Sum of latest runtimes for the queries this series has. */
  totalRuntime: number;
}

/** One format and operation in the compression throughput summary. */
export interface CompressionRanking {
  /** On-disk format. */
  name: string;
  /** Compression operation. */
  operation: 'encode' | 'decode';
  /** Geomean throughput ratio to Parquet for shared datasets. */
  ratio: number;
  /** Aggregate throughput in decimal gigabytes per second. */
  throughputGbS?: number;
}

/** One format in the compression size summary. */
export interface CompressionSizeRanking {
  /** On-disk format. */
  name: string;
  /** Geomean size ratio to Parquet for shared datasets. */
  ratio: number;
  /** Sum of the compressed sizes for shared datasets. */
  totalBytes: number;
}

/**
 * Server-computed group summary. The `type` field identifies the variant.
 * Field names use camelCase on the wire.
 */
export type Summary =
  | {
      type: 'randomAccess';
      title: string;
      rankings: RandomAccessRanking[];
      explanation: string;
    }
  | {
      type: 'compression';
      title: string;
      rankings: CompressionRanking[];
      explanation: string;
    }
  | {
      type: 'compressionSize';
      title: string;
      rankings: CompressionSizeRanking[];
      explanation: string;
    }
  | {
      type: 'queryBenchmark';
      title: string;
      rankings: QueryRanking[];
      explanation: string;
    };

/**
 * Compute the summary for one group, if its kind has one.
 * `charts` is only consulted for the random-access path (which scans its chart
 * links for the latest populated dataset); the other paths query their fact
 * table directly. The structural `{ name }[]` accepts a `ChartLink[]`.
 */
export function collectGroupSummary(
  key: GroupKey,
  charts: readonly { readonly name: string }[],
): Promise<Summary | null> {
  switch (key.k) {
    case 'QueryGroup':
      if (queryGroupHasV2Summary(key.dataset)) {
        return collectQuerySummary(key.dataset, key.dataset_variant, key.scale_factor, key.storage);
      }
      return Promise.resolve(null);
    case 'CompressionTimeGroup':
      return collectCompressionSummary();
    case 'CompressionSizeGroup':
      return collectCompressionSizeSummary();
    case 'RandomAccessGroup':
      return collectRandomAccessSummary(charts);
    case 'VectorSearchGroup':
      return Promise.resolve(null);
  }
}

/** The v2 dataset allowlist for which a query group carries a summary. */
function queryGroupHasV2Summary(dataset: string): boolean {
  switch (dataset) {
    case 'clickbench':
    case 'statpopgen':
    case 'polarsignals':
    case 'tpch':
    case 'tpcds':
      return true;
    default:
      return false;
  }
}

/**
 * Geometric mean over the positive, finite values, or `null` when none
 * qualify. Computed in log space (`exp(mean(ln(v)))`) exactly as the Rust
 * `geo_mean`.
 */
function geoMean(values: readonly number[]): number | null {
  let sumLn = 0;
  let n = 0;
  for (const value of values) {
    if (value > 0 && Number.isFinite(value)) {
      sumLn += Math.log(value);
      n += 1;
    }
  }
  return n > 0 ? Math.exp(sumLn / n) : null;
}

async function collectRandomAccessSummary(
  charts: readonly { readonly name: string }[],
): Promise<Summary | null> {
  // Scan the group's chart links in order; the first chart with valid rows at
  // its latest commit wins (matching the Rust early-return loop).
  const text = `
    SELECT r.format AS name, r.value_ns::float8 AS value
      FROM random_access_times r
      JOIN commits c USING (commit_sha)
     WHERE r.dataset = $1
       AND r.value_ns > 0
       AND c.timestamp = (
            SELECT MAX(c2.timestamp)
              FROM random_access_times r2
              JOIN commits c2 USING (commit_sha)
             WHERE r2.dataset = $2
               AND r2.value_ns > 0
       )
     ORDER BY r.value_ns, r.format
  `;
  for (const chart of charts) {
    const rows = (
      await getPool().query<{ name: string; value: number }>(text, [chart.name, chart.name])
    ).rows;
    const rankings: RandomAccessRanking[] = rows.map((row) => ({
      name: row.name,
      time: row.value,
      ratio: 0,
    }));
    if (rankings.length === 0) {
      continue;
    }
    // Streaming min (loop, not a `Math.min(...)` spread) for consistency with
    // `collectCompressionSizeSummary` and to avoid a large-array call-argument
    // cliff; the Rust source uses `reduce(f64::min)` here.
    let minTime = Infinity;
    for (const r of rankings) {
      minTime = Math.min(minTime, r.time);
    }
    if (minTime <= 0 || !Number.isFinite(minTime)) {
      continue;
    }
    for (const r of rankings) {
      r.ratio = r.time / minTime;
    }
    rankings.sort((a, b) =>
      a.time < b.time ? -1 : a.time > b.time ? 1 : compareCodeUnits(a.name, b.name),
    );
    return {
      type: 'randomAccess',
      title: 'Random Access Performance',
      rankings,
      explanation: 'Random access time | Ratio to fastest (lower is better)',
    };
  }
  return null;
}

async function collectCompressionSummary(): Promise<Summary | null> {
  // Both geomeans use the latest encode timestamp. If no encode pair exists,
  // they use the latest decode timestamp. SQL preserves sub-second precision.
  const rows = await compressionSamples();
  const grouped = new Map<
    string,
    {
      name: string;
      operation: 'encode' | 'decode';
      ratios: number[];
      totalBytes: number;
      totalNs: number;
    }
  >();
  for (const row of rows) {
    if (row.op !== 'encode' && row.op !== 'decode') {
      continue;
    }
    const key = `${row.op}:${row.format}`;
    const aggregate = grouped.get(key) ?? {
      name: row.format,
      operation: row.op,
      ratios: [],
      totalBytes: 0,
      totalNs: 0,
    };
    aggregate.ratios.push(row.parquetNs / row.valueNs);
    if (row.basisBytes !== null && row.basisBytes > 0 && Number.isFinite(row.basisBytes)) {
      aggregate.totalBytes += row.basisBytes;
      aggregate.totalNs += row.valueNs;
    }
    grouped.set(key, aggregate);
  }
  const rankings: CompressionRanking[] = [];
  for (const aggregate of grouped.values()) {
    const ratio = geoMean(aggregate.ratios);
    if (ratio === null) {
      continue;
    }
    const ranking: CompressionRanking = {
      name: aggregate.name,
      operation: aggregate.operation,
      ratio,
    };
    if (aggregate.totalBytes > 0 && aggregate.totalNs > 0) {
      // One byte per nanosecond equals one decimal gigabyte per second.
      ranking.throughputGbS = aggregate.totalBytes / aggregate.totalNs;
    }
    rankings.push(ranking);
  }
  const operationRank = (op: 'encode' | 'decode'): number => (op === 'encode' ? 0 : 1);
  rankings.sort((a, b) => {
    const byOperation = operationRank(a.operation) - operationRank(b.operation);
    if (byOperation !== 0) {
      return byOperation;
    }
    return b.ratio - a.ratio || compareCodeUnits(a.name, b.name);
  });
  if (rankings.length === 0) {
    return null;
  }
  return {
    type: 'compression',
    title: 'Compression Throughput',
    rankings,
    explanation: 'Geomean throughput ratio to Parquet | Aggregate throughput (higher is better)',
  };
}

/**
 * Regularly benchmarked formats use the newest complete Vortex snapshot.
 * Each independently benchmarked format uses its own newest complete snapshot.
 * Every sample uses Parquet timing and size from the same commit.
 */
async function compressionSamples(): Promise<
  Array<{
    format: string;
    op: string;
    valueNs: number;
    parquetNs: number;
    basisBytes: number | null;
  }>
> {
  const text = `
    WITH pairs AS (
      SELECT t.format AS format,
             t.op AS op,
             c.timestamp AS ts,
             t.commit_sha AS commit_sha,
             t.value_ns::float8 AS value_ns,
             p.value_ns::float8 AS parquet_ns,
             t.dataset AS dataset,
             t.dataset_variant AS dataset_variant
        FROM compression_times t
        JOIN compression_times p
          ON p.commit_sha = t.commit_sha
         AND p.dataset = t.dataset
         AND p.dataset_variant IS NOT DISTINCT FROM t.dataset_variant
         AND p.op = t.op
        JOIN commits c ON c.commit_sha = t.commit_sha
       WHERE t.op IN ('encode', 'decode')
         AND t.format = ANY($1::text[])
         AND p.format = $4
         AND t.value_ns > 0
         AND p.value_ns > 0
         AND lower(t.dataset) NOT LIKE '%wide table%'
    ), snapshot_policy AS (
      SELECT format,
             CASE WHEN format = ANY($2::text[]) THEN $3 ELSE format END AS anchor_format
        FROM unnest($1::text[]) AS configured(format)
    ), snapshot_commits AS (
      SELECT policy.anchor_format, pairs.op, pairs.ts, pairs.commit_sha
        FROM (SELECT DISTINCT anchor_format FROM snapshot_policy) policy
        JOIN pairs ON pairs.format = policy.anchor_format
       GROUP BY policy.anchor_format, pairs.op, pairs.ts, pairs.commit_sha
    ), latest_snapshots AS (
      SELECT DISTINCT ON (anchor_format) anchor_format, commit_sha
        FROM snapshot_commits
       ORDER BY anchor_format,
                CASE WHEN op = 'encode' THEN 0 ELSE 1 END,
                ts DESC, commit_sha DESC
    ), selected AS (
      SELECT pairs.format, pairs.op, pairs.commit_sha, pairs.value_ns,
             pairs.parquet_ns, pairs.dataset, pairs.dataset_variant
        FROM pairs
        JOIN snapshot_policy policy ON policy.format = pairs.format
        JOIN latest_snapshots latest
          ON latest.anchor_format = policy.anchor_format
         AND latest.commit_sha = pairs.commit_sha
    )
    SELECT selected.format AS format,
           selected.op AS op,
           selected.value_ns AS "valueNs",
           selected.parquet_ns AS "parquetNs",
           s.value_bytes::float8 AS "basisBytes"
      FROM selected
      LEFT JOIN compression_sizes s
        ON s.commit_sha = selected.commit_sha
       AND s.dataset = selected.dataset
       AND s.dataset_variant IS NOT DISTINCT FROM selected.dataset_variant
       AND s.format = $4
       AND s.value_bytes > 0
     ORDER BY selected.op, selected.format, selected.dataset,
              selected.dataset_variant NULLS FIRST
  `;
  return (
    await getPool().query<{
      format: string;
      op: string;
      valueNs: number;
      parquetNs: number;
      basisBytes: number | null;
    }>(text, compressionSummaryQueryParams())
  ).rows;
}

async function collectCompressionSizeSummary(): Promise<Summary | null> {
  const rows = await compressionSizeSamples();
  const grouped = new Map<string, { ratios: number[]; totalBytes: number }>();
  for (const row of rows) {
    const aggregate = grouped.get(row.format) ?? { ratios: [], totalBytes: 0 };
    aggregate.ratios.push(row.valueBytes / row.parquetBytes);
    aggregate.totalBytes += row.valueBytes;
    grouped.set(row.format, aggregate);
  }
  const rankings: CompressionSizeRanking[] = [];
  for (const [name, aggregate] of grouped) {
    const ratio = geoMean(aggregate.ratios);
    if (ratio !== null) {
      rankings.push({ name, ratio, totalBytes: aggregate.totalBytes });
    }
  }
  rankings.sort((a, b) => a.ratio - b.ratio || compareCodeUnits(a.name, b.name));
  if (rankings.length === 0) {
    return null;
  }
  return {
    type: 'compressionSize',
    title: 'Compression Size Summary',
    rankings,
    explanation: 'Geomean size ratio to Parquet | Total compressed size (lower is better)',
  };
}

/**
 * Regularly benchmarked formats use the newest complete Vortex snapshot.
 * Each independently benchmarked format uses its own newest complete snapshot
 * and compares it with Parquet from the same commit.
 */
async function compressionSizeSamples(): Promise<
  Array<{ format: string; valueBytes: number; parquetBytes: number }>
> {
  const text = `
    WITH pairs AS (
      SELECT s.format AS format,
             c.timestamp AS ts,
             s.commit_sha AS commit_sha,
             s.value_bytes::float8 AS value_bytes,
             p.value_bytes::float8 AS parquet_bytes,
             s.dataset AS dataset,
             s.dataset_variant AS dataset_variant
        FROM compression_sizes s
        JOIN compression_sizes p
          ON p.commit_sha = s.commit_sha
         AND p.dataset = s.dataset
         AND p.dataset_variant IS NOT DISTINCT FROM s.dataset_variant
        JOIN commits c ON c.commit_sha = s.commit_sha
       WHERE s.format = ANY($1::text[])
         AND p.format = $4
         AND s.value_bytes > 0
         AND p.value_bytes > 0
         AND lower(s.dataset) NOT LIKE '%wide table%'
    ), snapshot_policy AS (
      SELECT format,
             CASE WHEN format = ANY($2::text[]) THEN $3 ELSE format END AS anchor_format
        FROM unnest($1::text[]) AS configured(format)
    ), snapshot_commits AS (
      SELECT policy.anchor_format, pairs.ts, pairs.commit_sha
        FROM (SELECT DISTINCT anchor_format FROM snapshot_policy) policy
        JOIN pairs ON pairs.format = policy.anchor_format
       GROUP BY policy.anchor_format, pairs.ts, pairs.commit_sha
    ), latest_snapshots AS (
      SELECT DISTINCT ON (anchor_format) anchor_format, commit_sha
        FROM snapshot_commits
       ORDER BY anchor_format, ts DESC, commit_sha DESC
    ), selected AS (
      SELECT pairs.format, pairs.value_bytes, pairs.parquet_bytes,
             pairs.dataset, pairs.dataset_variant
        FROM pairs
        JOIN snapshot_policy policy ON policy.format = pairs.format
        JOIN latest_snapshots latest
          ON latest.anchor_format = policy.anchor_format
         AND latest.commit_sha = pairs.commit_sha
    )
    SELECT selected.format AS format,
           selected.value_bytes AS "valueBytes",
           selected.parquet_bytes AS "parquetBytes"
      FROM selected
     ORDER BY selected.format, selected.dataset, selected.dataset_variant NULLS FIRST
  `;
  return (
    await getPool().query<{ format: string; valueBytes: number; parquetBytes: number }>(
      text,
      compressionSummaryQueryParams(),
    )
  ).rows;
}

async function collectQuerySummary(
  dataset: string,
  datasetVariant: string | null,
  scaleFactor: string | null,
  storage: string,
): Promise<Summary | null> {
  // Latest value per (query_idx, engine, format), then v2's missing-series
  // penalty model: each series scores the geomean of `(10 + value) / (10 +
  // best)` over every query, imputing a penalty where the series has no value.
  //
  // "Latest per series" is a recursive-CTE skip scan (loose index scan) over the
  // covering index `idx_query_measurements_summary` (dataset, dataset_variant,
  // scale_factor, storage, query_idx, engine, format, commit_timestamp DESC)
  // INCLUDE (value_ns) from migrations 006/007 (PR-5.1.5 fix c). Those
  // migrations' in-file rationale describes the interim `DISTINCT ON` consumer
  // and predates the cold-render decision that shipped this skip scan; the
  // files are frozen post-apply, so this comment (and migrations/README.md) is
  // the current record. The previous
  // `DISTINCT ON (query_idx, engine, format) ... ORDER BY commit_timestamp DESC
  // NULLS LAST` form scanned the group's entire history (~1.8M index entries,
  // ~2.4s warm for tpcds at the prod seed); the skip scan instead does one
  // O(log n) index descent per distinct series tuple plus one per series for its
  // latest value (~1.3K descents, ~20ms), which is what makes the cache-cold
  // `/api/groups` render fast.
  //
  // Three non-obvious constructions keep every probe a pure index descent:
  //
  //  - The successor probe cannot be a single row comparison
  //    `(query_idx, engine, format) > (...)`: a row comparison is only a btree
  //    index qual when its first column is the index's FIRST column, and these
  //    are index columns 5-7 (the planner degrades the row form to a filter over
  //    a full scan). It is instead three single-column-inequality branches (next
  //    format within the series' query_idx+engine, then next engine within its
  //    query_idx, then next query_idx), each fully index-sargable. The branches
  //    partition the tuples greater than the current series (every qualifying
  //    row satisfies exactly one branch, and all of branch N's rows precede all
  //    of branch N+1's rows in tuple order), so the successor is the row from
  //    the lowest-numbered non-empty branch. Each branch carries a constant
  //    `br` ordinal and the union is selected via `ORDER BY br LIMIT 1`, which
  //    makes that choice a SQL-guaranteed ordering rather than a reliance on
  //    Append evaluating `UNION ALL` arms in syntactic order (which Postgres
  //    does today but does not document). The ordinal sort costs at most one
  //    extra single-row descent per branch per step (~1.5x measured), not the
  //    full-scan cliff the skip scan exists to avoid.
  //
  //  - Every probe's ORDER BY spells out the full index prefix (dataset,
  //    dataset_variant, scale_factor, storage, ...) even though those columns
  //    are pinned by the WHERE. An `IS NULL` pin (NULL-variant/scale groups)
  //    does not join the planner's equivalence classes, so with the short
  //    `ORDER BY query_idx, engine, format` form the planner cannot prove the
  //    index already provides the order and inserts a Sort over the whole
  //    group. The pinned columns are constant per group, so the long form is
  //    semantically identical.
  //
  //  - "Latest" must order `commit_timestamp DESC NULLS LAST` (a transient NULL
  //    -- a row from a writer not yet populating `commit_timestamp`, before the
  //    post-deploy re-backfill -- must not win over real timestamps), but the
  //    index is `commit_timestamp DESC`, i.e. NULLS FIRST, so that order is not
  //    index-provided. The per-series latest probe therefore takes the newest
  //    `commit_timestamp IS NOT NULL` row first (index-ordered descent past the
  //    NULL block, ordinal 1) and falls back to the NULL-timestamp rows
  //    (ordinal 2) only when the series has no timestamped rows; the two
  //    branches are selected via the same `ORDER BY br LIMIT 1` guarantee as
  //    the successor probe. The fallback branch joins `commits` and orders by
  //    `c.timestamp DESC NULLS LAST` so an all-unstamped series (one ingested
  //    entirely inside the transient window) still returns its NEWEST value,
  //    matching the replaced join-ordered query, rather than an arbitrary row.
  //    The join is LEFT so an orphan row whose commit_sha has no commits row
  //    -- impossible unless a writer violates the commits-upsert-first
  //    invariant -- still surfaces (last) instead of vanishing as it did under
  //    the old INNER JOIN; fail-visible is preferred. The fallback's join cost
  //    is irrelevant: it executes only for series with zero stamped rows.
  //
  // The `value_ns > 0` filter rides inside every probe: it is read from the
  // index leaf (INCLUDE), so the enumeration lands directly on series that have
  // at least one valid row, the same set `DISTINCT ON` produced. The timestamp
  // value is the same `commits.timestamp` the original join used, so the
  // same-second-tie behavior (an accepted tradeoff) is unchanged. `$1` =
  // dataset, `$2` = storage; variant/scale params append only when non-null.
  const params: unknown[] = [dataset, storage];
  const variantPred =
    datasetVariant === null
      ? 'q.dataset_variant IS NULL'
      : `q.dataset_variant = $${params.push(datasetVariant)}`;
  const scalePred =
    scaleFactor === null
      ? 'q.scale_factor IS NULL'
      : `q.scale_factor = $${params.push(scaleFactor)}`;
  const groupPred = `q.dataset = $1
           AND ${variantPred}
           AND ${scalePred}
           AND q.storage = $2`;
  const indexOrder =
    'q.dataset, q.dataset_variant, q.scale_factor, q.storage, q.query_idx, q.engine, q.format';
  const text = `
    WITH RECURSIVE series AS (
      (SELECT q.query_idx, q.engine, q.format
         FROM query_measurements q
        WHERE ${groupPred}
          AND q.value_ns > 0
        ORDER BY ${indexOrder}
        LIMIT 1)
      UNION ALL
      SELECT nxt.query_idx, nxt.engine, nxt.format
        FROM series s
        CROSS JOIN LATERAL (
          (SELECT 1 AS br, q.query_idx, q.engine, q.format
             FROM query_measurements q
            WHERE ${groupPred}
              AND q.query_idx = s.query_idx
              AND q.engine = s.engine
              AND q.format > s.format
              AND q.value_ns > 0
            ORDER BY ${indexOrder}
            LIMIT 1)
          UNION ALL
          (SELECT 2 AS br, q.query_idx, q.engine, q.format
             FROM query_measurements q
            WHERE ${groupPred}
              AND q.query_idx = s.query_idx
              AND q.engine > s.engine
              AND q.value_ns > 0
            ORDER BY ${indexOrder}
            LIMIT 1)
          UNION ALL
          (SELECT 3 AS br, q.query_idx, q.engine, q.format
             FROM query_measurements q
            WHERE ${groupPred}
              AND q.query_idx > s.query_idx
              AND q.value_ns > 0
            ORDER BY ${indexOrder}
            LIMIT 1)
          ORDER BY br
          LIMIT 1
        ) nxt
    )
    SELECT s.query_idx AS query_idx,
           s.engine || ':' || s.format AS series,
           latest.value_ns AS value_ns
      FROM series s
      CROSS JOIN LATERAL (
        (SELECT 1 AS br, q.value_ns::float8 AS value_ns
           FROM query_measurements q
          WHERE ${groupPred}
            AND q.query_idx = s.query_idx
            AND q.engine = s.engine
            AND q.format = s.format
            AND q.value_ns > 0
            AND q.commit_timestamp IS NOT NULL
          ORDER BY ${indexOrder}, q.commit_timestamp DESC
          LIMIT 1)
        UNION ALL
        (SELECT 2 AS br, q.value_ns::float8 AS value_ns
           FROM query_measurements q
           LEFT JOIN commits c ON c.commit_sha = q.commit_sha
          WHERE ${groupPred}
            AND q.query_idx = s.query_idx
            AND q.engine = s.engine
            AND q.format = s.format
            AND q.value_ns > 0
            AND q.commit_timestamp IS NULL
          ORDER BY c.timestamp DESC NULLS LAST
          LIMIT 1)
        ORDER BY br
        LIMIT 1
      ) latest
     ORDER BY s.query_idx, s.engine || ':' || s.format
  `;
  const rows = (
    await getPool().query<{ query_idx: number; series: string; value_ns: number }>(text, params)
  ).rows;

  const queries = new Set<number>();
  const valuesBySeries = new Map<string, Map<number, number>>();
  for (const row of rows) {
    queries.add(row.query_idx);
    let series = valuesBySeries.get(row.series);
    if (series === undefined) {
      series = new Map<number, number>();
      valuesBySeries.set(row.series, series);
    }
    series.set(row.query_idx, row.value_ns);
  }
  if (valuesBySeries.size === 0) {
    return null;
  }

  // Sorted query indices match the Rust `BTreeSet<i32>` iteration order.
  const sortedQueries = [...queries].sort((a, b) => a - b);
  const bestByQuery = new Map<number, number>();
  for (const queryIdx of sortedQueries) {
    let best = Infinity;
    for (const series of valuesBySeries.values()) {
      const value = series.get(queryIdx);
      if (value !== undefined && value < best) {
        best = value;
      }
    }
    if (Number.isFinite(best)) {
      bestByQuery.set(queryIdx, best);
    }
  }

  const rankings: QueryRanking[] = [];
  // Sorted series keys match the Rust `BTreeMap<String, _>` iteration order.
  for (const name of [...valuesBySeries.keys()].sort(compareCodeUnits)) {
    const queryValues = valuesBySeries.get(name);
    if (queryValues === undefined) {
      continue;
    }
    let totalRuntime = 0;
    for (const queryIdx of [...queryValues.keys()].sort((a, b) => a - b)) {
      totalRuntime += queryValues.get(queryIdx) ?? 0;
    }
    let maxRuntime = -Infinity;
    for (const value of queryValues.values()) {
      if (value > maxRuntime) {
        maxRuntime = value;
      }
    }
    if (!Number.isFinite(maxRuntime)) {
      continue;
    }
    const penalty = Math.max(maxRuntime, 300_000) * 2;
    const ratios: number[] = [];
    for (const queryIdx of sortedQueries) {
      const base = bestByQuery.get(queryIdx);
      if (base === undefined) {
        continue;
      }
      const value = queryValues.get(queryIdx) ?? penalty;
      ratios.push((10 + value) / (10 + base));
    }
    const score = geoMean(ratios);
    if (score === null) {
      continue;
    }
    rankings.push({ name, score, totalRuntime });
  }
  rankings.sort((a, b) =>
    a.score < b.score ? -1 : a.score > b.score ? 1 : compareCodeUnits(a.name, b.name),
  );

  if (rankings.length === 0) {
    return null;
  }
  return {
    type: 'queryBenchmark',
    title: 'Performance Summary',
    rankings,
    explanation: 'Geomean of query time ratio to fastest (lower is better)',
  };
}
