/**
 * The chat-split workspace follower (split plan, decision 8): entering the split
 * parks a top-row workspace in the bottom strip, and leaving it puts the
 * workspace back — but only while the arrangement is still the one the split
 * made. `workspaceSystemMoved` is that ownership flag: any manual reposition
 * takes it away, and the restore then leaves the layout alone.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { useLayoutStore, type WorkspaceLayout } from '../layout';

const FRESH: WorkspaceLayout = { top: ['chat'], bottom: null, topFlex: {}, vFlex: { top: 1, bottom: 0.4 } };

function store() {
  return useLayoutStore.getState();
}

function layout(): WorkspaceLayout {
  return useLayoutStore.getState().layout;
}

function seedLayout(next: Partial<WorkspaceLayout>): void {
  useLayoutStore.setState({ layout: { ...FRESH, ...next } });
}

beforeEach(() => {
  useLayoutStore.setState({
    layout: { ...FRESH },
    run: null,
    sessions: new Map(),
    activeSessionId: null,
    workspaceSystemMoved: null,
  });
});

describe('moveWorkspaceForChatSplit', () => {
  it('parks a top-row workspace in the bottom strip and claims the move', () => {
    seedLayout({ top: ['chat', 'workspace'] });

    store().moveWorkspaceForChatSplit();

    expect(layout().top).toEqual(['chat']);
    expect(layout().bottom).toBe('workspace');
    expect(store().workspaceSystemMoved).toBe('top-right');
  });

  it('does nothing when the workspace is not on screen at all', () => {
    store().moveWorkspaceForChatSplit();

    expect(layout()).toEqual({ top: ['chat'], bottom: null, topFlex: {}, vFlex: { top: 1, bottom: 0.4 } });
    expect(store().workspaceSystemMoved).toBeNull();
  });

  it('does nothing — and claims nothing — when the workspace is already in the strip', () => {
    seedLayout({ top: ['chat'], bottom: 'workspace' });

    store().moveWorkspaceForChatSplit();

    expect(layout()).toEqual({
      top: ['chat'],
      bottom: 'workspace',
      topFlex: {},
      vFlex: { top: 1, bottom: 0.4 },
    });
    expect(store().workspaceSystemMoved).toBeNull();
  });
});

describe('restoreWorkspaceAfterChatSplit', () => {
  it('returns a parked workspace to the top row and releases the claim', () => {
    seedLayout({ top: ['chat'], bottom: 'workspace' });
    useLayoutStore.setState({ workspaceSystemMoved: 'top-right' });

    store().restoreWorkspaceAfterChatSplit();

    expect(layout().top).toEqual(['chat', 'workspace']);
    expect(layout().bottom).toBeNull();
    expect(store().workspaceSystemMoved).toBeNull();
  });

  it('returns a left-side workspace to the LEFT — the claim remembers the side', () => {
    seedLayout({ top: ['workspace', 'chat'] });

    store().moveWorkspaceForChatSplit();
    expect(store().workspaceSystemMoved).toBe('top-left');
    expect(layout().bottom).toBe('workspace');

    store().restoreWorkspaceAfterChatSplit();

    expect(layout().top).toEqual(['workspace', 'chat']);
    expect(layout().bottom).toBeNull();
    expect(store().workspaceSystemMoved).toBeNull();
  });

  it('leaves the strip alone when the split never claimed the move', () => {
    // The user put the workspace down there themselves — unsplitting must not
    // yank it back up.
    seedLayout({ top: ['chat'], bottom: 'workspace' });

    store().restoreWorkspaceAfterChatSplit();

    expect(layout()).toEqual({
      top: ['chat'],
      bottom: 'workspace',
      topFlex: {},
      vFlex: { top: 1, bottom: 0.4 },
    });
    expect(store().workspaceSystemMoved).toBeNull();
  });

  it('moves nothing but drops the claim when the workspace left the strip', () => {
    seedLayout({ top: ['chat', 'workspace'] });
    useLayoutStore.setState({ workspaceSystemMoved: 'top-right' });

    store().restoreWorkspaceAfterChatSplit();

    expect(layout()).toEqual({
      top: ['chat', 'workspace'],
      bottom: null,
      topFlex: {},
      vFlex: { top: 1, bottom: 0.4 },
    });
    expect(store().workspaceSystemMoved).toBeNull();
  });
});

describe('a manual reposition takes ownership back', () => {
  it('clears the claim', () => {
    seedLayout({ top: ['chat', 'workspace'] });
    store().moveWorkspaceForChatSplit();
    expect(store().workspaceSystemMoved).toBe('top-right');

    store().repositionSurface('workspace', 'bottom');

    expect(store().workspaceSystemMoved).toBeNull();
  });

  it('so the unsplit restore leaves the user arrangement untouched', () => {
    seedLayout({ top: ['chat', 'workspace'] });
    store().moveWorkspaceForChatSplit();
    store().repositionSurface('workspace', 'bottom');

    store().restoreWorkspaceAfterChatSplit();

    expect(layout().top).toEqual(['chat']);
    expect(layout().bottom).toBe('workspace');
  });
});
