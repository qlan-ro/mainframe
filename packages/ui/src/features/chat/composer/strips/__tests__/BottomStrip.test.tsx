/** Where the session runs, its branch and its changes, under the card (K6, K8). */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { TooltipProvider } from '@/components/ui/tooltip';
import type { Chat } from '@qlan-ro/mainframe-types';

let mockChat: Partial<Chat> | null;
let mockListed: object | undefined;
let mockColumn: string;
vi.mock('@assistant-ui/react', () => ({
  useAuiState: (select: (s: unknown) => unknown) =>
    select({
      thread: { messages: [{}], isRunning: false },
      threadListItem: { id: 'chat-1', remoteId: mockListed && 'chat-1', status: 'regular', custom: mockListed },
      threads: { threadItems: [], mainThreadId: mockColumn },
    }),
}));
vi.mock('../../../runtime/chat-extras', () => ({
  useChatExtrasSelector: (select: (extras: unknown) => unknown) => select({ state: { chatConfig: mockChat } }),
}));
vi.mock('@/features/sessions/runtime/daemon-port-context', () => ({ useDaemonPort: () => 31415 }));
let mockBranch: string | undefined;
vi.mock('@/features/sessions/use-display-branch', () => ({
  useDisplayBranch: () => ({ branch: mockBranch, liveBranch: mockBranch, refetch: vi.fn() }),
}));
vi.mock('@/features/sessions/use-active-identity', () => ({
  useActiveIdentity: () => ({ projectPath: '/Users/me/repo' }),
}));
vi.mock('@/features/git/BranchPopover', () => ({
  BranchPopover: ({ children }: { children: React.ReactElement }) => children,
}));
vi.mock('../../config-toolbar/WorktreePopover', () => ({
  WorktreePopover: ({ children }: { children: React.ReactElement }) => children,
}));
type Changes = { files: { path: string; additions?: number }[]; totalAdditions?: number; totalDeletions?: number };
const changesOptions = vi.fn();
let mockChanges: Changes & { loading: boolean; error: boolean };
vi.mock('@/features/review/use-working-changes', () => ({
  useWorkingChanges: (options: unknown) => {
    changesOptions(options);
    return mockChanges;
  },
  toChangesSummary: (c: Changes) => ({
    fileCount: c.files.length,
    additions: c.totalAdditions,
    deletions: c.totalDeletions,
  }),
}));
const emit = vi.fn();
vi.mock('@/store/surface-intents', () => ({ emitSurfaceIntent: (...a: unknown[]) => emit(...a) }));

import { BottomStrip } from '../BottomStrip';

const CHAT: Partial<Chat> = { id: 'chat-1', projectId: 'p1', temporary: false, noProject: false };
const renderStrip = ({ fixed }: { fixed?: boolean } = {}) =>
  render(
    <TooltipProvider>
      <BottomStrip fixed={fixed} />
    </TooltipProvider>,
  );

beforeEach(() => {
  vi.clearAllMocks();
  mockChat = CHAT;
  mockListed = undefined;
  mockColumn = 'chat-1';
  mockBranch = 'feat/quota';
  mockChanges = { files: [], loading: false, error: false };
});

describe('BottomStrip', () => {
  it('is absent before the session exists', () => {
    mockChat = { ...CHAT, id: '__LOCALID_1' };
    renderStrip();
    expect(screen.queryByTestId('composer-bottom-strip')).toBeNull();
  });

  it('is absent for a session with no project', () => {
    mockChat = { ...CHAT, noProject: true };
    renderStrip();
    expect(screen.queryByTestId('composer-bottom-strip')).toBeNull();
  });

  it('names the local checkout, and keeps the branch manager beside it', () => {
    renderStrip();
    expect(screen.getByTestId('composer-worktree-trigger')).toHaveTextContent('Local');
    expect(screen.getByTestId('composer-worktree-trigger')).toHaveAccessibleName(
      'Runs in the local checkout, repo. Isolate in a worktree',
    );
    expect(screen.getByTestId('composer-branch')).toHaveTextContent('feat/quota');
  });

  it('puts the decorative separator between the controls, outside both accessible names', () => {
    renderStrip();
    const where = screen.getByTestId('composer-worktree-trigger');
    const branch = screen.getByTestId('composer-branch');
    const dot = screen.getByText('·');
    expect(where.nextElementSibling).toBe(dot);
    expect(dot.nextElementSibling).toBe(branch);
    expect(dot).toHaveAttribute('aria-hidden', 'true');
    expect(branch).toHaveAccessibleName('Branch feat/quota. Manage branches');
  });

  it('shows the stored base only while the worktree is on its recorded branch', () => {
    mockChat = { ...CHAT, worktreePath: '/wt/q', branchName: 'feat/quota', baseBranch: 'release/stable' };
    const view = renderStrip();
    const branch = screen.getByTestId('composer-branch');
    expect(branch).toHaveAccessibleName('Branch feat/quota from release/stable. Manage branches');
    expect(branch).toHaveTextContent('feat/quota from release/stable');
    expect(screen.getByTitle('feat/quota from release/stable')).toBeVisible();

    mockBranch = 'feat/other';
    view.rerender(
      <TooltipProvider>
        <BottomStrip />
      </TooltipProvider>,
    );
    expect(branch).toHaveTextContent('feat/other');
    expect(branch).not.toHaveTextContent('from release/stable');
  });

  it('omits From for a worktree without a recorded base', () => {
    mockChat = { ...CHAT, worktreePath: '/wt/q', branchName: 'feat/quota' };
    renderStrip();
    expect(screen.getByTestId('composer-branch')).toHaveTextContent('feat/quota');
    expect(screen.getByTestId('composer-branch')).not.toHaveTextContent('from');
  });

  it('names a worktree', () => {
    mockChat = { ...CHAT, worktreePath: '/repo/.worktrees/q' };
    renderStrip();
    expect(screen.getByTestId('composer-worktree-trigger')).toHaveTextContent('Worktree');
    expect(screen.getByTestId('composer-worktree-trigger')).toHaveAccessibleName(
      'Runs in a worktree, q. Worktree options',
    );
  });

  it('leaves the branch out while none resolves', () => {
    mockBranch = undefined;
    renderStrip();
    expect(screen.queryByTestId('composer-branch')).toBeNull();
    expect(screen.queryByText('·')).toBeNull();
    expect(screen.getByTestId('composer-worktree-trigger')).toBeInTheDocument();
  });

  it('in a workspace tab, it keeps the branch but not the changes: the review is the chat column’s', () => {
    mockChanges = { files: [{ path: 'a.ts' }], totalAdditions: 1, totalDeletions: 0, loading: false, error: false };
    mockColumn = 'another-chat';
    renderStrip();
    expect(screen.getByTestId('composer-branch')).toBeInTheDocument();
    expect(screen.queryByTestId('composer-changes')).toBeNull();
  });

  it('fixed, it names where the session runs, offers no move, and keeps the branch and the changes', () => {
    mockChat = { ...CHAT, worktreePath: '/repo/.worktrees/q' };
    mockChanges = { files: [{ path: 'a.ts' }], totalAdditions: 1, totalDeletions: 0, loading: false, error: false };
    renderStrip({ fixed: true });
    expect(screen.getByTestId('composer-where')).toHaveTextContent('Worktree');
    expect(screen.getByTestId('composer-where')).toHaveAccessibleName('Runs in a worktree, q');
    expect(screen.queryByTestId('composer-worktree-trigger')).toBeNull();
    expect(screen.getByTestId('composer-branch')).toHaveTextContent('feat/quota');
    expect(screen.getByTestId('composer-changes')).toBeInTheDocument();
  });

  const CHANGED = {
    files: [{ path: 'a.ts' }],
    totalAdditions: 1,
    totalDeletions: 0,
    loading: false,
    error: false,
  };

  it('a temporary session says so, offers no worktree, and keeps its changes', () => {
    mockChat = { ...CHAT, temporary: true };
    mockChanges = CHANGED;
    renderStrip();
    expect(screen.getByTestId('composer-temporary')).toHaveAttribute('aria-disabled', 'true');
    expect(screen.queryByTestId('composer-worktree-trigger')).toBeNull();
    expect(screen.getByTestId('composer-changes')).toBeInTheDocument();
  });

  it('a temporary session with no changes shows none', () => {
    mockChat = { ...CHAT, temporary: true };
    renderStrip();
    expect(screen.queryByTestId('composer-changes')).toBeNull();
  });

  it('a temporary session with no project has neither branch nor changes', () => {
    mockChat = { ...CHAT, temporary: true, noProject: true };
    mockChanges = CHANGED;
    renderStrip();
    expect(screen.getByTestId('composer-temporary')).toBeInTheDocument();
    expect(screen.queryByTestId('composer-branch')).toBeNull();
    expect(screen.queryByTestId('composer-changes')).toBeNull();
  });

  describe('before the session’s own record has loaded', () => {
    const LISTED = { projectId: 'p1', temporary: false, noProject: false, worktreePath: '/repo/.worktrees/q' };
    beforeEach(() => {
      mockChat = null;
      mockListed = LISTED;
      mockChanges = CHANGED;
    });

    it('shows what the list knows, and offers no move yet', () => {
      renderStrip();
      expect(screen.getByTestId('composer-where')).toHaveAccessibleName('Runs in a worktree, q');
      expect(screen.queryByTestId('composer-worktree-trigger')).toBeNull();
      expect(screen.getByTestId('composer-branch')).toHaveTextContent('feat/quota');
      expect(screen.getByTestId('composer-changes')).toBeInTheDocument();
      expect(changesOptions).toHaveBeenLastCalledWith(expect.objectContaining({ projectId: 'p1', chatId: 'chat-1' }));
    });

    it('a temporary session reads as one at once', () => {
      mockListed = { ...LISTED, temporary: true };
      renderStrip();
      expect(screen.getByTestId('composer-temporary')).toBeInTheDocument();
      expect(screen.queryByTestId('composer-where')).toBeNull();
    });

    it('is absent for one with no project, and while the list has not it either', () => {
      mockListed = { ...LISTED, noProject: true };
      const { unmount } = renderStrip();
      expect(screen.queryByTestId('composer-bottom-strip')).toBeNull();
      unmount();
      mockListed = undefined;
      renderStrip();
      expect(screen.queryByTestId('composer-bottom-strip')).toBeNull();
    });
  });
});

describe('ChangesButton', () => {
  const some = { files: [{ path: 'src/a.ts' }, { path: 'src/b.ts' }], totalAdditions: 22, totalDeletions: 1 };

  it('reads the branch once, not again with the changes', () => {
    renderStrip();
    expect(changesOptions).toHaveBeenLastCalledWith(
      expect.objectContaining({ projectId: 'p1', chatId: 'chat-1', withBranch: false }),
    );
  });

  it('is hidden with no changes', () => {
    renderStrip();
    expect(screen.queryByTestId('composer-changes')).toBeNull();
  });

  it.each([
    ['loading', { loading: true, error: false }],
    ['failed', { loading: false, error: true }],
  ])('claims nothing while the changes are %s', (_name, status) => {
    mockChanges = { ...some, ...status };
    renderStrip();
    expect(screen.queryByTestId('composer-changes')).toBeNull();
  });

  it('shows the counts, lists the files and opens the diff', () => {
    mockChanges = { ...some, loading: false, error: false };
    renderStrip();
    const button = screen.getByTestId('composer-changes');
    expect(button).toHaveTextContent('+22−1');
    expect(button).toHaveAttribute('aria-label', 'Changes: 2 changed files');

    fireEvent.click(button);
    expect(screen.getByText('src/b.ts').closest('[title]')).toHaveAttribute('title', 'src/b.ts');
    expect(screen.getByText('Changes · 2 files')).toBeInTheDocument();
    expect(screen.getByText('+22 −1 across 2 files')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('composer-changes-open-diff'));
    expect(emit).toHaveBeenCalledExactlyOnceWith({ type: 'open-review' });
  });

  it('shortens paths and shows full names when two suffixes collide', () => {
    const files = ['first/src/a.ts', 'second/src/a.ts', 'first/src/b.ts'].map((path) => ({ path }));
    mockChanges = { ...some, files, loading: false, error: false };
    renderStrip();
    fireEvent.click(screen.getByTestId('composer-changes'));
    expect(screen.getByText('first/src/a.ts')).toBeVisible();
    expect(screen.getByText('second/src/a.ts')).toBeVisible();
    expect(screen.getByRole('img', { name: 'first/src/b.ts' })).toHaveTextContent('src/b.ts');
  });

  it('counts files where the daemon reports no lines, instead of a false zero', () => {
    mockChanges = { files: [{ path: 'a.ts' }], loading: false, error: false };
    renderStrip();
    expect(screen.getByTestId('composer-changes')).toHaveTextContent('1 changed file');
  });

  it('caps the list and says how many more there are', () => {
    mockChanges = {
      files: Array.from({ length: 11 }, (_, i) => ({ path: `f${i}.ts` })),
      loading: false,
      error: false,
    };
    renderStrip();
    fireEvent.click(screen.getByTestId('composer-changes'));
    expect(screen.getByText('f7.ts')).toBeInTheDocument();
    expect(screen.queryByText('f8.ts')).toBeNull();
    expect(screen.getByText('and 3 more')).toBeInTheDocument();
  });
});
