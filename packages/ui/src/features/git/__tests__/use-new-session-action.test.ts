// @vitest-environment jsdom
/**
 * useNewSessionAction — BranchPopover's "new session in worktree" action.
 *
 * Pins the adapter resolution order (live session custom → pre-send draft →
 * 'claude' default) and the action wiring (create the worktree session, then
 * close the popover).
 */
import { renderHook } from '@testing-library/react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useDraftConfigStore, setDraftConfig } from '@/features/sessions/runtime/draft-config';

interface FakeItem {
  id: string;
  remoteId?: string;
  status: string;
  custom?: Record<string, unknown>;
}
interface FakeAuiState {
  threadListItem: FakeItem | undefined;
  threads: { threadItems: FakeItem[] };
}

let fakeAuiState: FakeAuiState = { threadListItem: undefined, threads: { threadItems: [] } };

vi.mock('@assistant-ui/react', () => ({
  useAuiState: (selector: (s: FakeAuiState) => unknown) => selector(fakeAuiState),
}));

const mockCreateSession = vi.fn();
let capturedAdapterId: string | undefined;
vi.mock('../use-worktree-session', () => ({
  useWorktreeSession: (_port: number, _projectId: string | undefined, adapterId: string) => {
    capturedAdapterId = adapterId;
    return mockCreateSession;
  },
}));

import { useNewSessionAction } from '../use-new-session-action';

const LIVE_CUSTOM = { projectId: 'proj-a', adapterId: 'codex' };

beforeEach(() => {
  useDraftConfigStore.setState({ drafts: new Map() });
  fakeAuiState = { threadListItem: undefined, threads: { threadItems: [] } };
  mockCreateSession.mockReset().mockResolvedValue(undefined);
  capturedAdapterId = undefined;
});

describe('useNewSessionAction — adapter resolution', () => {
  it('resolves the adapter from the live session custom', () => {
    const item: FakeItem = { id: '__LOCALID_1', remoteId: 'chat-9', status: 'regular' };
    fakeAuiState = {
      threadListItem: item,
      threads: { threadItems: [item, { id: 'chat-9', remoteId: 'chat-9', status: 'regular', custom: LIVE_CUSTOM }] },
    };

    renderHook(() => useNewSessionAction(31415, 'proj-a', vi.fn()));

    expect(capturedAdapterId).toBe('codex');
  });

  it('falls back to the pre-send draft adapter for a custom-less __LOCALID_* thread', () => {
    const item: FakeItem = { id: '__LOCALID_d', status: 'new' };
    fakeAuiState = { threadListItem: item, threads: { threadItems: [item] } };
    setDraftConfig('__LOCALID_d', { projectId: 'proj-a', adapterId: 'gemini' });

    renderHook(() => useNewSessionAction(31415, 'proj-a', vi.fn()));

    expect(capturedAdapterId).toBe('gemini');
  });

  it("defaults to 'claude' when neither custom nor draft exists", () => {
    renderHook(() => useNewSessionAction(31415, 'proj-a', vi.fn()));

    expect(capturedAdapterId).toBe('claude');
  });
});

describe('useNewSessionAction — action wiring', () => {
  it('creates the worktree session and closes the popover', () => {
    const onDone = vi.fn();
    const { result } = renderHook(() => useNewSessionAction(31415, 'proj-a', onDone));

    result.current('wt-dir', 'feat/x');

    expect(mockCreateSession).toHaveBeenCalledWith('wt-dir', 'feat/x');
    expect(onDone).toHaveBeenCalledTimes(1);
  });
});
