// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright the Vortex contributors

import { displayFormat, displaySeriesLabel } from '@/lib/chart-format';
import { formatTimeNs } from '@/lib/format';
import type { Summary } from '@/lib/summary';

/**
 * The per-group summary card.
 *
 * Every [`Summary`] variant renders the same `.benchmark-scores-summary` shape
 * (a `.scores-title`, a `.scores-list` of `.score-item` rows, and a
 * `.scores-explanation` footer); only the rank label, value, and optional
 * runtime change. The card stays visible whether or not the enclosing group is
 * expanded (the CSS only hides `.chart-grid` when the disclosure is closed), so
 * the at-a-glance rankings show without expanding the group.
 *
 * Returns `null` when there is no summary or the variant has no content.
 */
export function SummaryCard({ summary }: { summary?: Summary }) {
  if (summary === undefined) {
    return null;
  }
  switch (summary.type) {
    case 'randomAccess':
      if (summary.rankings.length === 0) {
        return null;
      }
      return (
        <section className="benchmark-scores-summary" aria-label={summary.title}>
          <h3 className="scores-title">{summary.title}</h3>
          <div className="scores-list">
            {summary.rankings.map((item, idx) => (
              <div className="score-item" key={item.name}>
                <span className="score-rank">#{idx + 1}</span>
                <span className="score-series" title={displaySeriesLabel(item.name)}>
                  {displaySeriesLabel(item.name)}
                </span>
                <span className="score-metrics">
                  <span className="score-value">{formatTimeNs(item.time)}</span>
                  <span className="score-runtime">{item.ratio.toFixed(2)}x</span>
                </span>
              </div>
            ))}
          </div>
          <div className="scores-explanation">{summary.explanation}</div>
        </section>
      );
    case 'compression': {
      if (summary.rankings.length === 0) {
        return null;
      }
      const operationPanels = [
        { operation: 'encode' as const, title: summary.title },
        { operation: 'decode' as const, title: 'Decompression Throughput' },
      ];
      return (
        <section
          className="benchmark-scores-summary benchmark-scores-summary--compression"
          aria-label={`${summary.title} and decompression throughput`}
        >
          <div className="compression-scores">
            {operationPanels.map((panel) => {
              const rankings = summary.rankings.filter(
                (item) => item.operation === panel.operation,
              );
              if (rankings.length === 0) {
                return null;
              }
              return (
                <section className="compression-scores-panel" key={panel.operation}>
                  <h3 className="scores-title">{panel.title}</h3>
                  <div className="scores-list compression-scores-list">
                    {rankings.map((item, idx) => {
                      const label = displayFormat(item.name);
                      return (
                        <div className="score-item" key={item.name}>
                          <span className="score-rank">#{idx + 1}</span>
                          <span className="score-series" title={label}>
                            {label}
                          </span>
                          <span className="score-metrics">
                            <span className="score-value">{item.ratio.toFixed(2)}x</span>
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </section>
              );
            })}
          </div>
          <div className="scores-explanation">{summary.explanation}</div>
        </section>
      );
    }
    case 'compressionSize':
      if (summary.rankings.length === 0) {
        return null;
      }
      return (
        <section className="benchmark-scores-summary" aria-label={summary.title}>
          <h3 className="scores-title">{summary.title}</h3>
          <div className="scores-list">
            {summary.rankings.map((item, idx) => (
              <div className="score-item" key={item.name}>
                <span className="score-rank">#{idx + 1}</span>
                <span className="score-series" title={displayFormat(item.name)}>
                  {displayFormat(item.name)}
                </span>
                <span className="score-metrics">
                  <span className="score-value">{item.ratio.toFixed(2)}x</span>
                </span>
              </div>
            ))}
          </div>
          <div className="scores-explanation">{summary.explanation}</div>
        </section>
      );
    case 'queryBenchmark':
      if (summary.rankings.length === 0) {
        return null;
      }
      return (
        <section className="benchmark-scores-summary" aria-label={summary.title}>
          <h3 className="scores-title">{summary.title}</h3>
          <div className="scores-list">
            {summary.rankings.map((item, idx) => (
              <div className="score-item" key={item.name}>
                <span className="score-rank">#{idx + 1}</span>
                <span className="score-series" title={displaySeriesLabel(item.name)}>
                  {displaySeriesLabel(item.name)}
                </span>
                <span className="score-metrics">
                  <span className="score-value">{item.score.toFixed(2)}x</span>
                  <span className="score-runtime">{formatTimeNs(item.totalRuntime)}</span>
                </span>
              </div>
            ))}
          </div>
          <div className="scores-explanation">{summary.explanation}</div>
        </section>
      );
    default: {
      // Exhaustiveness guard: adding a new `Summary` variant without a render
      // arm above becomes a compile error here instead of a silently blank card.
      const exhaustive: never = summary;
      return exhaustive;
    }
  }
}
