// packages/core/src/plugins/builtin/codex/__tests__/history.test.ts
//
// Tests for `convertThreadItems` — the chat-reload code path. Specifically
// covers the userMessage-shape variants Codex returns from `thread/read` vs
// the rollout JSONL files.

import { describe, it, expect } from 'vitest';
import { convertThreadItems } from '../history.js';
import type { ThreadItem } from '../types.js';
import type { UserMessageItem, AgentMessageItem, CommandExecutionItem, FileChangeItem } from '../item-types.js';

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

// ---------------------------------------------------------------------------
// Representative fixture shared across determinism tests.
//
// Item counts → expected message counts:
//   userMessage  (u1)  → 1 message
//   agentMessage (a1)  → 1 message
//   commandExec  (c1)  → 2 messages (tool_use + tool_result)
//   fileChange   (f1)  → 2 messages (tool_use + tool_result, one change)
//   total             → 6 messages
// ---------------------------------------------------------------------------
const baseItems: ThreadItem[] = [
  {
    id: 'u1',
    type: 'userMessage',
    content: [{ type: 'text', text: 'test message' }],
  } satisfies UserMessageItem,
  {
    id: 'a1',
    type: 'agentMessage',
    text: 'hi',
    phase: null,
  } satisfies AgentMessageItem,
  {
    id: 'c1',
    type: 'commandExecution',
    command: 'ls',
    aggregatedOutput: 'out',
    exitCode: 0,
    status: 'completed',
  } satisfies CommandExecutionItem,
  {
    id: 'f1',
    type: 'fileChange',
    status: 'completed',
    changes: [{ path: 'x.ts', kind: { type: 'add' }, diff: '+hello\n' }],
  } satisfies FileChangeItem,
];

describe('convertThreadItems — stable/deterministic ids', () => {
  it('produces identical message ids on repeated reconstructions of the same items [EXPECTED FAIL — TDD red]', () => {
    const a = convertThreadItems(baseItems, 'chat1').map((m) => m.id);
    const b = convertThreadItems(baseItems, 'chat1').map((m) => m.id);
    expect(a).toEqual(b);
  });

  it('all ids are unique within one reconstruction (no collision)', () => {
    const ids = convertThreadItems(baseItems, 'chat1').map((m) => m.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('appending an item preserves the ids of the original messages as a stable prefix [EXPECTED FAIL — TDD red]', () => {
    const extraItem: AgentMessageItem = {
      id: 'a2',
      type: 'agentMessage',
      text: 'more',
      phase: null,
    };

    const base = convertThreadItems(baseItems, 'chat1').map((m) => m.id);
    const withExtra = convertThreadItems([...baseItems, extraItem], 'chat1').map((m) => m.id);

    // The ids for the original items must be identical — only the new item's ids differ.
    expect(withExtra.slice(0, base.length)).toEqual(base);
  });
});
