import { describe, it, expect } from 'vitest';
import type { Chat } from '@qlan-ro/mainframe-types';
import { activeSessionCustom, chatToThreadCustom } from '../chat-to-thread-custom';

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
// Field-mapping tables — every row asserts one field of the chatToThreadCustom
// output against a fixed expected value, given a Chat override.
// ---------------------------------------------------------------------------

type Result = ReturnType<typeof chatToThreadCustom>;
type FieldRow = [name: string, overrides: Partial<Chat>, actual: (r: Result) => unknown, expected: unknown];

function runFieldRows(rows: FieldRow[]) {
  it.each<FieldRow>(rows)('%s', (_name, overrides, actual, expected) => {
    expect(actual(chatToThreadCustom(makeChat(overrides)))).toEqual(expected);
  });
}

describe('chatToThreadCustom — top-level fields (status, remoteId, title, externalId)', () => {
  runFieldRows([
    ['returns archived when chat.status is archived', { status: 'archived' }, (r) => r.status, 'archived'],
    ['returns regular when chat.status is active', { status: 'active' }, (r) => r.status, 'regular'],
    ['returns regular when chat.status is ended', { status: 'ended' }, (r) => r.status, 'regular'],
    ['returns regular when chat.status is paused', { status: 'paused' }, (r) => r.status, 'regular'],
    ['remoteId equals chat.id', {}, (r) => r.remoteId, 'chat-1'],
    ['title reflects chat.title when present', { title: 'My Session' }, (r) => r.title, 'My Session'],
    ['title is undefined when chat.title is absent', {}, (r) => r.title, undefined],
    ['externalId is always undefined', {}, (r) => r.externalId, undefined],
  ]);
});

describe('chatToThreadCustom — identity & status custom fields', () => {
  runFieldRows([
    ['custom.projectId equals chat.projectId', {}, (r) => r.custom.projectId, 'proj-1'],
    ['custom.adapterId equals chat.adapterId', {}, (r) => r.custom.adapterId, 'claude'],
    [
      // the agent CLI's own session id (copied via the row context menu), NOT the mainframe chat id
      'custom.claudeSessionId forwards chat.claudeSessionId when present',
      { claudeSessionId: 'cli-sess-abc' },
      (r) => r.custom.claudeSessionId,
      'cli-sess-abc',
    ],
    [
      'custom.claudeSessionId is undefined when chat.claudeSessionId is absent',
      {},
      (r) => r.custom.claudeSessionId,
      undefined,
    ],
    [
      'custom.claudeSessionId does not equal the mainframe chat id',
      { id: 'chat-1', claudeSessionId: 'cli-sess-abc' },
      (r) => r.custom.claudeSessionId !== r.remoteId,
      true,
    ],
    ['custom.status equals chat.status', { status: 'paused' }, (r) => r.custom.status, 'paused'],
    ['custom.tags defaults to empty array when chat.tags is absent', {}, (r) => r.custom.tags, []],
    [
      'custom.tags forwards chat.tags when present',
      { tags: ['bug', 'urgent'] },
      (r) => r.custom.tags,
      ['bug', 'urgent'],
    ],
    ['custom.pinned is false when chat.pinned is absent', {}, (r) => r.custom.pinned, false],
    ['custom.pinned is true when chat.pinned is true', { pinned: true }, (r) => r.custom.pinned, true],
  ]);
});

describe('chatToThreadCustom — display/pending status & detected PRs', () => {
  runFieldRows([
    [
      'custom.displayStatus defaults to idle when chat.displayStatus is absent',
      {},
      (r) => r.custom.displayStatus,
      'idle',
    ],
    [
      'custom.displayStatus forwards working when chat.displayStatus is working',
      { displayStatus: 'working' },
      (r) => r.custom.displayStatus,
      'working',
    ],
    [
      'custom.hasPending is true only when displayStatus is waiting',
      { displayStatus: 'waiting' },
      (r) => r.custom.hasPending,
      true,
    ],
    [
      'custom.hasPending is false when displayStatus is working',
      { displayStatus: 'working' },
      (r) => r.custom.hasPending,
      false,
    ],
    [
      'custom.hasPending is false when displayStatus is absent (defaults to idle)',
      {},
      (r) => r.custom.hasPending,
      false,
    ],
    ['custom.detectedPrs defaults to empty array when chat.detectedPrs is absent', {}, (r) => r.custom.detectedPrs, []],
    [
      'custom.detectedPrs forwards detectedPrs and preserves number',
      { detectedPrs: [{ url: 'https://github.com/o/r/pull/1', owner: 'o', repo: 'r', number: 1, source: 'created' }] },
      (r) => ({ length: r.custom.detectedPrs.length, firstNumber: r.custom.detectedPrs[0]?.number }),
      { length: 1, firstNumber: 1 },
    ],
  ]);
});

describe('chatToThreadCustom — worktree, branch, transcript & timestamp fields', () => {
  runFieldRows([
    ['custom.worktreePath is undefined when chat.worktreePath is absent', {}, (r) => r.custom.worktreePath, undefined],
    [
      'custom.worktreePath forwards chat.worktreePath when present',
      { worktreePath: '/home/user/wt' },
      (r) => r.custom.worktreePath,
      '/home/user/wt',
    ],
    ['custom.worktreeMissing is false when chat.worktreeMissing is absent', {}, (r) => r.custom.worktreeMissing, false],
    [
      'custom.worktreeMissing is true when chat.worktreeMissing is true',
      { worktreeMissing: true },
      (r) => r.custom.worktreeMissing,
      true,
    ],
    [
      'custom.updatedAt converts ISO updatedAt to numeric milliseconds — 2026-06-01T12:00:00.000Z is 1780315200000',
      { updatedAt: '2026-06-01T12:00:00.000Z' },
      (r) => r.custom.updatedAt,
      1780315200000,
    ],
    [
      'custom.branchName forwards chat.branchName when present',
      { branchName: 'feat/x' },
      (r) => r.custom.branchName,
      'feat/x',
    ],
    ['custom.branchName is undefined when chat.branchName is absent', {}, (r) => r.custom.branchName, undefined],
    [
      'custom.transcriptMissing is false when chat.transcriptMissing is absent',
      {},
      (r) => r.custom.transcriptMissing,
      false,
    ],
    [
      'custom.transcriptMissing is true when chat.transcriptMissing is true',
      { transcriptMissing: true },
      (r) => r.custom.transcriptMissing,
      true,
    ],
  ]);
});

// ---------------------------------------------------------------------------
// activeSessionCustom — freshest custom for the ACTIVE thread-list item
// ---------------------------------------------------------------------------

describe('activeSessionCustom', () => {
  const staleCustom = { ...chatToThreadCustom(makeChat()).custom };
  const freshCustom = {
    ...chatToThreadCustom(makeChat({ worktreePath: '/wt/feature-x', branchName: 'feature-x' })).custom,
  };

  it('returns undefined for no active item', () => {
    expect(activeSessionCustom(undefined, [])).toBeUndefined();
  });

  it('returns the item custom when the item is keyed by its remoteId', () => {
    const item = { id: 'chat-1', remoteId: 'chat-1', status: 'regular', custom: freshCustom };
    expect(activeSessionCustom(item, [item])).toBe(freshCustom);
  });

  it('prefers the remoteId-keyed list entry over a stale __LOCALID_* item custom', () => {
    // A thread created this app-run keeps its __LOCALID_* mapping id; reload()
    // re-derives custom only under a NEW remoteId-keyed entry, so the active
    // item's own custom goes permanently stale (worktree join never shows).
    const localItem = { id: '__LOCALID_abc', remoteId: 'chat-1', status: 'regular', custom: staleCustom };
    const freshEntry = { id: 'chat-1', remoteId: 'chat-1', status: 'regular', custom: freshCustom };
    const result = activeSessionCustom(localItem, [localItem, freshEntry]);
    expect(result).toBe(freshCustom);
    expect(result?.worktreePath).toBe('/wt/feature-x');
  });

  it('falls back to the item custom when no remoteId-keyed entry exists yet', () => {
    const localItem = { id: '__LOCALID_abc', remoteId: 'chat-1', status: 'regular', custom: staleCustom };
    expect(activeSessionCustom(localItem, [localItem])).toBe(staleCustom);
  });

  it('returns undefined for a custom-less draft item', () => {
    const draft = { id: '__LOCALID_new', status: 'new' };
    expect(activeSessionCustom(draft, [draft])).toBeUndefined();
  });
});
