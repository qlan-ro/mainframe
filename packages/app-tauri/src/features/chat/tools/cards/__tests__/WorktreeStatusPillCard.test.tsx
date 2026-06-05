/**
 * Tests for WorktreeStatusPillCard: EnterWorktreeCard and ExitWorktreeCard.
 */
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { TooltipProvider } from '@/components/ui/tooltip';
import { EnterWorktreeCard, ExitWorktreeCard } from '../WorktreeStatusPillCard';
import type { ToolCallMessagePartProps, ToolCallMessagePartStatus } from '@assistant-ui/react';

// ── Helpers ───────────────────────────────────────────────────────────────────

const noop = () => {};
const doneStatus: ToolCallMessagePartStatus = { type: 'complete' };
const runningStatus: ToolCallMessagePartStatus = { type: 'running' };

function renderEnter(
  overrides: {
    args?: ToolCallMessagePartProps['args'];
    result?: unknown;
    isError?: boolean;
    status?: ToolCallMessagePartStatus;
  } = {},
) {
  const defaults: ToolCallMessagePartProps = {
    type: 'tool-call' as const,
    toolName: 'EnterWorktree',
    toolCallId: 'enter-1',
    args: { name: 'feat/my-feature' },
    argsText: '',
    result: JSON.stringify({
      worktreePath: '/repos/project/.worktrees/feat-my-feature',
      worktreeBranch: 'feat/my-feature',
    }),
    isError: false,
    status: doneStatus,
    messages: [],
    addResult: noop,
    resume: noop,
    respondToApproval: noop,
    ...overrides,
  };
  return render(
    <TooltipProvider>
      <EnterWorktreeCard {...defaults} />
    </TooltipProvider>,
  );
}

function renderExit(
  overrides: {
    args?: ToolCallMessagePartProps['args'];
    result?: unknown;
    isError?: boolean;
    status?: ToolCallMessagePartStatus;
  } = {},
) {
  const defaults: ToolCallMessagePartProps = {
    type: 'tool-call' as const,
    toolName: 'ExitWorktree',
    toolCallId: 'exit-1',
    args: { action: 'remove' },
    argsText: '',
    result: 'done',
    isError: false,
    status: doneStatus,
    messages: [],
    addResult: noop,
    resume: noop,
    respondToApproval: noop,
    ...overrides,
  };
  return render(
    <TooltipProvider>
      <ExitWorktreeCard {...defaults} />
    </TooltipProvider>,
  );
}

// ── EnterWorktreeCard — done ──────────────────────────────────────────────────

describe('EnterWorktreeCard — done state', () => {
  it('renders "Entered worktree:" with the name from args', () => {
    renderEnter();
    const pill = screen.getByTestId('chat-worktree-enter-pill');
    expect(pill).toHaveTextContent('Entered worktree:');
    expect(pill).toHaveTextContent('feat/my-feature');
  });

  it('uses worktreeBranch from result JSON when args.name is absent', () => {
    renderEnter({
      args: {},
      result: JSON.stringify({ worktreePath: '/repos/.worktrees/fix-bug', worktreeBranch: 'fix/critical-bug' }),
    });
    expect(screen.getByTestId('chat-worktree-enter-pill')).toHaveTextContent('fix/critical-bug');
  });

  it('uses worktreePath from result JSON when neither args.name nor worktreeBranch is present', () => {
    renderEnter({
      args: {},
      result: JSON.stringify({ worktreePath: '/repos/.worktrees/some-path' }),
    });
    expect(screen.getByTestId('chat-worktree-enter-pill')).toHaveTextContent('/repos/.worktrees/some-path');
  });

  it('pill is non-expandable — always disabled', () => {
    renderEnter();
    expect(screen.getByTestId('chat-worktree-enter-pill')).toBeDisabled();
  });
});

// ── EnterWorktreeCard — pending ───────────────────────────────────────────────

describe('EnterWorktreeCard — pending state', () => {
  it('renders "Entering worktree…"', () => {
    renderEnter({ result: undefined, status: runningStatus });
    expect(screen.getByTestId('chat-worktree-enter-pill')).toHaveTextContent('Entering worktree…');
  });
});

// ── EnterWorktreeCard — error ─────────────────────────────────────────────────

describe('EnterWorktreeCard — error state', () => {
  it('renders "Failed to enter worktree"', () => {
    renderEnter({ result: 'some error', isError: true });
    expect(screen.getByTestId('chat-worktree-enter-pill')).toHaveTextContent('Failed to enter worktree');
  });

  it('detects error from result.isError=true', () => {
    renderEnter({ result: { isError: true }, isError: false });
    expect(screen.getByTestId('chat-worktree-enter-pill')).toHaveTextContent('Failed to enter worktree');
  });
});

// ── ExitWorktreeCard — done ───────────────────────────────────────────────────

describe('ExitWorktreeCard — done state', () => {
  it('renders "Removed worktree" when action=remove', () => {
    renderExit({ args: { action: 'remove' } });
    expect(screen.getByTestId('chat-worktree-exit-pill')).toHaveTextContent('Removed worktree');
  });

  it('renders "Exited worktree (kept)" when action=keep', () => {
    renderExit({ args: { action: 'keep' } });
    expect(screen.getByTestId('chat-worktree-exit-pill')).toHaveTextContent('Exited worktree (kept)');
  });

  it('defaults to "Exited worktree (kept)" when action is absent', () => {
    renderExit({ args: {} });
    expect(screen.getByTestId('chat-worktree-exit-pill')).toHaveTextContent('Exited worktree (kept)');
  });

  it('pill is non-expandable — always disabled', () => {
    renderExit();
    expect(screen.getByTestId('chat-worktree-exit-pill')).toBeDisabled();
  });
});

// ── ExitWorktreeCard — pending ────────────────────────────────────────────────

describe('ExitWorktreeCard — pending state', () => {
  it('renders "Exiting worktree…"', () => {
    renderExit({ result: undefined, status: runningStatus });
    expect(screen.getByTestId('chat-worktree-exit-pill')).toHaveTextContent('Exiting worktree…');
  });
});

// ── ExitWorktreeCard — error ──────────────────────────────────────────────────

describe('ExitWorktreeCard — error state', () => {
  it('renders "Failed to exit worktree"', () => {
    renderExit({ result: 'error', isError: true });
    expect(screen.getByTestId('chat-worktree-exit-pill')).toHaveTextContent('Failed to exit worktree');
  });
});
