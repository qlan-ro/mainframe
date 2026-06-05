import { describe, it, expect } from 'vitest';
import type { PartState } from '@assistant-ui/react';
import { makeChatGroupBy } from '../group-parts';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Minimal part stub — makeChatGroupBy only reads `part.type` and
 * `part.toolCallId`. Cast to PartState so we don't pull in the full runtime
 * shape; the function itself never touches the status/content fields.
 */
function reasoningPart(): PartState {
  return { type: 'reasoning', text: '' } as unknown as PartState;
}

function textPart(): PartState {
  return { type: 'text', text: '' } as unknown as PartState;
}

function toolCallPart(toolCallId: string): PartState {
  return { type: 'tool-call', toolCallId } as unknown as PartState;
}

// ---------------------------------------------------------------------------
// makeChatGroupBy — daemon-authoritative groupBy factory
// ---------------------------------------------------------------------------

describe('makeChatGroupBy', () => {
  const groupBy = makeChatGroupBy({ a: 'g1', b: 'g1' });

  it('assigns a reasoning part to group-reasoning', () => {
    expect(groupBy(reasoningPart())).toEqual(['group-reasoning']);
  });

  it('assigns a tool-call whose id is in the map to group-tool-<groupId>', () => {
    expect(groupBy(toolCallPart('a'))).toEqual(['group-tool-g1']);
  });

  it('assigns a second member of the same daemon group to the SAME key', () => {
    expect(groupBy(toolCallPart('b'))).toEqual(['group-tool-g1']);
  });

  it('two members of the same daemon group share the exact same key string', () => {
    const keyA = groupBy(toolCallPart('a'));
    const keyB = groupBy(toolCallPart('b'));
    expect(keyA).toEqual(keyB);
  });

  it('returns [] for a tool-call whose id is NOT in the map', () => {
    expect(groupBy(toolCallPart('z'))).toEqual([]);
  });

  it('returns [] for a text part', () => {
    expect(groupBy(textPart())).toEqual([]);
  });

  it('an empty partGroups map returns [] for any tool-call', () => {
    const groupByEmpty = makeChatGroupBy({});
    expect(groupByEmpty(toolCallPart('a'))).toEqual([]);
  });
});
