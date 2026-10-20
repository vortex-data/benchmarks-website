// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright the Vortex contributors

/**
 * Storage split for the random-access family.
 *
 * `random_access_time` records carry no storage field, so the producer
 * (`benchmarks/random-access-bench`) keeps S3 runs apart by suffixing the
 * dataset with `-s3` (`taxi-s3/uniform`, next to the NVMe `taxi/uniform`).
 * The site reads that suffix back to render one random-access group per
 * storage backend.
 */

export type RandomAccessStorage = 'nvme' | 's3';

export const RANDOM_ACCESS_STORAGES: readonly RandomAccessStorage[] = ['nvme', 's3'];

const S3_SUFFIX = '-s3';

function splitDataset(dataset: string): [string, string] {
  const separator = dataset.indexOf('/');
  return separator === -1 ? [dataset, ''] : [dataset.slice(0, separator), dataset.slice(separator)];
}

/** The storage backend a random-access `dataset` value was measured on. */
export function randomAccessStorage(dataset: string): RandomAccessStorage {
  return splitDataset(dataset)[0].endsWith(S3_SUFFIX) ? 's3' : 'nvme';
}

/** The chart label inside its storage group: the dataset without the `-s3` suffix. */
export function randomAccessChartName(dataset: string): string {
  const [base, rest] = splitDataset(dataset);
  return base.endsWith(S3_SUFFIX) ? base.slice(0, -S3_SUFFIX.length) + rest : dataset;
}

/** Display name of the random-access group for one storage backend. */
export function randomAccessGroupName(storage: string): string {
  return `Random Access (${storage === 's3' ? 'S3' : 'NVMe'})`;
}
