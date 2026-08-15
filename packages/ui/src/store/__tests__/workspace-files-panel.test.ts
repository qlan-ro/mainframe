import { beforeEach, describe, expect, it } from 'vitest';
import { useActiveBasesStore } from '../active-bases-store';
import { isWorkspaceFilesPanelOpen, useWorkspaceFilesPanel } from '../workspace-files-panel';

describe('useWorkspaceFilesPanel', () => {
  beforeEach(() => {
    localStorage.clear();
    useWorkspaceFilesPanel.setState({ openByScope: {} });
    useActiveBasesStore.setState({ bases: {}, scopeKey: null });
  });

  it('defaults to closed for every scope', () => {
    expect(isWorkspaceFilesPanelOpen(useWorkspaceFilesPanel.getState().openByScope, 'proj-1:worktree-a')).toBe(false);
  });

  it('setOpen records the flag under the active scope from active-bases-store', () => {
    useActiveBasesStore.setState({ scopeKey: 'proj-1:worktree-a' });

    useWorkspaceFilesPanel.getState().setOpen(true);

    expect(useWorkspaceFilesPanel.getState().openByScope['proj-1:worktree-a']).toBe(true);
  });

  it('keeps two scopes independent', () => {
    useActiveBasesStore.setState({ scopeKey: 'proj-1:worktree-a' });
    useWorkspaceFilesPanel.getState().setOpen(true);

    useActiveBasesStore.setState({ scopeKey: 'proj-2:worktree-b' });
    useWorkspaceFilesPanel.getState().setOpen(false);

    const { openByScope } = useWorkspaceFilesPanel.getState();
    expect(isWorkspaceFilesPanelOpen(openByScope, 'proj-1:worktree-a')).toBe(true);
    expect(isWorkspaceFilesPanelOpen(openByScope, 'proj-2:worktree-b')).toBe(false);
  });

  it('switching back to a scope restores its own open state', () => {
    useActiveBasesStore.setState({ scopeKey: 'proj-1:worktree-a' });
    useWorkspaceFilesPanel.getState().setOpen(true);
    useActiveBasesStore.setState({ scopeKey: 'proj-2:worktree-b' });

    useActiveBasesStore.setState({ scopeKey: 'proj-1:worktree-a' });

    expect(isWorkspaceFilesPanelOpen(useWorkspaceFilesPanel.getState().openByScope, 'proj-1:worktree-a')).toBe(true);
  });

  it('setOpen falls back to an unscoped bucket when there is no active scope (draft session)', () => {
    useActiveBasesStore.setState({ scopeKey: null });

    useWorkspaceFilesPanel.getState().setOpen(true);

    expect(isWorkspaceFilesPanelOpen(useWorkspaceFilesPanel.getState().openByScope, null)).toBe(true);
  });

  it('a scope other than the unscoped bucket is unaffected by the unscoped flag', () => {
    useActiveBasesStore.setState({ scopeKey: null });
    useWorkspaceFilesPanel.getState().setOpen(true);

    expect(isWorkspaceFilesPanelOpen(useWorkspaceFilesPanel.getState().openByScope, 'proj-1:worktree-a')).toBe(false);
  });
});
