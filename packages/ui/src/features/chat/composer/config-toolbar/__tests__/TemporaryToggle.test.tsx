/**
 * TemporaryToggle — behavior tests (todo #346).
 *
 * Three states:
 *  1. draft, off — interactive, clicking toggles on.
 *  2. draft, on — interactive, clicking toggles off.
 *  3. real chat, temporary — engaged but locked (aria-disabled, no setTemporary call).
 *  4. real chat, non-temporary — renders nothing.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { Chat } from '@qlan-ro/mainframe-types';
import { TooltipProvider } from '@/components/ui/tooltip';
import { setDraftConfig, clearDraftConfig, type DraftCfg } from '@/features/sessions/runtime/draft-config';
import { TemporaryToggle } from '../TemporaryToggle';

beforeEach(() => {
  clearDraftConfig('__LOCALID_wt');
});

function makeDraftCfg(overrides: Partial<DraftCfg> = {}): DraftCfg {
  return { projectId: 'p1', adapterId: 'claude', ...overrides };
}

function makeChat(overrides: Partial<Chat> = {}): Chat {
  return {
    id: 'c1',
    adapterId: 'claude',
    projectId: 'p1',
    status: 'active',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    totalCost: 0,
    totalTokensInput: 0,
    totalTokensOutput: 0,
    lastContextTokensInput: 0,
    temporary: false,
    noProject: false,
    ...overrides,
  };
}

function renderToggle(chat: Chat, draftMode: boolean, setTemporary = vi.fn()) {
  render(
    <TooltipProvider>
      <TemporaryToggle chat={chat} draftMode={draftMode} setTemporary={setTemporary} />
    </TooltipProvider>,
  );
  return setTemporary;
}

describe('TemporaryToggle — draft, off', () => {
  it('renders interactive and calls setTemporary(true) on click', async () => {
    const setTemporary = renderToggle(makeChat({ temporary: false }), true);

    const button = screen.getByTestId('composer-temporary-toggle');
    expect(button).toHaveAttribute('aria-pressed', 'false');
    expect(button).not.toHaveAttribute('aria-disabled');

    await userEvent.click(button);
    expect(setTemporary).toHaveBeenCalledExactlyOnceWith(true);
  });
});

describe('TemporaryToggle — draft, on', () => {
  it('renders engaged and calls setTemporary(false) on click', async () => {
    const setTemporary = renderToggle(makeChat({ temporary: true }), true);

    const button = screen.getByTestId('composer-temporary-toggle');
    expect(button).toHaveAttribute('aria-pressed', 'true');

    await userEvent.click(button);
    expect(setTemporary).toHaveBeenCalledExactlyOnceWith(false);
  });
});

describe('TemporaryToggle — real chat, temporary', () => {
  it('renders engaged but locked, and never calls setTemporary on click', async () => {
    const setTemporary = renderToggle(makeChat({ temporary: true }), false);

    const button = screen.getByTestId('composer-temporary-toggle');
    expect(button).toHaveAttribute('aria-pressed', 'true');
    expect(button).toHaveAttribute('aria-disabled', 'true');

    await userEvent.click(button);
    expect(setTemporary).not.toHaveBeenCalled();
  });
});

describe('TemporaryToggle — real chat, non-temporary', () => {
  it('renders nothing', () => {
    renderToggle(makeChat({ temporary: false }), false);

    expect(screen.queryByTestId('composer-temporary-toggle')).toBeNull();
  });
});

describe('TemporaryToggle — a11y', () => {
  it('keeps a stable aria-label regardless of state, letting aria-pressed carry it', () => {
    renderToggle(makeChat({ temporary: true }), true);
    expect(screen.getByTestId('composer-temporary-toggle')).toHaveAttribute('aria-label', 'Temporary chat');
  });
});

describe('TemporaryToggle — mutually exclusive with a worktree (todo #346)', () => {
  it('locks off and hints "Not available with a worktree" when the draft has an attached worktree', () => {
    const setTemporary = renderToggle(
      makeChat({ id: '__LOCALID_wt', temporary: false, worktreePath: '/repo/.worktrees/feat' }),
      true,
    );

    const button = screen.getByTestId('composer-temporary-toggle');
    expect(button).toHaveAttribute('aria-disabled', 'true');
    expect(button).toHaveAttribute('aria-pressed', 'false');

    void userEvent.click(button);
    expect(setTemporary).not.toHaveBeenCalled();
  });

  it('locks off when the draft has a pending ("New") worktree staged, even without chat.worktreePath', () => {
    setDraftConfig('__LOCALID_wt', makeDraftCfg({ pendingWorktree: { baseBranch: 'main', branchName: 'feat/x' } }));

    render(
      <TooltipProvider>
        <TemporaryToggle chat={makeChat({ id: '__LOCALID_wt', temporary: false })} draftMode setTemporary={vi.fn()} />
      </TooltipProvider>,
    );

    expect(screen.getByTestId('composer-temporary-toggle')).toHaveAttribute('aria-disabled', 'true');
  });
});

describe('TemporaryToggle — hover chrome', () => {
  it('keeps the engaged background on hover for a locked, active (real temporary) chat', () => {
    renderToggle(makeChat({ temporary: true }), false);
    const button = screen.getByTestId('composer-temporary-toggle');
    expect(button.className).toContain('bg-sidebar-selection');
    expect(button.className).not.toContain('hover:bg-transparent');
  });

  it('still suppresses the hover fill for a locked, inactive (worktree-blocked draft) chip', () => {
    renderToggle(makeChat({ id: '__LOCALID_wt', temporary: false, worktreePath: '/repo/.worktrees/feat' }), true);
    const button = screen.getByTestId('composer-temporary-toggle');
    expect(button.className).toContain('hover:bg-transparent');
  });
});
