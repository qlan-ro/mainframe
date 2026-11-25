/** Where a new session runs (K7): the branch, a worktree, or a temporary session. */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { getActiveDaemon, setActiveDaemon } from '@/lib/daemon/active-daemon';
import { TooltipProvider } from '@/components/ui/tooltip';
import { useProjectsStore } from '@/store/projects';
import type { DraftCfg } from '@/features/sessions/runtime/draft-config';

const { git, checkout, patch } = vi.hoisted(() => ({
  git: { getGitBranch: vi.fn(), getGitBranches: vi.fn(), getProjectWorktrees: vi.fn() },
  checkout: vi.fn(),
  patch: vi.fn(),
}));
vi.mock('@/lib/api/git', () => git);
vi.mock('@/features/sessions/runtime/daemon-port-context', () => ({ useDaemonPort: () => 31415 }));
vi.mock('@/features/sessions/runtime/draft-config', () => ({ patchDraftConfig: (...a: unknown[]) => patch(...a) }));
const toastInfo = vi.hoisted(() => vi.fn());
vi.mock('@/lib/toast', () => ({ mfToast: { info: toastInfo, error: vi.fn() } }));
vi.mock('@/features/git/use-branch-actions', () => ({ useBranchActions: () => ({ handleCheckout: checkout }) }));
vi.mock('@/features/git/BranchPopover', () => ({
  BranchPopover: ({ open }: { open: boolean }) => (open ? <div data-testid="git-branch-popover" /> : null),
}));

import { draftItemsOf, useDraftContent } from '../../draft-content/draft-content-store';
import { DraftBranchPicker } from '../DraftBranchPicker';
import { useProjectBranches } from '../project-branches';

const DRAFT: DraftCfg = { projectId: 'p1', adapterId: 'claude' };
const NONE = { worktreePath: undefined, branchName: undefined, pendingWorktree: undefined, temporary: false };

async function openPicker(draft: DraftCfg = DRAFT) {
  render(
    <TooltipProvider>
      <DraftBranchPicker localId="local-1" projectId="p1" draft={draft} />
    </TooltipProvider>,
  );
  fireEvent.click(screen.getByTestId('composer-branch-picker'));
  await screen.findByTestId('composer-branch-option-main');
}
const pick = (testId: string) => fireEvent.click(screen.getByTestId(testId));

beforeEach(() => {
  vi.resetAllMocks();
  useProjectBranches.setState({ byProject: {} });
  checkout.mockResolvedValue(true);
  git.getGitBranch.mockResolvedValue({ branch: 'main' });
  git.getGitBranches.mockResolvedValue({
    current: 'main',
    local: [{ name: 'main' }, { name: 'feat/x' }],
    remote: [],
    worktrees: [],
  });
  git.getProjectWorktrees.mockResolvedValue([
    { path: '/repo', branch: 'refs/heads/main' },
    { path: '/repo/.worktrees/old', branch: 'refs/heads/feat/old' },
    { path: '/repo/.worktrees/loose', branch: null },
  ]);
});

it('ignores a branch menu response from the previous daemon', async () => {
  const original = getActiveDaemon();
  let answer!: (result: object) => void;
  git.getGitBranches.mockReturnValueOnce(new Promise((resolve) => (answer = resolve)));
  render(
    <TooltipProvider>
      <DraftBranchPicker localId="local-1" projectId="p1" draft={DRAFT} />
    </TooltipProvider>,
  );
  pick('composer-branch-picker');
  try {
    setActiveDaemon({ ...original, id: 'another-daemon' });
    await act(async () => answer({ current: 'stale', local: [{ name: 'stale' }] }));
    expect(screen.queryByTestId('composer-branch-option-stale')).toBeNull();
    expect(useProjectBranches.getState().byProject.p1).toBe('main');
  } finally {
    setActiveDaemon(original);
  }
});

it('hides loaded branch options immediately when the project changes', async () => {
  const picker = (projectId: string) => (
    <TooltipProvider>
      <DraftBranchPicker localId="local-1" projectId={projectId} draft={{ ...DRAFT, projectId }} />
    </TooltipProvider>
  );
  const app = render(picker('p1'));
  pick('composer-branch-picker');
  await screen.findByTestId('composer-branch-option-main');
  git.getGitBranches.mockReturnValueOnce(new Promise(() => {}));
  app.rerender(picker('p2'));
  expect(screen.queryByTestId('composer-branch-option-main')).toBeNull();
});

describe('what belongs to the checkout', () => {
  const note = { kind: 'code', filePath: 'a', startLine: 1, endLine: 1, lineContent: 'a', note: 'n' } as const;
  const left = () => draftItemsOf('local-1').length;
  beforeEach(() => {
    useDraftContent.setState({ byThread: {} });
    useDraftContent.getState().add('local-1', [note]);
  });

  it.each([['composer-branch-new-worktree'], ['composer-branch-worktree-feat/old']])(
    'goes when the session moves to a worktree: %s',
    async (option) => {
      await openPicker();
      pick(option);
      expect(left()).toBe(0);
      expect(toastInfo).toHaveBeenCalledExactlyOnceWith(
        'Draft changed',
        expect.objectContaining({ description: 'Removed 1 code note' }),
      );
    },
  );

  it('stays when it runs in the same checkout: another branch, or temporary', async () => {
    await openPicker();
    pick('composer-branch-option-feat/x');
    fireEvent.click(screen.getByTestId('composer-branch-picker'));
    await screen.findByTestId('composer-temporary-toggle');
    pick('composer-temporary-toggle');
    expect(left()).toBe(1);
    expect(toastInfo).not.toHaveBeenCalled();
  });
});

describe('DraftBranchPicker', () => {
  it('lists branches without a project heading', async () => {
    const { projects } = useProjectsStore.getState();
    useProjectsStore.setState({ projects: [{ id: 'p1', name: 'Actual project' } as (typeof projects)[number]] });
    try {
      await openPicker();
      expect(screen.queryByText('Actual project')).not.toBeInTheDocument();
      expect(screen.getByTestId('composer-branch-option-main')).toBeVisible();
      expect(screen.getByText('Manage branches…')).toBeInTheDocument();
    } finally {
      useProjectsStore.setState({ projects });
    }
  });
  it('tells the empty state which branch its menu found', async () => {
    git.getGitBranch.mockReturnValue(new Promise(() => {}));
    git.getGitBranches.mockResolvedValue({ current: 'feat/x', local: [{ name: 'main' }, { name: 'feat/x' }] });
    await openPicker();
    expect(useProjectBranches.getState().byProject['p1']).toBe('feat/x');
    expect(screen.getByTestId('composer-branch-picker')).toHaveTextContent('feat/x');
  });

  it('checks out another branch when the session runs in the checkout', async () => {
    await openPicker();
    pick('composer-branch-option-feat/x');
    expect(checkout).toHaveBeenCalledExactlyOnceWith('feat/x');
  });

  it('does not check out the branch that is already there', async () => {
    await openPicker();
    pick('composer-branch-option-main');
    expect(checkout).not.toHaveBeenCalled();
  });

  it('starts a new worktree from the current branch, and only suggests a free name', async () => {
    git.getGitBranches.mockResolvedValue({
      current: 'main',
      local: [{ name: 'main' }, { name: 'session-1' }],
      remote: [],
      worktrees: [],
    });
    await openPicker();
    pick('composer-branch-new-worktree');
    expect(patch).toHaveBeenCalledExactlyOnceWith('local-1', {
      ...NONE,
      pendingWorktree: { baseBranch: 'main', branchName: 'session-2' },
    });
  });

  it('with a new worktree on, picking a branch sets what it starts from instead of checking it out', async () => {
    await openPicker({ ...DRAFT, pendingWorktree: { baseBranch: 'main', branchName: 'mine' } });
    pick('composer-branch-option-feat/x');
    expect(checkout).not.toHaveBeenCalled();
    expect(patch).toHaveBeenCalledExactlyOnceWith('local-1', {
      ...NONE,
      pendingWorktree: { baseBranch: 'feat/x', branchName: 'mine' },
    });
  });

  it('refuses an invalid name for the new branch', async () => {
    await openPicker({ ...DRAFT, pendingWorktree: { baseBranch: 'main', branchName: 'mine' } });
    fireEvent.change(screen.getByTestId('composer-worktree-branch-name'), { target: { value: 'a..b' } });
    expect(patch).not.toHaveBeenCalled();
    expect(screen.getByTestId('composer-worktree-branch-name')).toHaveAttribute('aria-invalid', 'true');
  });

  it('Temporary drops a worktree: they exclude each other', async () => {
    await openPicker({ ...DRAFT, pendingWorktree: { baseBranch: 'main', branchName: 'mine' } });
    pick('composer-temporary-toggle');
    expect(patch).toHaveBeenCalledExactlyOnceWith('local-1', { ...NONE, temporary: true });
  });

  it('attaches an existing worktree, never the checkout itself', async () => {
    await openPicker();
    expect(screen.queryByTestId('composer-branch-worktree-main')).toBeNull();
    pick('composer-branch-worktree-feat/old');
    expect(patch).toHaveBeenCalledExactlyOnceWith('local-1', {
      ...NONE,
      worktreePath: '/repo/.worktrees/old',
      branchName: 'feat/old',
    });
  });

  it('offers a detached worktree by its folder', async () => {
    await openPicker();
    pick('composer-branch-worktree-loose (detached)');
    expect(patch).toHaveBeenCalledExactlyOnceWith('local-1', {
      ...NONE,
      worktreePath: '/repo/.worktrees/loose',
      branchName: 'detached',
    });
  });

  it('opens the branch manager', async () => {
    await openPicker();
    pick('composer-branch-manage');
    expect(screen.getByTestId('git-branch-popover')).toBeInTheDocument();
  });

  it('says why the branches could not be read', async () => {
    git.getGitBranches.mockRejectedValue(new Error('not a git repository'));
    render(
      <TooltipProvider>
        <DraftBranchPicker localId="local-1" projectId="p1" draft={DRAFT} />
      </TooltipProvider>,
    );
    fireEvent.click(screen.getByTestId('composer-branch-picker'));
    expect(await screen.findByText('not a git repository')).toBeInTheDocument();
  });
});
