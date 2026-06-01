import { describe, it, expect } from 'vitest';
import { toToolCallResult } from '../display-helpers.js';
import { TRUNCATE_THRESHOLD_BYTES, truncateToolContent } from '../truncate-tool-content.js';
import { extractPrFromToolResult } from '../../plugins/builtin/claude/pr-detection.js';

describe('toToolCallResult truncation', () => {
  it('flags and shrinks oversized content', () => {
    const big = 'A'.repeat(TRUNCATE_THRESHOLD_BYTES + 5000);
    const r = toToolCallResult({ type: 'tool_result', toolUseId: 'id1', content: big, isError: false });
    expect(r.truncated).toBe(true);
    expect(r.fullBytes).toBe(TRUNCATE_THRESHOLD_BYTES + 5000);
    expect(Buffer.byteLength(r.content, 'utf8')).toBeLessThan(TRUNCATE_THRESHOLD_BYTES + 5000);
  });

  it('leaves small content and structured fields intact', () => {
    const r = toToolCallResult({
      type: 'tool_result',
      toolUseId: 'id2',
      content: 'ok',
      isError: false,
      structuredPatch: [{ oldStart: 1, oldLines: 1, newStart: 1, newLines: 1, lines: ['-a', '+b'] }],
    });
    expect(r.truncated).toBeUndefined();
    expect(r.content).toBe('ok');
    expect(r.structuredPatch).toHaveLength(1);
  });

  it('ingestion PR detection runs on full content, unaffected by display truncation', () => {
    const url = 'https://github.com/acme/repo/pull/4242';
    const filler = Array.from({ length: 3000 }, (_, i) => `noise line ${i}`).join('\n');
    const huge = `${filler}\n${url}\n${filler}`;
    // Sanity: a truncated copy must NOT contain the URL...
    expect(truncateToolContent(huge).content).not.toContain('4242');
    // ...but ingestion, which reads the full string, still finds it.
    const result = extractPrFromToolResult(huge);
    expect(result).not.toBeNull();
    expect(result?.number).toBe(4242);
  });
});
