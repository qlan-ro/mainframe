import { describe, it, expect } from 'vitest';
import { appendCapturesToAttachments } from '../MainframeRuntimeProvider.js';
import { SANDBOX_CAPTURE_SENTINEL } from '../../../../lib/format-captures.js';

describe('appendCapturesToAttachments (delegates to formatCaptures)', () => {
  it('returns sentinel markdown and pushes named attachments', () => {
    const out: { name: string; data: string }[] = [];
    const ret = appendCapturesToAttachments(
      [
        { id: 'a', type: 'element', imageDataUrl: 'data:image/png;base64,QUJD', selector: 'div > h2' },
        { id: 'b', type: 'screenshot', imageDataUrl: 'data:image/png;base64,QUJD', annotation: 'hi' },
      ] as never,
      out as never,
    );
    expect(ret.startsWith(SANDBOX_CAPTURE_SENTINEL)).toBe(true);
    expect(ret).toContain('> - `element1` — selector `div > h2`');
    expect(ret).toContain('> - `screenshot1` — "hi"');
    expect(ret.endsWith('\n\n')).toBe(true);
    expect(out.map((o) => o.name)).toEqual(['element1.png', 'screenshot1.png']);
  });
  it('returns empty string and pushes nothing for no captures', () => {
    const out: unknown[] = [];
    expect(appendCapturesToAttachments([] as never, out as never)).toBe('');
    expect(out).toHaveLength(0);
  });
});
