import { useState } from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, it, vi } from 'vitest';
import { TooltipProvider } from '@/components/ui/tooltip';
import { useDisplayBranch } from '@/features/sessions/use-display-branch';
import { BranchPopover } from '../BranchPopover';

const git = vi.hoisted(() => ({
  branch: 'topic',
  read: vi.fn(),
  checkout: vi.fn(),
}));

vi.mock('@/lib/api/git', () => ({
  getGitBranch: git.read,
  getGitBranches: async () => ({
    current: git.branch,
    local: [
      { name: 'topic', current: git.branch === 'topic' },
      { name: 'main', current: git.branch === 'main' },
    ],
    remote: [],
    worktrees: [],
  }),
  getProjectWorktrees: async () => [],
  getGitStatus: async () => [],
  gitCheckout: git.checkout,
}));
vi.mock('../use-new-session-action', () => ({ useNewSessionAction: () => vi.fn() }));

function Harness() {
  const [open, setOpen] = useState(true);
  const { branch, refetch } = useDisplayBranch({
    port: 1,
    projectId: 'project',
    chatId: 'chat',
    branchName: 'topic',
    worktreePath: '/repo/topic',
  });
  return (
    <TooltipProvider>
      <output data-testid="display-branch">{branch}</output>
      <BranchPopover
        port={1}
        projectId="project"
        chatId="chat"
        open={open}
        onOpenChange={setOpen}
        onBranchChanged={refetch}
      />
    </TooltipProvider>
  );
}

it('updates the live branch after checkout through the branch manager', async () => {
  git.read.mockImplementation(async () => ({ branch: git.branch }));
  git.checkout.mockImplementation(async (_port, _project, branch) => {
    git.branch = branch;
  });
  const user = userEvent.setup();
  render(<Harness />);
  expect(screen.getByTestId('display-branch')).toHaveTextContent('topic');
  await user.click(await screen.findByTestId('git-branch-row-main'));
  fireEvent.click(await screen.findByTestId('git-submenu-checkout'));
  await waitFor(() => expect(screen.getByTestId('display-branch')).toHaveTextContent('main'));
  expect(git.checkout).toHaveBeenCalledWith(1, 'project', 'main', 'chat');
  expect(git.read).toHaveBeenCalledTimes(2);
});
