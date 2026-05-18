import { describe, it, expect } from 'vitest';
import { truncateToolContent, TRUNCATE_THRESHOLD_BYTES } from '../truncate-tool-content.js';

describe('truncateToolContent', () => {
  it('returns content unchanged below threshold, no flag', () => {
    const small = 'line\n'.repeat(10);
    const r = truncateToolContent(small);
    expect(r.truncated).toBe(false);
    expect(r.content).toBe(small);
    expect(r.fullBytes).toBeUndefined();
  });

  it('truncates above threshold to head 100 + marker + tail 100', () => {
    const big = Array.from({ length: 5000 }, (_, i) => `row ${i}`).join('\n');
    expect(Buffer.byteLength(big, 'utf8')).toBeGreaterThan(TRUNCATE_THRESHOLD_BYTES);
    const r = truncateToolContent(big);
    expect(r.truncated).toBe(true);
    expect(r.fullBytes).toBe(Buffer.byteLength(big, 'utf8'));
    const lines = r.content.split('\n');
    expect(lines[0]).toBe('row 0');
    expect(lines[99]).toBe('row 99');
    expect(r.content).toContain('truncated');
    expect(lines[lines.length - 1]).toBe('row 4999');
    expect(lines[lines.length - 100]).toBe('row 4900');
  });

  it('treats a string just over the byte threshold as truncated', () => {
    const justOver = 'x'.repeat(TRUNCATE_THRESHOLD_BYTES + 1);
    expect(truncateToolContent(justOver).truncated).toBe(true);
  });

  it('treats a string exactly at the threshold as untruncated', () => {
    const exact = 'x'.repeat(TRUNCATE_THRESHOLD_BYTES);
    expect(truncateToolContent(exact).truncated).toBe(false);
  });
});
