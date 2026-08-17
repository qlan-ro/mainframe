/**
 * WorktreeMenu — the Agent card's worktree chip + popover (todo #234 T15).
 * The chip states the branch the step will run on; the popover owns the
 * isolate switch, the branch name (`$`-variables only — branch names take
 * `$refs`, never slash commands or `@`-files) and the base branch.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { AskAgentStep } from '../../../contract';
import { useAutomationsStore } from '../../../data/use-automations-store';
import { WorktreeMenu } from '../WorktreeMenu';

vi.mock('@/lib/api/git', () => ({
  getGitBranches: vi.fn(async () => ({ local: [{ name: 'main' }, { name: 'dev' }], current: 'main' })),
}));

type Worktree = NonNullable<AskAgentStep['worktree']>;

const WORKTREE: Worktree = { baseBranch: 'main', branchName: [] };

beforeEach(() => {
  useAutomationsStore.setState({ scopeProjectId: 'proj-1' });
});

afterEach(() => {
  useAutomationsStore.setState({ scopeProjectId: null });
});

describe('WorktreeMenu — chip', () => {
  it('reads "no worktree" when the step runs in place', () => {
    render(<WorktreeMenu worktree={undefined} onChange={vi.fn()} tokens={[]} testId="agent-a" />);
    const chip = screen.getByTestId('agent-a-worktree');
    expect(chip).toHaveTextContent('no worktree');
    expect(chip).toHaveAttribute('aria-label', 'Worktree: no worktree');
  });

  it('reads the branch name in monospace once one is set', () => {
    const worktree: Worktree = { baseBranch: 'main', branchName: ['todo/$id'] };
    render(<WorktreeMenu worktree={worktree} onChange={vi.fn()} tokens={[]} testId="agent-a" />);
    const chip = screen.getByTestId('agent-a-worktree');
    expect(chip).toHaveTextContent('todo/$id');
    expect(chip.querySelector('.font-mono')).not.toBeNull();
  });

  it('reads "new worktree" while an isolated branch is still unnamed', () => {
    render(<WorktreeMenu worktree={WORKTREE} onChange={vi.fn()} tokens={[]} testId="agent-a" />);
    expect(screen.getByTestId('agent-a-worktree')).toHaveTextContent('new worktree');
  });
});

describe('WorktreeMenu — popover', () => {
  it('seeds a worktree when the isolate switch is turned on', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<WorktreeMenu worktree={undefined} onChange={onChange} tokens={[]} testId="agent-a" />);
    await user.click(screen.getByTestId('agent-a-worktree'));
    await user.click(screen.getByTestId('agent-a-worktree-toggle'));
    expect(onChange).toHaveBeenCalledExactlyOnceWith({ worktree: { baseBranch: 'main', branchName: [] } });
  });

  it('clears the worktree when the isolate switch is turned off', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<WorktreeMenu worktree={WORKTREE} onChange={onChange} tokens={[]} testId="agent-a" />);
    await user.click(screen.getByTestId('agent-a-worktree'));
    await user.click(screen.getByTestId('agent-a-worktree-toggle'));
    expect(onChange).toHaveBeenCalledExactlyOnceWith({ worktree: undefined });
  });

  it('hides the branch fields until a worktree exists', async () => {
    const user = userEvent.setup();
    render(<WorktreeMenu worktree={undefined} onChange={vi.fn()} tokens={[]} testId="agent-a" />);
    await user.click(screen.getByTestId('agent-a-worktree'));
    expect(screen.getByTestId('agent-a-worktree-toggle')).toBeInTheDocument();
    expect(screen.queryByTestId('agent-a-worktree-branch')).not.toBeInTheDocument();
  });

  it('writes the branch name as ChipText, leaving "/" literal (variables-only field)', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<WorktreeMenu worktree={WORKTREE} onChange={onChange} tokens={[]} testId="agent-a" />);
    await user.click(screen.getByTestId('agent-a-worktree'));
    await user.click(screen.getByTestId('agent-a-worktree-branch'));
    await user.keyboard('/');
    expect(screen.queryByTestId('agent-a-worktree-branch-trigger-popover')).not.toBeInTheDocument();
    expect(onChange).toHaveBeenLastCalledWith({ worktree: { baseBranch: 'main', branchName: ['/'] } });
  });

  it('patches the base branch from the shared branch picker, scoped to the automation’s project', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<WorktreeMenu worktree={WORKTREE} onChange={onChange} tokens={[]} testId="agent-a" />);
    await user.click(screen.getByTestId('agent-a-worktree'));
    await waitFor(() => expect(screen.getByTestId('agent-a-worktree-base')).toHaveTextContent('main (current)'));
    await user.click(screen.getByTestId('agent-a-worktree-base'));
    await user.click(screen.getByTestId('agent-a-worktree-base-option-dev'));
    expect(onChange).toHaveBeenLastCalledWith({ worktree: { baseBranch: 'dev', branchName: [] } });
  });
});
