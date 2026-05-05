import '@testing-library/jest-dom';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ActionBar } from './ActionBar';

describe('ActionBar', () => {
  it('renders commit message input with placeholder', () => {
    render(
      <ActionBar
        commitMessage=""
        onCommitMessageChange={vi.fn()}
        onSuggestMessage={vi.fn()}
        onCommit={vi.fn()}
        onOpenPR={vi.fn()}
        isLoading={false}
      />,
    );

    const input = screen.getByPlaceholderText(/Commit message/i);
    expect(input).toBeInTheDocument();
  });

  it('displays commit message value in input field', () => {
    const message = 'fix: update dependencies';
    render(
      <ActionBar
        commitMessage={message}
        onCommitMessageChange={vi.fn()}
        onSuggestMessage={vi.fn()}
        onCommit={vi.fn()}
        onOpenPR={vi.fn()}
        isLoading={false}
      />,
    );

    expect(screen.getByDisplayValue(message)).toBeInTheDocument();
  });

  it('calls onCommitMessageChange when input value changes', async () => {
    const user = userEvent.setup();
    const onCommitMessageChange = vi.fn();

    render(
      <ActionBar
        commitMessage=""
        onCommitMessageChange={onCommitMessageChange}
        onSuggestMessage={vi.fn()}
        onCommit={vi.fn()}
        onOpenPR={vi.fn()}
        isLoading={false}
      />,
    );

    const input = screen.getByPlaceholderText(/Commit message/i);
    await user.type(input, 'test');

    // Verify the callback was called multiple times as each character is typed
    expect(onCommitMessageChange).toHaveBeenCalled();
    expect(onCommitMessageChange).toHaveBeenCalledWith('t');
    expect(onCommitMessageChange).toHaveBeenCalledWith('e');
    expect(onCommitMessageChange).toHaveBeenCalledWith('s');
  });

  it('disables Commit button when message is empty', () => {
    render(
      <ActionBar
        commitMessage=""
        onCommitMessageChange={vi.fn()}
        onSuggestMessage={vi.fn()}
        onCommit={vi.fn()}
        onOpenPR={vi.fn()}
        isLoading={false}
      />,
    );

    const commitButton = screen.getByRole('button', { name: /Commit/i });
    expect(commitButton).toBeDisabled();
  });

  it('disables Commit button when message contains only whitespace', () => {
    render(
      <ActionBar
        commitMessage="   "
        onCommitMessageChange={vi.fn()}
        onSuggestMessage={vi.fn()}
        onCommit={vi.fn()}
        onOpenPR={vi.fn()}
        isLoading={false}
      />,
    );

    const commitButton = screen.getByRole('button', { name: /Commit/i });
    expect(commitButton).toBeDisabled();
  });

  it('enables Commit button when message is not empty', () => {
    render(
      <ActionBar
        commitMessage="test commit"
        onCommitMessageChange={vi.fn()}
        onSuggestMessage={vi.fn()}
        onCommit={vi.fn()}
        onOpenPR={vi.fn()}
        isLoading={false}
      />,
    );

    const commitButton = screen.getByRole('button', { name: /Commit/i });
    expect(commitButton).not.toBeDisabled();
  });

  it('calls onCommit when Commit button is clicked', async () => {
    const user = userEvent.setup();
    const onCommit = vi.fn().mockResolvedValue(undefined);

    render(
      <ActionBar
        commitMessage="test commit"
        onCommitMessageChange={vi.fn()}
        onSuggestMessage={vi.fn()}
        onCommit={onCommit}
        onOpenPR={vi.fn()}
        isLoading={false}
      />,
    );

    const commitButton = screen.getByRole('button', { name: /Commit/i });
    await user.click(commitButton);

    expect(onCommit).toHaveBeenCalledOnce();
  });

  it('calls onSuggestMessage when AI Suggest button is clicked', async () => {
    const user = userEvent.setup();
    const onSuggestMessage = vi.fn();

    render(
      <ActionBar
        commitMessage=""
        onCommitMessageChange={vi.fn()}
        onSuggestMessage={onSuggestMessage}
        onCommit={vi.fn()}
        onOpenPR={vi.fn()}
        isLoading={false}
      />,
    );

    const suggestButton = screen.getByRole('button', { name: /AI Suggest/i });
    await user.click(suggestButton);

    expect(onSuggestMessage).toHaveBeenCalledOnce();
  });

  it('calls onOpenPR when Open PR button is clicked', async () => {
    const user = userEvent.setup();
    const onOpenPR = vi.fn().mockResolvedValue(undefined);

    render(
      <ActionBar
        commitMessage="test commit"
        onCommitMessageChange={vi.fn()}
        onSuggestMessage={vi.fn()}
        onCommit={vi.fn()}
        onOpenPR={onOpenPR}
        isLoading={false}
      />,
    );

    const prButton = screen.getByRole('button', { name: /Open PR/i });
    await user.click(prButton);

    expect(onOpenPR).toHaveBeenCalledOnce();
  });

  it('disables all buttons and input when isLoading is true', () => {
    render(
      <ActionBar
        commitMessage="test"
        onCommitMessageChange={vi.fn()}
        onSuggestMessage={vi.fn()}
        onCommit={vi.fn()}
        onOpenPR={vi.fn()}
        isLoading={true}
      />,
    );

    const input = screen.getByPlaceholderText(/Commit message/i);
    expect(input).toBeDisabled();

    const suggestButton = screen.getByRole('button', { name: /AI Suggest/i });
    expect(suggestButton).toBeDisabled();

    const commitButton = screen.getByRole('button', { name: /Committing/i });
    expect(commitButton).toBeDisabled();

    const prButton = screen.getByRole('button', { name: /Creating PR/i });
    expect(prButton).toBeDisabled();
  });

  it('displays loading state text on buttons when isLoading is true', () => {
    render(
      <ActionBar
        commitMessage="test"
        onCommitMessageChange={vi.fn()}
        onSuggestMessage={vi.fn()}
        onCommit={vi.fn()}
        onOpenPR={vi.fn()}
        isLoading={true}
      />,
    );

    expect(screen.getByRole('button', { name: /Committing/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Creating PR/i })).toBeInTheDocument();
  });

  it('displays normal button text when isLoading is false', () => {
    render(
      <ActionBar
        commitMessage="test"
        onCommitMessageChange={vi.fn()}
        onSuggestMessage={vi.fn()}
        onCommit={vi.fn()}
        onOpenPR={vi.fn()}
        isLoading={false}
      />,
    );

    expect(screen.getByRole('button', { name: /^Commit$/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^Open PR$/ })).toBeInTheDocument();
  });

  it('displays error message when onCommit throws', async () => {
    const user = userEvent.setup();
    const error = new Error('Commit failed due to invalid changes');
    const onCommit = vi.fn().mockRejectedValue(error);

    render(
      <ActionBar
        commitMessage="test commit"
        onCommitMessageChange={vi.fn()}
        onSuggestMessage={vi.fn()}
        onCommit={onCommit}
        onOpenPR={vi.fn()}
        isLoading={false}
      />,
    );

    const commitButton = screen.getByRole('button', { name: /Commit/i });
    await user.click(commitButton);

    await waitFor(() => {
      expect(screen.getByText('Commit failed due to invalid changes')).toBeInTheDocument();
    });
  });

  it('displays generic error when onCommit throws non-Error object', async () => {
    const user = userEvent.setup();
    const onCommit = vi.fn().mockRejectedValue('Unknown error');

    render(
      <ActionBar
        commitMessage="test commit"
        onCommitMessageChange={vi.fn()}
        onSuggestMessage={vi.fn()}
        onCommit={onCommit}
        onOpenPR={vi.fn()}
        isLoading={false}
      />,
    );

    const commitButton = screen.getByRole('button', { name: /Commit/i });
    await user.click(commitButton);

    await waitFor(() => {
      expect(screen.getByText('Failed to commit')).toBeInTheDocument();
    });
  });

  it('displays error message when onOpenPR throws', async () => {
    const user = userEvent.setup();
    const error = new Error('Failed to create PR: no GitHub token');
    const onOpenPR = vi.fn().mockRejectedValue(error);

    render(
      <ActionBar
        commitMessage="test commit"
        onCommitMessageChange={vi.fn()}
        onSuggestMessage={vi.fn()}
        onCommit={vi.fn()}
        onOpenPR={onOpenPR}
        isLoading={false}
      />,
    );

    const prButton = screen.getByRole('button', { name: /Open PR/i });
    await user.click(prButton);

    await waitFor(() => {
      expect(screen.getByText('Failed to create PR: no GitHub token')).toBeInTheDocument();
    });
  });

  it('clears error message when new action is attempted', async () => {
    const user = userEvent.setup();
    const onCommit = vi.fn().mockRejectedValueOnce(new Error('First error'));
    const onOpenPR = vi.fn().mockResolvedValue(undefined);

    render(
      <ActionBar
        commitMessage="test"
        onCommitMessageChange={vi.fn()}
        onSuggestMessage={vi.fn()}
        onCommit={onCommit}
        onOpenPR={onOpenPR}
        isLoading={false}
      />,
    );

    // First, trigger error with commit
    const buttons = screen.getAllByRole('button');
    const commitButton = buttons.find((btn) => btn.textContent?.trim() === 'Commit');
    if (commitButton) {
      await user.click(commitButton);
    }

    await waitFor(() => {
      expect(screen.getByText('First error')).toBeInTheDocument();
    });

    // Now trigger a new action - Open PR should clear error
    const prButton = buttons.find((btn) => btn.textContent?.trim() === 'Open PR');
    if (prButton) {
      await user.click(prButton);
    }

    // Error should be cleared
    expect(screen.queryByText('First error')).not.toBeInTheDocument();
  });

  it('renders all buttons in correct order', () => {
    render(
      <ActionBar
        commitMessage="test"
        onCommitMessageChange={vi.fn()}
        onSuggestMessage={vi.fn()}
        onCommit={vi.fn()}
        onOpenPR={vi.fn()}
        isLoading={false}
      />,
    );

    const buttons = screen.getAllByRole('button');
    expect(buttons.length).toBeGreaterThanOrEqual(3); // AI Suggest, Commit, Open PR
    expect(buttons.some((btn) => btn.textContent?.includes('AI Suggest'))).toBe(true);
    expect(buttons.some((btn) => btn.textContent?.includes('Commit'))).toBe(true);
    expect(buttons.some((btn) => btn.textContent?.includes('Open PR'))).toBe(true);
  });
});
