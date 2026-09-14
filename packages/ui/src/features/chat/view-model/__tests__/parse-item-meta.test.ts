/**
 * parseItemMeta — behavior tests (todo #350 plan review fixes, T31, R3.10).
 */
import { describe, expect, it, vi } from 'vitest';
import { MAINFRAME_META_NAMESPACE } from '@qlan-ro/mainframe-types';
import type { AccumulatedItem } from '../acp-item-accumulator';
import { parseItemMeta } from '../parse-item-meta';

function toolCallItem(meta: Record<string, unknown>): AccumulatedItem {
  return { kind: 'tool-call', id: 't1', content: [], meta: { [MAINFRAME_META_NAMESPACE]: meta } };
}

describe('parseItemMeta — per-field fallback', () => {
  it('one bad meta field does not drop the others', () => {
    const item = toolCallItem({ containerId: 'c1', parentToolCallId: 't1', groupId: 42 });

    const parsed = parseItemMeta(item, MAINFRAME_META_NAMESPACE);

    expect(parsed.containerId).toBe('c1');
    expect(parsed.parentToolCallId).toBe('t1');
    expect(parsed.groupId).toBeUndefined();
  });

  it('warns once per dropped field', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const item = toolCallItem({ groupId: 42 });

    parseItemMeta(item, MAINFRAME_META_NAMESPACE);

    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });

  it('a fully valid meta object parses whole, with no per-field fallback needed', () => {
    const item = toolCallItem({ containerId: 'c1', groupId: 'g1' });

    const parsed = parseItemMeta(item, MAINFRAME_META_NAMESPACE);

    expect(parsed).toEqual({ containerId: 'c1', groupId: 'g1' });
  });

  it('missing meta parses to an empty object', () => {
    const item: AccumulatedItem = { kind: 'tool-call', id: 't1', content: [] };

    expect(parseItemMeta(item, MAINFRAME_META_NAMESPACE)).toEqual({});
  });

  it('a non-object meta value parses to an empty object rather than throwing', () => {
    const item: AccumulatedItem = {
      kind: 'tool-call',
      id: 't1',
      content: [],
      meta: { [MAINFRAME_META_NAMESPACE]: 'oops' },
    };

    expect(parseItemMeta(item, MAINFRAME_META_NAMESPACE)).toEqual({});
  });
});
