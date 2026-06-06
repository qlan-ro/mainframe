import { describe, it, expect } from 'vitest';
import type { SessionCustom } from '../chat-to-thread-custom';
import { deriveSessionStatus } from '../session-status';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeCustom(overrides: Partial<SessionCustom> = {}): SessionCustom {
  return {
    projectId: 'proj-1',
    adapterId: 'claude',
    tags: [],
    pinned: false,
    status: 'active',
    displayStatus: 'idle',
    hasPending: false,
    detectedPrs: [],
    worktreeMissing: false,
    updatedAt: 1748779200000,
    ...overrides,
  };
}

// Note: 'working' and 'waiting' are mutually exclusive in practice —
// displayStatus can only hold one value at a time. The precedence order
// (working > waiting) is a safety belt only and will never be triggered by
// valid SessionCustom values produced by chatToThreadCustom.

// ---------------------------------------------------------------------------
// Precedence: worktree-missing always wins
// ---------------------------------------------------------------------------

describe('deriveSessionStatus — worktree-missing precedence', () => {
  it('returns worktree-missing when worktreeMissing is true even if displayStatus is working and hasPending is true', () => {
    expect(
      deriveSessionStatus(makeCustom({ worktreeMissing: true, displayStatus: 'working', hasPending: true }), true),
    ).toBe('worktree-missing');
  });

  it('returns worktree-missing when worktreeMissing is true and unread is true', () => {
    expect(deriveSessionStatus(makeCustom({ worktreeMissing: true }), true)).toBe('worktree-missing');
  });
});

// ---------------------------------------------------------------------------
// Precedence: working beats hasPending and unread
// ---------------------------------------------------------------------------

describe('deriveSessionStatus — working precedence', () => {
  it('returns working when displayStatus is working even if hasPending is true and unread is true', () => {
    expect(deriveSessionStatus(makeCustom({ displayStatus: 'working', hasPending: true }), true)).toBe('working');
  });
});

// ---------------------------------------------------------------------------
// Precedence: waiting (hasPending) beats unread
// ---------------------------------------------------------------------------

describe('deriveSessionStatus — waiting precedence', () => {
  it('returns waiting when hasPending is true and unread is true', () => {
    expect(deriveSessionStatus(makeCustom({ hasPending: true }), true)).toBe('waiting');
  });
});

// ---------------------------------------------------------------------------
// Precedence: unread beats idle
// ---------------------------------------------------------------------------

describe('deriveSessionStatus — unread precedence', () => {
  it('returns unread when unread is true and no higher flag is set', () => {
    expect(deriveSessionStatus(makeCustom(), true)).toBe('unread');
  });
});

// ---------------------------------------------------------------------------
// Base case: idle
// ---------------------------------------------------------------------------

describe('deriveSessionStatus — idle base case', () => {
  it('returns idle when all flags are off', () => {
    expect(deriveSessionStatus(makeCustom(), false)).toBe('idle');
  });
});

// ---------------------------------------------------------------------------
// Edge: displayStatus 'waiting' without hasPending does NOT produce 'waiting'
// ---------------------------------------------------------------------------

describe('deriveSessionStatus — hasPending gates the waiting tier, not displayStatus', () => {
  it('returns idle when displayStatus is waiting but hasPending is false', () => {
    expect(deriveSessionStatus(makeCustom({ displayStatus: 'waiting', hasPending: false }), false)).toBe('idle');
  });
});
