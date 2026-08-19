// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright the Vortex contributors

import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { SummaryCard } from '@/components/SummaryCard';
import type { Summary } from '@/lib/summary';

function render(summary?: Summary): string {
  return renderToStaticMarkup(<SummaryCard summary={summary} />);
}

describe('SummaryCard', () => {
  it('renders nothing when there is no summary', () => {
    expect(render(undefined)).toBe('');
  });

  it('renders a randomAccess card with ranks, ns times, and ratios', () => {
    const html = render({
      type: 'randomAccess',
      title: 'Random Access Performance',
      rankings: [
        { name: 'vortex', time: 1_500_000, ratio: 1 },
        { name: 'parquet', time: 3_000_000, ratio: 2 },
      ],
      explanation: 'Random access time | Ratio to fastest (lower is better)',
    });
    expect(html).toContain('class="benchmark-scores-summary"');
    expect(html).toContain('<h3 class="scores-title">Random Access Performance</h3>');
    expect(html).toContain('#1');
    expect(html).toContain('vortex');
    expect(html).toContain('1.50 ms');
    expect(html).toContain('1.00x');
    expect(html).toContain('#2');
    expect(html).toContain('parquet');
    expect(html).toContain('3.00 ms');
    expect(html).toContain('2.00x');
    expect(html).toContain('Random access time | Ratio to fastest (lower is better)');
  });

  it('renders nothing for a randomAccess card with no rankings', () => {
    expect(render({ type: 'randomAccess', title: 't', rankings: [], explanation: 'e' })).toBe('');
  });

  it('renders compression rankings with ratios', () => {
    const html = render({
      type: 'compression',
      title: 'Compression Throughput',
      rankings: [
        { name: 'vortex-file-compressed', operation: 'encode', ratio: 2.5 },
        { name: 'parquet', operation: 'encode', ratio: 1 },
        { name: 'lance', operation: 'encode', ratio: 0.8 },
        { name: 'vortex-file-compressed', operation: 'decode', ratio: 1.8 },
        { name: 'parquet', operation: 'decode', ratio: 1 },
        { name: 'lance', operation: 'decode', ratio: 0.6 },
      ],
      explanation: 'higher is better',
    });
    expect(html).toContain('<h3 class="scores-title">Compression Throughput</h3>');
    expect(html).toContain('<h3 class="scores-title">Decompression Throughput</h3>');
    expect(html).not.toContain('compression-scores-subtitle');
    expect(html).toContain('class="compression-scores-panel"');
    expect(html).toContain('>vortex</span>');
    expect(html).toContain('2.50x');
    expect(html).toContain('>lance</span>');
    expect(html).toContain('1.80x');
    expect(html).not.toContain('GB/s');
    expect(html.match(/#1/g)).toHaveLength(2);
  });

  it('renders nothing for a compression card with no rankings', () => {
    expect(render({ type: 'compression', title: 't', rankings: [], explanation: 'e' })).toBe('');
  });

  it('renders compression-size rankings with ratios', () => {
    const html = render({
      type: 'compressionSize',
      title: 'Compression Size Summary',
      rankings: [
        { name: 'vortex-file-compressed', ratio: 0.45 },
        { name: 'parquet', ratio: 1 },
        { name: 'lance', ratio: 1.2 },
      ],
      explanation: 'lower is better',
    });
    expect(html).toContain('0.45x');
    expect(html).toContain('parquet');
    expect(html).toContain('1.00x');
    expect(html).toContain('lance');
    expect(html).toContain('1.20x');
    expect(html).not.toContain('GB');
  });

  it('renders a queryBenchmark card with scores and total runtimes', () => {
    const html = render({
      type: 'queryBenchmark',
      title: 'Performance Summary',
      rankings: [{ name: 'vortex:vortex-file', score: 1.0, totalRuntime: 5_000_000_000 }],
      explanation: 'lower is better',
    });
    expect(html).toContain('#1');
    expect(html).toContain('vortex:vortex-file');
    expect(html).toContain('1.00x');
    expect(html).toContain('5.00 s');
  });
});
