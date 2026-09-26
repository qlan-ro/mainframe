/**
 * useActiveIdentity — draft-aware identity resolution (todo #223).
 *
 * Behaviors covered:
 *  1. Live session: fields resolve from the remoteId-keyed custom (unchanged).
 *  2. Draft (`__LOCALID_*`, no custom): projectId/adapterId/projectPath resolve
 *     from the seeded draft config, so project-scoped surfaces light up while
 *     composing; chatId stays undefined (no daemon chat yet).
 *  3. Draft worktree attach: worktreePath/branchName surface from the draft.
 *  4. First-send gap: the draft is consumed before threads.reload lands — the
 *     SAME item keeps its resolved identity (no dark flicker mid-handoff).
 *  5. No leak: a different custom-less item never inherits the cached identity.
 *  6. noProject (todo #346): a live chat's `noProject` comes off its Chat
 *     object, and a draft's comes off the picker's "No project" choice; either
 *     way `projectId` is nulled to `undefined` so no consumer sees the daemon's
 *     hidden scratch project id.
 */
import { renderHook } from '@testing-library/react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { Chat, Project } from '@qlan-ro/mainframe-types';
import { useDraftConfigStore, setDraftConfig } from '../runtime/draft-config';
import { useDiscardedDraftStore, markDraftDiscarded } from '../new-thread/discarded-drafts';

interface FakeItem {
  id: string;
  remoteId?: string;
  status: string;
  custom?: Record<string, unknown>;
}
interface FakeAuiState {
  threadListItem: FakeItem | undefined;
  threads: { threadItems: FakeItem[] };
  // Optional: useChatExtras is mocked separately below (via fakeChatConfig), so
  // nothing in this file actually reads `s.thread` through the real selector.
  thread?: { extras: unknown };
}

let fakeChatConfig: Partial<Chat> | null = null;
let fakeAuiState: FakeAuiState = {
  threadListItem: undefined,
  threads: { threadItems: [] },
  thread: { extras: undefined },
};

vi.mock('@assistant-ui/react', () => ({
  useAuiState: (selector: (s: FakeAuiState) => unknown) => selector(fakeAuiState),
}));

// useChatExtras() itself reads `s.thread.extras` through the same mocked
// useAuiState above and brand-checks the result — a plain object never passes
// that check, so chatConfig is stubbed here directly instead.
vi.mock('@/features/chat/runtime/chat-extras', () => ({
  useChatExtras: () => (fakeChatConfig === null ? undefined : { state: { chatConfig: fakeChatConfig } }),
}));

const PROJECTS: Project[] = [
  { id: 'proj-a', name: 'Alpha', path: '/repos/alpha' } as Project,
  { id: 'proj-b', name: 'Beta', path: '/repos/beta' } as Project,
];

vi.mock('../use-projects', () => ({
  useProjects: () => ({ projects: PROJECTS, loading: false }),
}));

import { useActiveIdentity } from '../use-active-identity';

const LIVE_CUSTOM = {
  projectId: 'proj-a',
  adapterId: 'claude',
  tags: [],
  pinned: false,
  status: 'active',
  displayStatus: 'idle',
  hasPending: false,
  detectedPrs: [],
  worktreeMissing: false,
  temporary: false,
  noProject: false,
  transcriptMissing: false,
  branchName: 'main',
  updatedAt: 0,
};

beforeEach(() => {
  useDraftConfigStore.setState({ drafts: new Map() });
  useDiscardedDraftStore.setState({ ids: new Set() });
  fakeAuiState = { threadListItem: undefined, threads: { threadItems: [] }, thread: { extras: undefined } };
  fakeChatConfig = null;
});

describe('useActiveIdentity — live session (unchanged behavior)', () => {
  it('resolves project/branch/chatId from the remoteId-keyed custom', () => {
    const item: FakeItem = { id: '__LOCALID_1', remoteId: 'chat-9', status: 'regular' };
    fakeAuiState = {
      threadListItem: item,
      threads: { threadItems: [item, { id: 'chat-9', remoteId: 'chat-9', status: 'regular', custom: LIVE_CUSTOM }] },
    };

    const { result } = renderHook(() => useActiveIdentity());

    expect(result.current.projectId).toBe('proj-a');
    expect(result.current.projectName).toBe('Alpha');
    expect(result.current.branchName).toBe('main');
    expect(result.current.chatId).toBe('chat-9');
    expect(result.current.projectPath).toBe('/repos/alpha');
  });
});

describe('useActiveIdentity — seeded draft resolves the project scope pre-send', () => {
  it('resolves projectId/adapterId/projectName/projectPath from the draft config', () => {
    const item: FakeItem = { id: '__LOCALID_d', status: 'new' };
    fakeAuiState = { threadListItem: item, threads: { threadItems: [item] } };
    setDraftConfig('__LOCALID_d', { projectId: 'proj-b', adapterId: 'codex' });

    const { result } = renderHook(() => useActiveIdentity());

    expect(result.current.projectId).toBe('proj-b');
    expect(result.current.adapterId).toBe('codex');
    expect(result.current.projectName).toBe('Beta');
    expect(result.current.projectPath).toBe('/repos/beta');
    expect(result.current.chatId).toBeUndefined();
  });

  it('surfaces a pre-send worktree attach from the draft', () => {
    const item: FakeItem = { id: '__LOCALID_d', status: 'new' };
    fakeAuiState = { threadListItem: item, threads: { threadItems: [item] } };
    setDraftConfig('__LOCALID_d', {
      projectId: 'proj-a',
      adapterId: 'claude',
      worktreePath: '/wt/feat',
      branchName: 'feat/x',
    });

    const { result } = renderHook(() => useActiveIdentity());

    expect(result.current.worktreePath).toBe('/wt/feat');
    expect(result.current.branchName).toBe('feat/x');
    expect(result.current.isWorktree).toBe(true);
  });

  it('surfaces a pending NEW worktree as branch + isWorktree, with no worktreePath', () => {
    const item: FakeItem = { id: '__LOCALID_d', status: 'new' };
    fakeAuiState = { threadListItem: item, threads: { threadItems: [item] } };
    setDraftConfig('__LOCALID_d', {
      projectId: 'proj-a',
      adapterId: 'claude',
      pendingWorktree: { baseBranch: 'main', branchName: 'feat/pending' },
    });

    const { result } = renderHook(() => useActiveIdentity());

    expect(result.current.branchName).toBe('feat/pending');
    expect(result.current.isWorktree).toBe(true);
    expect(result.current.worktreePath).toBeUndefined();
  });

  it('stays empty for a custom-less draft with NO seeded config (picker not resolved yet)', () => {
    const item: FakeItem = { id: '__LOCALID_d', status: 'new' };
    fakeAuiState = { threadListItem: item, threads: { threadItems: [item] } };

    const { result } = renderHook(() => useActiveIdentity());

    expect(result.current.projectId).toBeUndefined();
    expect(result.current.projectName).toBe('Mainframe');
  });
});

describe('useActiveIdentity — first-send gap continuity', () => {
  it('keeps the resolved identity on the SAME item after the draft is consumed', () => {
    const item: FakeItem = { id: '__LOCALID_d', status: 'new' };
    fakeAuiState = { threadListItem: item, threads: { threadItems: [item] } };
    setDraftConfig('__LOCALID_d', { projectId: 'proj-b', adapterId: 'codex' });

    const { result, rerender } = renderHook(() => useActiveIdentity());
    expect(result.current.projectId).toBe('proj-b');

    // First send: the coordinator clears the draft; threads.reload has not
    // landed yet, so the item still has no custom.
    useDraftConfigStore.setState({ drafts: new Map() });
    rerender();

    expect(result.current.projectId).toBe('proj-b');
    expect(result.current.projectName).toBe('Beta');
  });

  it('does NOT leak the cached identity to a different custom-less item', () => {
    const item: FakeItem = { id: '__LOCALID_d', status: 'new' };
    fakeAuiState = { threadListItem: item, threads: { threadItems: [item] } };
    setDraftConfig('__LOCALID_d', { projectId: 'proj-b', adapterId: 'codex' });

    const { result, rerender } = renderHook(() => useActiveIdentity());
    expect(result.current.projectId).toBe('proj-b');

    useDraftConfigStore.setState({ drafts: new Map() });
    const other: FakeItem = { id: '__LOCALID_other', status: 'new' };
    fakeAuiState = { threadListItem: other, threads: { threadItems: [other] } };
    rerender();

    expect(result.current.projectId).toBeUndefined();
  });

  it('drops the bridged identity when the parked slot was explicitly discarded', () => {
    // ✕ discard clears the draft and marks the slot discarded, but the user can
    // stay parked on it (returnThreadId pointed at the slot itself, or there
    // are zero sessions to switch to). The first-send bridge must not keep the
    // discarded project's scope alive on that slot.
    const item: FakeItem = { id: '__LOCALID_d', status: 'new' };
    fakeAuiState = { threadListItem: item, threads: { threadItems: [item] } };
    setDraftConfig('__LOCALID_d', { projectId: 'proj-b', adapterId: 'codex' });

    const { result, rerender } = renderHook(() => useActiveIdentity());
    expect(result.current.projectId).toBe('proj-b');

    useDraftConfigStore.setState({ drafts: new Map() });
    markDraftDiscarded('__LOCALID_d');
    rerender();

    expect(result.current.projectId).toBeUndefined();
    expect(result.current.projectName).toBe('Mainframe');
  });
});

describe('useActiveIdentity — noProject (todo #346)', () => {
  it('is false for an ordinary project-backed live chat', () => {
    const item: FakeItem = { id: '__LOCALID_1', remoteId: 'chat-9', status: 'regular' };
    fakeAuiState = {
      threadListItem: item,
      threads: { threadItems: [item, { id: 'chat-9', remoteId: 'chat-9', status: 'regular', custom: LIVE_CUSTOM }] },
      thread: { extras: undefined },
    };
    fakeChatConfig = { id: 'chat-9', noProject: false };

    const { result } = renderHook(() => useActiveIdentity());

    expect(result.current.noProject).toBe(false);
    expect(result.current.projectId).toBe('proj-a');
  });

  it('is true for a live chat whose Chat carries noProject, and nulls the sentinel projectId', () => {
    const item: FakeItem = { id: '__LOCALID_1', remoteId: 'chat-9', status: 'regular' };
    const noProjectCustom = { ...LIVE_CUSTOM, projectId: 'mainframe-no-project' };
    fakeAuiState = {
      threadListItem: item,
      threads: {
        threadItems: [item, { id: 'chat-9', remoteId: 'chat-9', status: 'regular', custom: noProjectCustom }],
      },
      thread: { extras: undefined },
    };
    fakeChatConfig = { id: 'chat-9', noProject: true };

    const { result } = renderHook(() => useActiveIdentity());

    expect(result.current.noProject).toBe(true);
    expect(result.current.projectId).toBeUndefined();
  });

  it('is true for a draft explicitly set to "No project"', () => {
    const item: FakeItem = { id: '__LOCALID_d', status: 'new' };
    fakeAuiState = { threadListItem: item, threads: { threadItems: [item] }, thread: { extras: undefined } };
    setDraftConfig('__LOCALID_d', { projectId: null, adapterId: 'claude' });

    const { result } = renderHook(() => useActiveIdentity());

    expect(result.current.noProject).toBe(true);
    expect(result.current.projectId).toBeUndefined();
  });

  it('is false for a draft with a real project chosen', () => {
    const item: FakeItem = { id: '__LOCALID_d', status: 'new' };
    fakeAuiState = { threadListItem: item, threads: { threadItems: [item] }, thread: { extras: undefined } };
    setDraftConfig('__LOCALID_d', { projectId: 'proj-a', adapterId: 'claude' });

    const { result } = renderHook(() => useActiveIdentity());

    expect(result.current.noProject).toBe(false);
    expect(result.current.projectId).toBe('proj-a');
  });
});
