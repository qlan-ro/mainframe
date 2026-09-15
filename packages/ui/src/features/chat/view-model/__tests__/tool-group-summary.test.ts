/**
 * toolGroupSummary — behavior tests. Previously exercised only indirectly
 * through convert-message.test.ts's groupSummaries describe block (deleted
 * with that file in the desktop-cutover pass); this is its first direct
 * unit-test coverage.
 */
import { describe, it, expect } from 'vitest';
import { toolGroupSummary } from '../tool-group-summary';

function names(...toolNames: string[]) {
  return toolNames.map((toolName) => ({ toolName }));
}

describe('toolGroupSummary', () => {
  it('singularizes a single Read', () => {
    expect(toolGroupSummary(names('Read'))).toBe('Read 1 file');
  });

  it('pluralizes multiple Reads, counting NotebookRead the same as Read', () => {
    expect(toolGroupSummary(names('Read', 'NotebookRead'))).toBe('Read 2 files');
  });

  it('summarizes a mixed Read+Grep group with a middle dot separator, reads first', () => {
    expect(toolGroupSummary(names('Read', 'Read', 'Grep'))).toBe('Read 2 files · Searched 1 pattern');
  });

  it('summarizes Glob and LS together', () => {
    expect(toolGroupSummary(names('Glob', 'LS'))).toBe('Globbed 1 pattern · Listed 1 directory');
  });

  it('pluralizes Searched/Globbed/Listed', () => {
    expect(toolGroupSummary(names('Grep', 'Grep', 'Glob', 'Glob', 'LS', 'LS'))).toBe(
      'Searched 2 patterns · Globbed 2 patterns · Listed 2 directories',
    );
  });

  it('counts unrecognized tool names as a trailing "N tools" bucket', () => {
    expect(toolGroupSummary(names('Read', 'Bash', 'Write'))).toBe('Read 1 file · 2 tools');
  });

  it('singularizes the fallback bucket for exactly one unrecognized tool', () => {
    expect(toolGroupSummary(names('Bash'))).toBe('1 tool');
  });

  it('falls back to "N tool calls" when every recognized-kind count is zero and there are no items', () => {
    expect(toolGroupSummary([])).toBe('0 tool calls');
  });

  it('orders categories Read, Searched, Globbed, Listed, other regardless of input order', () => {
    expect(toolGroupSummary(names('Bash', 'LS', 'Glob', 'Grep', 'Read'))).toBe(
      'Read 1 file · Searched 1 pattern · Globbed 1 pattern · Listed 1 directory · 1 tool',
    );
  });
});
