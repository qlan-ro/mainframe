// packages/core/src/plugins/builtin/codex/__tests__/history.test.ts
//
// Tests for `convertThreadItems` — the chat-reload code path. Specifically
// covers the userMessage-shape variants Codex returns from `thread/read` vs
// the rollout JSONL files.

import { describe, it, expect } from 'vitest';
import { convertThreadItems } from '../history.js';
import type { ThreadItem } from '../types.js';

describe('convertThreadItems — userMessage shapes', () => {
  it('extracts text from content[0].text (the thread/read shape)', () => {
    const items = [
      { id: 'm1', type: 'userMessage', content: [{ type: 'text', text: 'hello there' }] },
    ] as unknown as ThreadItem[];
    const out = convertThreadItems(items, 'chat1');
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ type: 'user', content: [{ type: 'text', text: 'hello there' }] });
  });

  it('also accepts the rollout JSONL shape: content uses input_text', () => {
    const items = [
      { id: 'm1', type: 'userMessage', content: [{ type: 'input_text', text: 'from rollout' }] },
    ] as unknown as ThreadItem[];
    const out = convertThreadItems(items, 'chat1');
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ type: 'user', content: [{ type: 'text', text: 'from rollout' }] });
  });

  it('falls back to the legacy top-level item.text', () => {
    const items = [{ id: 'm1', type: 'userMessage', text: 'legacy' }] as unknown as ThreadItem[];
    const out = convertThreadItems(items, 'chat1');
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ type: 'user', content: [{ type: 'text', text: 'legacy' }] });
  });

  it('skips userMessage items with no usable text', () => {
    const items = [
      { id: 'm1', type: 'userMessage', content: [{ type: 'text', text: '' }] },
      { id: 'm2', type: 'userMessage' },
    ] as unknown as ThreadItem[];
    const out = convertThreadItems(items, 'chat1');
    expect(out).toHaveLength(0);
  });
});
