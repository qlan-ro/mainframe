/**
 * select-front — behavior tests for the pure selector function selectPermissionFront.
 *
 * Strategy:
 *  - All expected values are hardcoded; no logic is duplicated from the
 *    function under test (no manual min-reduce over askedAt values in the test).
 *
 * Behaviors covered:
 *  - Record with three entries at distinct askedAt timestamps → returns the
 *    entry with the lowest askedAt (the oldest, i.e. queue front).
 *  - undefined input → undefined.
 *  - Empty record → undefined.
 *  - Single entry → that entry.
 */
import { describe, it, expect } from 'vitest';
import type { ControlRequest } from '@qlan-ro/mainframe-types';
import type { ChatPermissionEntry } from '../../controller/chat-thread-state';
import { selectPermissionFront } from '../select-front';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function entry(requestId: string, askedAt: number, over: Partial<ControlRequest> = {}): ChatPermissionEntry {
  const request: ControlRequest = {
    requestId,
    toolName: 'Bash',
    toolUseId: `tu-${requestId}`,
    input: {},
    suggestions: [],
    ...over,
  };
  return { requestId, request, askedAt };
}

// ---------------------------------------------------------------------------
// selectPermissionFront
// ---------------------------------------------------------------------------

describe('selectPermissionFront', () => {
  it('returns the entry with the lowest askedAt (queue front) from a three-entry record', () => {
    const permissions: Record<string, ChatPermissionEntry> = {
      r30: entry('r30', 30),
      r10: entry('r10', 10),
      r20: entry('r20', 20),
    };
    const result = selectPermissionFront(permissions);
    expect(result?.requestId).toBe('r10');
  });

  it('returns undefined when permissions is undefined', () => {
    expect(selectPermissionFront(undefined)).toBeUndefined();
  });

  it('returns undefined for an empty record', () => {
    expect(selectPermissionFront({})).toBeUndefined();
  });

  it('returns the sole entry from a single-entry record', () => {
    const permissions: Record<string, ChatPermissionEntry> = {
      r1: entry('r1', 5),
    };
    const result = selectPermissionFront(permissions);
    expect(result?.requestId).toBe('r1');
  });
});
