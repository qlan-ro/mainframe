import { describe, it, expect } from 'vitest';
import type { Chat } from '@qlan-ro/mainframe-types';
import { chatToThreadCustom } from '../chat-to-thread-custom';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeChat(overrides: Partial<Chat> = {}): Chat {
  return {
    id: 'chat-1',
    adapterId: 'claude',
    projectId: 'proj-1',
    status: 'active',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-06-01T12:00:00.000Z',
    totalCost: 0,
    totalTokensInput: 0,
    totalTokensOutput: 0,
    lastContextTokensInput: 0,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// status mapping
// ---------------------------------------------------------------------------

describe('chatToThreadCustom — status mapping', () => {
  it('returns archived when chat.status is archived', () => {
    expect(chatToThreadCustom(makeChat({ status: 'archived' })).status).toBe('archived');
  });

  it('returns regular when chat.status is active', () => {
    expect(chatToThreadCustom(makeChat({ status: 'active' })).status).toBe('regular');
  });

  it('returns regular when chat.status is ended', () => {
    expect(chatToThreadCustom(makeChat({ status: 'ended' })).status).toBe('regular');
  });

  it('returns regular when chat.status is paused', () => {
    expect(chatToThreadCustom(makeChat({ status: 'paused' })).status).toBe('regular');
  });
});

// ---------------------------------------------------------------------------
// remoteId
// ---------------------------------------------------------------------------

describe('chatToThreadCustom — remoteId', () => {
  it('equals chat.id', () => {
    expect(chatToThreadCustom(makeChat()).remoteId).toBe('chat-1');
  });
});

// ---------------------------------------------------------------------------
// title
// ---------------------------------------------------------------------------

describe('chatToThreadCustom — title', () => {
  it('reflects chat.title when present', () => {
    expect(chatToThreadCustom(makeChat({ title: 'My Session' })).title).toBe('My Session');
  });

  it('is undefined when chat.title is absent', () => {
    expect(chatToThreadCustom(makeChat()).title).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// externalId
// ---------------------------------------------------------------------------

describe('chatToThreadCustom — externalId', () => {
  it('is always undefined', () => {
    expect(chatToThreadCustom(makeChat()).externalId).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// custom.projectId
// ---------------------------------------------------------------------------

describe('chatToThreadCustom — custom.projectId', () => {
  it('equals chat.projectId', () => {
    expect(chatToThreadCustom(makeChat()).custom.projectId).toBe('proj-1');
  });
});

// ---------------------------------------------------------------------------
// custom.adapterId
// ---------------------------------------------------------------------------

describe('chatToThreadCustom — custom.adapterId', () => {
  it('equals chat.adapterId', () => {
    expect(chatToThreadCustom(makeChat()).custom.adapterId).toBe('claude');
  });
});

// ---------------------------------------------------------------------------
// custom.tags
// ---------------------------------------------------------------------------

describe('chatToThreadCustom — custom.tags', () => {
  it('defaults to empty array when chat.tags is absent', () => {
    expect(chatToThreadCustom(makeChat()).custom.tags).toEqual([]);
  });

  it('forwards chat.tags when present', () => {
    expect(chatToThreadCustom(makeChat({ tags: ['bug', 'urgent'] })).custom.tags).toEqual(['bug', 'urgent']);
  });
});

// ---------------------------------------------------------------------------
// custom.pinned
// ---------------------------------------------------------------------------

describe('chatToThreadCustom — custom.pinned', () => {
  it('is false when chat.pinned is absent', () => {
    expect(chatToThreadCustom(makeChat()).custom.pinned).toBe(false);
  });

  it('is true when chat.pinned is true', () => {
    expect(chatToThreadCustom(makeChat({ pinned: true })).custom.pinned).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// custom.status
// ---------------------------------------------------------------------------

describe('chatToThreadCustom — custom.status', () => {
  it('equals chat.status', () => {
    expect(chatToThreadCustom(makeChat({ status: 'paused' })).custom.status).toBe('paused');
  });
});

// ---------------------------------------------------------------------------
// custom.displayStatus
// ---------------------------------------------------------------------------

describe('chatToThreadCustom — custom.displayStatus', () => {
  it('defaults to idle when chat.displayStatus is absent', () => {
    expect(chatToThreadCustom(makeChat()).custom.displayStatus).toBe('idle');
  });

  it('forwards working when chat.displayStatus is working', () => {
    expect(chatToThreadCustom(makeChat({ displayStatus: 'working' })).custom.displayStatus).toBe('working');
  });
});

// ---------------------------------------------------------------------------
// custom.hasPending
// ---------------------------------------------------------------------------

describe('chatToThreadCustom — custom.hasPending', () => {
  it('is true only when displayStatus is waiting', () => {
    expect(chatToThreadCustom(makeChat({ displayStatus: 'waiting' })).custom.hasPending).toBe(true);
  });

  it('is false when displayStatus is working', () => {
    expect(chatToThreadCustom(makeChat({ displayStatus: 'working' })).custom.hasPending).toBe(false);
  });

  it('is false when displayStatus is absent (defaults to idle)', () => {
    expect(chatToThreadCustom(makeChat()).custom.hasPending).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// custom.detectedPrs
// ---------------------------------------------------------------------------

describe('chatToThreadCustom — custom.detectedPrs', () => {
  it('defaults to empty array when chat.detectedPrs is absent', () => {
    expect(chatToThreadCustom(makeChat()).custom.detectedPrs).toEqual([]);
  });

  it('forwards detectedPrs and preserves number', () => {
    const result = chatToThreadCustom(
      makeChat({
        detectedPrs: [{ url: 'https://github.com/o/r/pull/1', owner: 'o', repo: 'r', number: 1, source: 'created' }],
      }),
    );
    expect(result.custom.detectedPrs).toHaveLength(1);
    expect(result.custom.detectedPrs[0]?.number).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// custom.worktreePath
// ---------------------------------------------------------------------------

describe('chatToThreadCustom — custom.worktreePath', () => {
  it('is undefined when chat.worktreePath is absent', () => {
    expect(chatToThreadCustom(makeChat()).custom.worktreePath).toBeUndefined();
  });

  it('forwards chat.worktreePath when present', () => {
    expect(chatToThreadCustom(makeChat({ worktreePath: '/home/user/wt' })).custom.worktreePath).toBe('/home/user/wt');
  });
});

// ---------------------------------------------------------------------------
// custom.worktreeMissing
// ---------------------------------------------------------------------------

describe('chatToThreadCustom — custom.worktreeMissing', () => {
  it('is false when chat.worktreeMissing is absent', () => {
    expect(chatToThreadCustom(makeChat()).custom.worktreeMissing).toBe(false);
  });

  it('is true when chat.worktreeMissing is true', () => {
    expect(chatToThreadCustom(makeChat({ worktreeMissing: true })).custom.worktreeMissing).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// custom.updatedAt
// ---------------------------------------------------------------------------

describe('chatToThreadCustom — custom.updatedAt', () => {
  it('converts ISO updatedAt to numeric milliseconds — 2026-06-01T12:00:00.000Z is 1780315200000', () => {
    expect(chatToThreadCustom(makeChat({ updatedAt: '2026-06-01T12:00:00.000Z' })).custom.updatedAt).toBe(
      1780315200000,
    );
  });
});

// ---------------------------------------------------------------------------
// custom.branchName
// ---------------------------------------------------------------------------

describe('chatToThreadCustom — custom.branchName', () => {
  it('forwards chat.branchName when present', () => {
    expect(chatToThreadCustom(makeChat({ branchName: 'feat/x' })).custom.branchName).toBe('feat/x');
  });

  it('is undefined when chat.branchName is absent', () => {
    expect(chatToThreadCustom(makeChat()).custom.branchName).toBeUndefined();
  });
});
