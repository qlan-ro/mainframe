/**
 * ComposerEditMode — muted config-toolbar treatment while editing a queued message.
 *
 * Design (03-content.jsx:759-761): the config-chip row is shown at opacity 0.4
 * AND filter: saturate(0.6) with pointer-events none while editing, so colored
 * controls (amber Plan toggle, accent-active Features/Worktree dots) visibly
 * desaturate as well as dim. Parity finding 8.7 (2026-07-02-design-parity-drift-audit.md §8).
 */
import { describe, it, expect, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

vi.mock('../../../runtime/chat-extras', () => ({
  useChatExtras: () => undefined,
}));

vi.mock('../../config-toolbar/ComposerToolbar', () => ({
  ComposerToolbar: () => null,
}));

vi.mock('../../send/SendControls', () => ({
  StopControl: () => <button data-testid="chat-composer-cancel" />,
}));

import { ApiRequestError } from '@/lib/api/http';
import { ComposerEditMode } from '../ComposerEditMode';
import { ComposerEditProvider, useComposerEdit, type QueuedEdit } from '../composer-edit-context';

const EDIT: QueuedEdit = { messageId: 'm1', content: 'hello' };

describe('ComposerEditMode — muted toolbar desaturates as well as dims', () => {
  it('toolbar wrapper dims (opacity-40), desaturates (saturate-[0.6]), and disables pointer events while editing', () => {
    render(<ComposerEditMode edit={EDIT} onDone={vi.fn()} />);
    const wrapper = screen.getByTestId('chat-composer-edit-toolbar');
    expect(wrapper.className).toContain('opacity-40');
    expect(wrapper.className).not.toContain('opacity-50');
    expect(wrapper.className).toMatch(/saturate-\[0\.6\]/);
    expect(wrapper.className).toContain('pointer-events-none');
  });
});

describe('ComposerEditMode — amber edit-ring glow', () => {
  it('card uses the --mf-shadow-edit-ring token, not a plain shadow-sm', () => {
    render(<ComposerEditMode edit={EDIT} onDone={vi.fn()} />);
    const card = screen.getByTestId('chat-composer-edit');
    expect(card.className).toContain('shadow-[var(--mf-shadow-edit-ring)]');
    expect(card.className).not.toContain('shadow-sm');
  });
});

describe('ComposerEditMode — what it edits', () => {
  it('keeps Stop on screen: the turn runs on while a queued message is edited', () => {
    render(<ComposerEditMode edit={EDIT} onDone={vi.fn()} />);
    expect(screen.getByTestId('chat-composer-cancel')).toBeInTheDocument();
  });

  it('says a queued message stays queued', () => {
    render(<ComposerEditMode edit={EDIT} onDone={vi.fn()} />);
    expect(screen.getByTestId('chat-composer-edit')).toHaveTextContent('stays queued until the run finishes');
  });

  it('does not say that of a message a Stop held back', () => {
    render(<ComposerEditMode edit={{ ...EDIT, save: vi.fn() }} onDone={vi.fn()} />);
    expect(screen.getByTestId('chat-composer-edit')).toHaveTextContent('not sent until you send it');
    expect(screen.getByTestId('chat-composer-edit')).not.toHaveTextContent('stays queued');
  });
});

describe('ComposerEditMode — blocks the message carries for the agent', () => {
  const CAPTURES = '\0__MF_SANDBOX_CAPTURE__\n> **Preview captures**\n> - `element1` — selector `.a`';
  const edit = (content: string) => {
    const save = vi.fn().mockResolvedValue(undefined);
    const onDone = vi.fn();
    render(<ComposerEditMode edit={{ messageId: 'm1', content, save }} onDone={onDone} />);
    return { save, onDone, input: screen.getByTestId<HTMLTextAreaElement>('chat-composer-edit-input') };
  };
  const commit = (input: HTMLElement) => fireEvent.keyDown(input, { key: 'Enter', metaKey: true });

  it('are not in the field, and go back on save', async () => {
    const { save, onDone, input } = edit(`${CAPTURES}\n\nFix it`);
    expect(input).toHaveValue('Fix it');
    fireEvent.change(input, { target: { value: 'Fix it now' } });
    commit(input);
    expect(save).toHaveBeenCalledExactlyOnceWith(`${CAPTURES}\n\nFix it now`);
    await waitFor(() => expect(onDone).toHaveBeenCalled());
  });

  it('stay whole when there was no text yet', () => {
    const { save, input } = edit(CAPTURES);
    expect(input).toHaveValue('');
    fireEvent.change(input, { target: { value: 'Fix it' } });
    commit(input);
    expect(save).toHaveBeenCalledExactlyOnceWith(`${CAPTURES}\n\nFix it`);
  });

  it('are edited with the text when they sit inside it', () => {
    const content = '/review\n\nReferenced session @session[Q]: /x\n\nmore';
    expect(edit(content).input).toHaveValue(content);
  });

  it('do not count as a change', () => {
    const { save, onDone, input } = edit(`${CAPTURES}\n\nFix it`);
    commit(input);
    expect(save).not.toHaveBeenCalled();
    expect(onDone).toHaveBeenCalled();
  });
});

it('drops the queued edit on a thread switch without saving or altering either draft', () => {
  const save = vi.fn();
  function Panel({ draft }: { draft: string }) {
    const { editing, startEdit, cancelEdit } = useComposerEdit();
    return editing ? (
      <ComposerEditMode edit={editing} onDone={cancelEdit} />
    ) : (
      <button onClick={() => startEdit({ ...EDIT, save })}>{draft}</button>
    );
  }
  const view = (scope: string, draft: string) => (
    <ComposerEditProvider scope={scope}>
      <Panel draft={draft} />
    </ComposerEditProvider>
  );
  const { rerender } = render(view('original', 'original draft'));
  fireEvent.click(screen.getByText('original draft'));
  fireEvent.change(screen.getByTestId('chat-composer-edit-input'), { target: { value: 'unsaved queue edit' } });
  rerender(view('next', 'next draft'));
  expect(screen.getByText('next draft')).toBeInTheDocument();
  expect(screen.queryByTestId('chat-composer-edit-save')).toBeNull();
  rerender(view('original', 'original draft'));
  expect(screen.getByText('original draft')).toBeInTheDocument();
  expect(save).not.toHaveBeenCalled();
});

it('keeps the replacement text when the row disappeared before save', async () => {
  const onDone = vi.fn();
  const save = vi.fn().mockRejectedValue(new ApiRequestError('Conflict', [], 409, 'queued_message_gone'));
  render(<ComposerEditMode edit={{ ...EDIT, save }} onDone={onDone} />);
  fireEvent.change(screen.getByTestId('chat-composer-edit-input'), { target: { value: 'replacement' } });
  fireEvent.click(screen.getByTestId('chat-composer-edit-save'));
  await screen.findByText('This message was already sent. Your edit is still in the composer.');
  expect(screen.getByTestId('chat-composer-edit-input')).toHaveValue('replacement');
  expect(onDone).not.toHaveBeenCalled();
});
