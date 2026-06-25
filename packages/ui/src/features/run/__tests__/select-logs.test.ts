/**
 * select-logs — unit tests for the pure log-filter selector.
 *
 * Behaviors covered:
 *  - Filters by scopeKey AND process name, returning only exact matches.
 *  - Returns an empty array when nothing matches.
 *  - Returns all matching entries when multiple items share the same scope+name.
 */
import { it, expect, describe } from 'vitest';
import { selectLogs } from '../select-logs';
import type { LogEntry } from '@/store/sandbox';

const logs: LogEntry[] = [
  { seq: 1, scopeKey: 'p:/a', name: 'dev', data: 'one', stream: 'stdout' },
  { seq: 2, scopeKey: 'p:/a', name: 'api', data: 'two', stream: 'stderr' },
  { seq: 3, scopeKey: 'p:/b', name: 'dev', data: 'three', stream: 'stdout' },
];

describe('selectLogs', () => {
  it('filters by scope and process name', () => {
    expect(selectLogs(logs, 'p:/a', 'dev').map((l) => l.data)).toEqual(['one']);
  });

  it('returns empty when nothing matches the scope', () => {
    expect(selectLogs(logs, 'p:/z', 'dev')).toEqual([]);
  });

  it('returns empty when scope matches but name does not', () => {
    expect(selectLogs(logs, 'p:/a', 'notexist')).toEqual([]);
  });

  it('returns multiple entries when several match', () => {
    const many: LogEntry[] = [
      { seq: 10, scopeKey: 'p:/a', name: 'dev', data: 'line1', stream: 'stdout' },
      { seq: 11, scopeKey: 'p:/a', name: 'dev', data: 'line2', stream: 'stderr' },
      { seq: 12, scopeKey: 'p:/a', name: 'other', data: 'skip', stream: 'stdout' },
    ];
    const result = selectLogs(many, 'p:/a', 'dev');
    expect(result).toHaveLength(2);
    expect(result.map((l) => l.data)).toEqual(['line1', 'line2']);
  });
});
